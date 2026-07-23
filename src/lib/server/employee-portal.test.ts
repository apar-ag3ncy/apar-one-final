import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SafeEmployee } from '@/lib/server/employee-auth';

// The employee workspace reads must be self-scoped: no employee session ⇒ no
// data and no query at all. Mock the session resolver + db.select/update chains.
// `vi.hoisted` so the mocks exist when the hoisted vi.mock factory runs.
const { selectMock, updateMock, insertMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
}));
vi.mock('@/lib/server/employee-auth', () => ({ currentEmployee: vi.fn() }));
vi.mock('@/lib/db/client', () => ({
  db: { select: selectMock, update: updateMock, insert: insertMock },
}));

import {
  listMyTeam,
  listMyTasks,
  updateMyTaskStatus,
  getMyAttendance,
  applyMyLeave,
  listMyLeaves,
  cancelMyLeave,
  decideMyReportLeave,
} from '@/lib/server/employee-portal';
import { currentEmployee } from '@/lib/server/employee-auth';

const mockEmployee = vi.mocked(currentEmployee);

const EMPLOYEE: SafeEmployee = {
  id: 'me-uuid',
  employeeCode: 'APAR-001',
  fullName: 'Me',
  displayName: null,
  workEmail: 'me@apar.example',
  designation: null,
  department: null,
  status: 'active',
  joinedOn: '2024-01-01',
};

// A drizzle-like select chain: every builder method returns the chain, and the
// chain itself is thenable → `await` at ANY terminal (.where / .orderBy /
// .limit) resolves to `rows`. Mirrors drizzle's every-stage-thenable queries.
function chainResolving(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
  };
  for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) {
    chain[m] = vi.fn(() => chain);
  }
  return chain;
}

// A drizzle-like update chain: update().set().where() resolves.
function updateChain() {
  const chain = {
    set: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(undefined)),
  };
  return chain;
}

// insert().values() resolves.
function insertChain() {
  return { values: vi.fn(() => Promise.resolve(undefined)) };
}

describe('employee-portal — self-scoped reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listMyTeam returns [] and issues NO query when there is no employee session', async () => {
    mockEmployee.mockResolvedValue(null);
    const res = await listMyTeam();
    expect(res).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('listMyTasks returns [] and issues NO query when there is no employee session', async () => {
    mockEmployee.mockResolvedValue(null);
    const res = await listMyTasks();
    expect(res).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('listMyTeam queries and flags only the caller as self', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    selectMock.mockReturnValue(
      chainResolving([
        {
          id: 'me-uuid',
          employeeCode: 'APAR-001',
          fullName: 'Me',
          displayName: null,
          designation: 'Dev',
          department: 'Eng',
        },
        {
          id: 'other-uuid',
          employeeCode: 'APAR-002',
          fullName: 'Other',
          displayName: null,
          designation: 'Design',
          department: 'Eng',
        },
      ]),
    );

    const res = await listMyTeam();
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(res).toHaveLength(2);
    expect(res.find((m) => m.id === 'me-uuid')?.isSelf).toBe(true);
    expect(res.find((m) => m.id === 'other-uuid')?.isSelf).toBe(false);
  });

  it('listMyTasks maps the signed-in employee’s task rows', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    selectMock.mockReturnValue(
      chainResolving([
        {
          taskId: 't1',
          title: 'Do the thing',
          status: 'todo',
          priority: null,
          source: null,
          projectId: 'p1',
          projectName: 'Project One',
          projectCode: 'PRJ-1',
          clientId: 'c1',
          clientName: 'Acme Co',
          dueOn: '2026-08-01',
          completedAt: null,
          completionOutcome: null,
        },
      ]),
    );

    const res = await listMyTasks();
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(res).toHaveLength(1);
    expect(res[0]?.title).toBe('Do the thing');
    expect(res[0]?.completedAt).toBeNull();
    expect(res[0]?.clientName).toBe('Acme Co');
    expect(res[0]?.completionOutcome).toBeNull();
  });
});

