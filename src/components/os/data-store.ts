'use client';

// Shared business-data store for the Apar One demo.
//
// Single source of truth across all signed-in users — clients/vendors/projects
// etc. belong to "the agency", not to a particular operator. localStorage key
// is `apar-os:business-data`; first read seeds from the sample-data module so
// the demo never starts empty.
//
// Demo-grade only. Production routes every read/write through Drizzle + RLS.

import { useCallback, useSyncExternalStore } from 'react';
import {
  CLIENTS as SEED_CLIENTS,
  EMPLOYEES as SEED_EMPLOYEES,
  INBOX_DOCS as SEED_INBOX,
  PROJECTS as SEED_PROJECTS,
  VENDORS as SEED_VENDORS,
} from './data';
import { parseState, stringifyState } from './serialize';
import type { Client, Employee, InboxDoc, Project, Vendor } from './types';

// v3 — the single-entry `ledger` slice + 15 `LedgerTx` fixtures were deleted
// in Phase 1 (brownfield kickoff). Real transactions flow through B's
// `<TransactionList>` once it ships. Bumping the storage key discards the v2
// demo data silently; the seed re-populates without a ledger slice.
const STORAGE_KEY = 'apar-os:business-data:v3';

export type BusinessData = {
  clients: Client[];
  vendors: Vendor[];
  projects: Project[];
  employees: Employee[];
  inbox: InboxDoc[];
};

function seed(): BusinessData {
  return {
    clients: [...SEED_CLIENTS],
    vendors: [...SEED_VENDORS],
    projects: [...SEED_PROJECTS],
    employees: [...SEED_EMPLOYEES],
    inbox: [...SEED_INBOX],
  };
}

/* -------------------------------------------------------------------------- */
/* External store                                                             */
/* -------------------------------------------------------------------------- */

let state: BusinessData = seed();
const SSR_STATE: BusinessData = seed();
const listeners = new Set<() => void>();
let loaded = false;

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return; // keep the seed
    const parsed = parseState<Partial<BusinessData>>(raw);
    state = {
      clients: Array.isArray(parsed.clients) ? parsed.clients : state.clients,
      vendors: Array.isArray(parsed.vendors) ? parsed.vendors : state.vendors,
      projects: Array.isArray(parsed.projects) ? parsed.projects : state.projects,
      employees: Array.isArray(parsed.employees) ? parsed.employees : state.employees,
      inbox: Array.isArray(parsed.inbox) ? parsed.inbox : state.inbox,
    };
  } catch {
    // ignore — keep the seed
  }
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, stringifyState(state));
  } catch {
    // ignore
  }
}

function getSnapshot() {
  return state;
}
function getServerSnapshot() {
  return SSR_STATE;
}

/* -------------------------------------------------------------------------- */
/* Public hook                                                                */
/* -------------------------------------------------------------------------- */

export type BusinessApi = {
  data: BusinessData;
  // Clients
  addClient: (
    input: Omit<Client, 'id' | 'activity' | 'logo' | 'tone'> & {
      logo?: string;
      tone?: string;
    },
  ) => Client;
  updateClient: (id: string, patch: Partial<Client>) => void;
  removeClient: (id: string) => void;
  // Vendors
  addVendor: (input: Omit<Vendor, 'id' | 'createdAt'> & { last?: string }) => Vendor;
  updateVendor: (id: string, patch: Partial<Vendor>) => void;
  removeVendor: (id: string) => void;
  // Projects
  addProject: (input: Omit<Project, 'code'> & { code?: string }) => Project;
  updateProject: (code: string, patch: Partial<Project>) => void;
  removeProject: (code: string) => void;
  // Employees
  addEmployee: (input: Omit<Employee, 'id' | 'tone'> & { tone?: string }) => Employee;
  updateEmployee: (id: string, patch: Partial<Employee>) => void;
  removeEmployee: (id: string) => void;
  // Inbox
  addInboxDoc: (input: Omit<InboxDoc, 'id' | 'ago'>) => InboxDoc;
  removeInboxDoc: (id: string) => void;
  /**
   * Approve an inbox doc — drops it from the queue. In v3 this no longer
   * posts a placeholder ledger entry; real posting flows through A's
   * extraction → confirm pipeline once it ships.
   */
  approveInboxDoc: (id: string) => void;
  /** Reset everything back to the seed. Demo-only convenience. */
  resetToSeed: () => void;
};

const TONES = [
  '#B5391E',
  '#5B6677',
  '#7A4E2D',
  '#2E8F5A',
  '#C46A28',
  '#9B3826',
  '#D08A1E',
  '#1A1411',
  '#D08A1E',
];
function pickTone(seedNum: number): string {
  return TONES[seedNum % TONES.length] ?? TONES[0]!;
}
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
function todayLabel(): string {
  return new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  });
}
function justNow(): string {
  return 'just now';
}
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0] ?? '')
    .join('')
    .toUpperCase();
}
function nextProjectCode(existing: readonly Project[]): string {
  const fy = '26';
  const used = new Set(
    existing
      .map((p) => /^APR-(\d{2})-(\d{3})$/.exec(p.code))
      .filter((m): m is RegExpExecArray => !!m && m[1] === fy)
      .map((m) => Number.parseInt(m[2]!, 10)),
  );
  for (let n = 1; n < 1000; n += 1) {
    if (!used.has(n)) return `APR-${fy}-${n.toString().padStart(3, '0')}`;
  }
  return `APR-${fy}-${Date.now().toString().slice(-3)}`;
}

