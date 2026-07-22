import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SafeEmployee } from '@/lib/server/employee-auth';

// The employee workspace reads must be self-scoped: no employee session ⇒ no
// data and no query at all. Mock the session resolver + db.select/update chains.
// `vi.hoisted` so the mocks exist when the hoisted vi.mock factory runs.
const { selectMock, updateMock } = vi.hoisted(() => ({ selectMock: vi.fn(), updateMock: vi.fn() }));
vi.mock('@/lib/server/employee-auth', () => ({ currentEmployee: vi.fn() }));
vi.mock('@/lib/db/client', () => ({ db: { select: selectMock, update: updateMock } }));

import { listMyTeam, listMyTasks, updateMyTaskStatus } from '@/lib/server/employee-portal';
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

// A drizzle-like select chain; both orderBy (list) and limit (single) resolve
// to `rows`.
function chainResolving(rows: unknown[]) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => Promise.resolve(rows)),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
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
          dueOn: '2026-08-01',
          completedAt: null,
        },
      ]),
    );

    const res = await listMyTasks();
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(res).toHaveLength(1);
    expect(res[0]?.title).toBe('Do the thing');
    expect(res[0]?.completedAt).toBeNull();
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