describe('updateMyTaskStatus — self-scoped writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when there is no employee session (no query)', async () => {
    mockEmployee.mockResolvedValue(null);
    const r = await updateMyTaskStatus('task-1', 'done');
    expect(r.ok).toBe(false);
    expect(selectMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid status without touching the db', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    const r = await updateMyTaskStatus('task-1', 'not_a_status');
    expect(r).toEqual({ ok: false, error: 'Invalid status.' });
    expect(selectMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects a task not assigned to the caller (self-scope select returns nothing)', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    selectMock.mockReturnValue(chainResolving([])); // no matching assigned task
    const r = await updateMyTaskStatus('someone-elses-task', 'done');
    expect(r.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('updates when the task is assigned to the caller', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    selectMock.mockReturnValue(chainResolving([{ status: 'todo' }]));
    updateMock.mockReturnValue(updateChain());
    const r = await updateMyTaskStatus('my-task', 'done');
    expect(r).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});

describe('getMyAttendance — self-scoped, default-filled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null with no employee session (no query)', async () => {
    mockEmployee.mockResolvedValue(null);
    expect(await getMyAttendance('2026-07', '2026-07-31')).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('returns null for a malformed month', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    expect(await getMyAttendance('2026-7', '2026-07-31')).toBeNull();
    expect(await getMyAttendance('2026-13', '2026-07-31')).toBeNull();
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('fills defaults, applies overrides, and counts only non-future days', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    selectMock.mockReturnValue(
      chainResolving([
        { date: '2026-07-06', status: 'on_leave' },
        { date: '2026-07-13', status: 'work_from_home' },
        { date: '2026-07-20', status: 'absent' },
      ]),
    );

    const res = await getMyAttendance('2026-07', '2026-07-15');
    expect(res).not.toBeNull();
    expect(res?.month).toBe('2026-07');
    expect(res?.days).toHaveLength(31); // July has 31 days

    // Override reflected on its day.
    const jul6 = res?.days.find((d) => d.date === '2026-07-06');
    expect(jul6?.status).toBe('on_leave');
    expect(jul6?.isDefault).toBe(false);

    // Days after `today` are future → excluded from the summary.
    const jul20 = res?.days.find((d) => d.date === '2026-07-20');
    expect(jul20?.isFuture).toBe(true);

    // on_leave (07-06) + wfh (07-13) are ≤ 07-15 → counted; absent (07-20) future → not.
    expect(res?.summary.onLeave).toBe(1);
    expect(res?.summary.workFromHome).toBe(1);
    expect(res?.summary.absent).toBe(0);
    expect(res?.summary.present).toBeGreaterThan(0); // default present days exist
  });
});

describe('leaves — self-scoped apply/cancel + manager decide', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applyMyLeave rejects with no session (no insert)', async () => {
    mockEmployee.mockResolvedValue(null);
    const r = await applyMyLeave({
      fromDate: '2026-08-01',
      toDate: '2026-08-02',
      kind: 'casual',
      reason: 'x',
    });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('applyMyLeave rejects to-before-from and empty reason', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    expect(
      (
        await applyMyLeave({
          fromDate: '2026-08-05',
          toDate: '2026-08-01',
          kind: 'casual',
          reason: 'trip',
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await applyMyLeave({
          fromDate: '2026-08-01',
          toDate: '2026-08-02',
          kind: 'casual',
          reason: '  ',
        })
      ).ok,
    ).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('applyMyLeave inserts a valid request', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    insertMock.mockReturnValue(insertChain());
    const r = await applyMyLeave({
      fromDate: '2026-08-01',
      toDate: '2026-08-03',
      kind: 'sick',
      reason: 'fever',
    });
    expect(r).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('listMyLeaves returns [] with no session', async () => {
    mockEmployee.mockResolvedValue(null);
    expect(await listMyLeaves()).toEqual([]);
    expect(selectMock).not.toHaveBeenCalled();
  });

  it('cancelMyLeave refuses a non-pending leave', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    selectMock.mockReturnValue(chainResolving([{ status: 'approved' }]));
    updateMock.mockReturnValue(updateChain());
    const r = await cancelMyLeave('leave-1');
    expect(r.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('cancelMyLeave cancels a pending leave', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    selectMock.mockReturnValue(chainResolving([{ status: 'applied' }]));
    updateMock.mockReturnValue(updateChain());
    const r = await cancelMyLeave('leave-1');
    expect(r).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('decideMyReportLeave rejects a leave not from a direct report', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    selectMock.mockReturnValue(chainResolving([])); // join matched nothing
    const r = await decideMyReportLeave('leave-x', true);
    expect(r.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('decideMyReportLeave approves a pending report leave', async () => {
    mockEmployee.mockResolvedValue(EMPLOYEE);
    selectMock.mockReturnValue(chainResolving([{ status: 'applied' }]));
    updateMock.mockReturnValue(updateChain());
    const r = await decideMyReportLeave('leave-1', true);
    expect(r).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