function mutate(next: BusinessData) {
  state = next;
  persist();
  emit();
}

export function useBusinessData(): BusinessApi {
  if (typeof window !== 'undefined') load();
  const data = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /* Clients ----------------------------------------------------------------- */

  const addClient = useCallback<BusinessApi['addClient']>((input) => {
    const id = newId('c');
    const client: Client = {
      id,
      name: input.name,
      industry: input.industry,
      manager: input.manager,
      status: input.status,
      activity: justNow(),
      logo: (input.logo?.trim() || initialsOf(input.name)).slice(0, 4).toUpperCase(),
      tone: input.tone ?? pickTone(state.clients.length),
    };
    mutate({ ...state, clients: [...state.clients, client] });
    return client;
  }, []);

  const updateClient = useCallback<BusinessApi['updateClient']>((id, patch) => {
    mutate({
      ...state,
      clients: state.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    });
  }, []);

  const removeClient = useCallback<BusinessApi['removeClient']>((id) => {
    mutate({ ...state, clients: state.clients.filter((c) => c.id !== id) });
  }, []);

  /* Vendors ----------------------------------------------------------------- */

  const addVendor = useCallback<BusinessApi['addVendor']>((input) => {
    const id = newId('v');
    const vendor: Vendor = {
      ...input,
      id,
      last: input.last ?? todayLabel(),
      createdAt: new Date().toISOString(),
    };
    mutate({ ...state, vendors: [...state.vendors, vendor] });
    return vendor;
  }, []);

  const updateVendor = useCallback<BusinessApi['updateVendor']>((id, patch) => {
    mutate({
      ...state,
      vendors: state.vendors.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });
  }, []);

  const removeVendor = useCallback<BusinessApi['removeVendor']>((id) => {
    mutate({ ...state, vendors: state.vendors.filter((v) => v.id !== id) });
  }, []);

  /* Projects ---------------------------------------------------------------- */

  const addProject = useCallback<BusinessApi['addProject']>((input) => {
    const code = input.code?.trim() || nextProjectCode(state.projects);
    const project: Project = {
      code,
      name: input.name,
      client: input.client,
      lead: input.lead || 'AI',
      col: input.col ?? 'Proposed',
      fee: input.fee ?? 0n,
    };
    mutate({ ...state, projects: [...state.projects, project] });
    return project;
  }, []);

  const updateProject = useCallback<BusinessApi['updateProject']>((code, patch) => {
    mutate({
      ...state,
      projects: state.projects.map((p) => (p.code === code ? { ...p, ...patch } : p)),
    });
  }, []);

  const removeProject = useCallback<BusinessApi['removeProject']>((code) => {
    mutate({ ...state, projects: state.projects.filter((p) => p.code !== code) });
  }, []);

  /* Employees --------------------------------------------------------------- */

  const addEmployee = useCallback<BusinessApi['addEmployee']>((input) => {
    const id = newId('e');
    const emp: Employee = {
      id,
      name: input.name,
      role: input.role,
      dept: input.dept,
      tone: input.tone ?? pickTone(state.employees.length),
    };
    mutate({ ...state, employees: [...state.employees, emp] });
    return emp;
  }, []);

  const updateEmployee = useCallback<BusinessApi['updateEmployee']>((id, patch) => {
    mutate({
      ...state,
      employees: state.employees.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  }, []);

  const removeEmployee = useCallback<BusinessApi['removeEmployee']>((id) => {
    mutate({ ...state, employees: state.employees.filter((e) => e.id !== id) });
  }, []);

  /* Inbox ------------------------------------------------------------------- */

  const addInboxDoc = useCallback<BusinessApi['addInboxDoc']>((input) => {
    const doc: InboxDoc = {
      ...input,
      id: newId('d'),
      ago: justNow(),
    };
    mutate({ ...state, inbox: [doc, ...state.inbox] });
    return doc;
  }, []);

  const removeInboxDoc = useCallback<BusinessApi['removeInboxDoc']>((id) => {
    mutate({ ...state, inbox: state.inbox.filter((d) => d.id !== id) });
  }, []);

  const approveInboxDoc = useCallback<BusinessApi['approveInboxDoc']>((id) => {
    const doc = state.inbox.find((d) => d.id === id);
    if (!doc) return;
    mutate({
      ...state,
      inbox: state.inbox.filter((d) => d.id !== id),
    });
  }, []);

  const resetToSeed = useCallback<BusinessApi['resetToSeed']>(() => {
    mutate(seed());
  }, []);

  return {
    data,
    addClient,
    updateClient,
    removeClient,
    addVendor,
    updateVendor,
    removeVendor,
    addProject,
    updateProject,
    removeProject,
    addEmployee,
    updateEmployee,
    removeEmployee,
    addInboxDoc,
    removeInboxDoc,
    approveInboxDoc,
    resetToSeed,
  };
}
