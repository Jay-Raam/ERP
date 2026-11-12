import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, gql, registerOrg, signIn, testApp } from './helpers';
import {
  BRANCHES,
  CREATE_EMPLOYEE,
  GET_EMPLOYEE,
  LEAVE_TYPES,
  LIST_EMPLOYEES,
  MY_EMPLOYEE,
  SHIFTS,
  UPDATE_EMPLOYEE,
  buildCompany,
  code,
  q,
  type Org,
  type Person,
} from './hr-support';

const app = testApp();
afterAll(() => database.close());

let org: Org;
let company: Awaited<ReturnType<typeof buildCompany>>;
let alice: Person; // employee role, branch 1
let bob: Person; // employee role, branch 2
let hr: Person; // HR coordinator, branch 1

beforeAll(async () => {
  org = await registerOrg(app);
  company = await buildCompany(app, org);
  alice = await company.person({ role: 'employee', branch: company.ho, name: 'Alice' });
  bob = await company.person({ role: 'employee', branch: company.br2, name: 'Bob' });
  hr = await company.person({ role: 'hr', branch: company.ho, name: 'Hema HR' });
});

describe('HR defaults', () => {
  it('gives a new organisation a starter shift and leave types', async () => {
    const shifts = (await q(company.owner, SHIFTS)).body.data.shifts;
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({
      name: 'General',
      startTime: '09:00:00',
      graceMinutes: 15,
      fullDayMinutes: 480,
      halfDayMinutes: 240,
    });
    const types = (await q(company.owner, LEAVE_TYPES)).body.data.leaveTypes;
    expect(types.map((t: { code: string }) => t.code).sort()).toEqual(['CL', 'EL', 'SL']);
  });
});

describe('employees: permissions', () => {
  it('rejects anonymous callers', async () => {
    const res = await gql(app, LIST_EMPLOYEES);
    expect(code(res)).toBe('UNAUTHENTICATED');
  });

  it('keeps the Employee role out of the directory but lets them read their own record', async () => {
    expect(code(await q(alice.agent, LIST_EMPLOYEES))).toBe('FORBIDDEN');
    expect(code(await q(alice.agent, GET_EMPLOYEE, { id: bob.employeeId }))).toBe('FORBIDDEN');
    const mine = await q(alice.agent, MY_EMPLOYEE);
    expect(mine.body.data.myEmployee.fullName).toBe('Alice');
    expect(mine.body.data.myEmployee.userId).toBe(alice.userId);
  });

  it('forbids create and update without the permission', async () => {
    const attempt = await q(alice.agent, CREATE_EMPLOYEE, { i: newEmployee(company.ho) });
    expect(code(attempt)).toBe('FORBIDDEN');
    const update = await q(alice.agent, UPDATE_EMPLOYEE, {
      id: alice.employeeId,
      i: { ...fullUpdate(company.ho, 'Alice Edited', alice.userId), version: 1 },
    });
    expect(code(update)).toBe('FORBIDDEN');
  });
});

describe('employees: data scope', () => {
  it('shows a branch-scoped coordinator only their branch', async () => {
    const res = await q(hr.agent, LIST_EMPLOYEES);
    const names = res.body.data.employees.items.map((e: { fullName: string }) => e.fullName);
    expect(names).toContain('Alice');
    expect(names).toContain('Hema HR');
    expect(names).not.toContain('Bob');
  });

  it('treats an employee outside the scope as missing, not forbidden', async () => {
    expect(code(await q(hr.agent, GET_EMPLOYEE, { id: bob.employeeId }))).toBe('NOT_FOUND');
    const res = await q(hr.agent, UPDATE_EMPLOYEE, {
      id: bob.employeeId,
      i: { ...fullUpdate(company.br2, 'Bob'), version: 1 },
    });
    expect(code(res)).toBe('NOT_FOUND');
  });

  it('stops a coordinator creating or moving people into another branch', async () => {
    const created = await q(hr.agent, CREATE_EMPLOYEE, {
      i: newEmployee(company.br2, { employeeCode: 'X-BR2' }),
    });
    expect(code(created)).toBe('FORBIDDEN');
    const moved = await q(hr.agent, UPDATE_EMPLOYEE, {
      id: alice.employeeId,
      i: { ...fullUpdate(company.br2, 'Alice', alice.userId), version: 1 },
    });
    expect(code(moved)).toBe('FORBIDDEN');
  });

  it('shows the owner everyone, and filters by branch and search', async () => {
    const all = await q(company.owner, LIST_EMPLOYEES);
    expect(all.body.data.employees.total).toBe(3);
    const br2 = await q(company.owner, LIST_EMPLOYEES, { i: { branchId: company.br2 } });
    expect(br2.body.data.employees.items.map((e: { fullName: string }) => e.fullName)).toEqual([
      'Bob',
    ]);
    const search = await q(company.owner, LIST_EMPLOYEES, { i: { search: 'hema' } });
    expect(search.body.data.employees.total).toBe(1);
    // LIKE wildcards are literal text, not patterns.
    const wild = await q(company.owner, LIST_EMPLOYEES, { i: { search: '%' } });
    expect(wild.body.data.employees.total).toBe(0);
  });
});

describe('employees: create and update', () => {
  it('creates an employee and rejects bad input', async () => {
    const ok = await q(company.owner, CREATE_EMPLOYEE, {
      i: newEmployee(company.ho, { employeeCode: 'NEW-1', email: 'new1@acme.example' }),
    });
    expect(ok.body.errors).toBeUndefined();
    expect(ok.body.data.createEmployee).toMatchObject({
      employeeCode: 'NEW-1',
      status: 'active',
      version: 1,
    });

    for (const bad of [
      { fullName: '' },
      { joiningDate: 'not-a-date' },
      { email: 'nope' },
      { phone: 'abc' },
      { employeeCode: 'has space' },
      { branchId: 'not-a-uuid' },
    ]) {
      const res = await q(company.owner, CREATE_EMPLOYEE, { i: newEmployee(company.ho, bad) });
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects duplicate codes, emails and user links with a field error', async () => {
    const dupCode = await q(company.owner, CREATE_EMPLOYEE, {
      i: newEmployee(company.ho, { employeeCode: 'NEW-1', email: 'other@acme.example' }),
    });
    expect(code(dupCode)).toBe('CONFLICT');
    expect(dupCode.body.errors[0].extensions.fieldErrors.employeeCode).toBeDefined();

    const dupEmail = await q(company.owner, CREATE_EMPLOYEE, {
      i: newEmployee(company.ho, { employeeCode: 'NEW-2', email: 'new1@acme.example' }),
    });
    expect(code(dupEmail)).toBe('CONFLICT');

    const dupUser = await q(company.owner, CREATE_EMPLOYEE, {
      i: newEmployee(company.ho, { employeeCode: 'NEW-3', userId: alice.userId }),
    });
    expect(code(dupUser)).toBe('CONFLICT');
  });

  it('rejects an unknown branch, shift or user', async () => {
    const ghost = '00000000-0000-4000-8000-000000000001';
    for (const extra of [{ branchId: ghost }, { shiftId: ghost }, { userId: ghost }]) {
      const res = await q(company.owner, CREATE_EMPLOYEE, {
        i: newEmployee(company.ho, {
          employeeCode: `G-${Math.random().toString(36).slice(2, 6)}`,
          ...extra,
        }),
      });
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('refuses to link a user from another organisation', async () => {
    const other = await registerOrg(app);
    const stranger = other.ownerId;
    const res = await q(company.owner, CREATE_EMPLOYEE, {
      i: newEmployee(company.ho, { employeeCode: 'CROSS-1', userId: stranger }),
    });
    expect(code(res)).toBe('VALIDATION_ERROR');
  });

  it('updates with optimistic locking and keeps the employee code fixed', async () => {
    const before = (await q(company.owner, GET_EMPLOYEE, { id: alice.employeeId })).body.data
      .employee;
    const res = await q(company.owner, UPDATE_EMPLOYEE, {
      id: alice.employeeId,
      i: { ...fullUpdate(company.ho, 'Alice Rao', alice.userId), version: before.version },
    });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.updateEmployee).toMatchObject({
      fullName: 'Alice Rao',
      employeeCode: before.employeeCode,
      version: before.version + 1,
    });

    const stale = await q(company.owner, UPDATE_EMPLOYEE, {
      id: alice.employeeId,
      i: { ...fullUpdate(company.ho, 'Alice Stale', alice.userId), version: before.version },
    });
    expect(code(stale)).toBe('CONFLICT');

    const withCode = await q(company.owner, UPDATE_EMPLOYEE, {
      id: alice.employeeId,
      i: {
        ...fullUpdate(company.ho, 'x y', alice.userId),
        version: before.version + 1,
        employeeCode: 'HACK',
      },
    });
    // GraphQL itself refuses a field the input type does not have.
    expect(code(withCode)).toBe('BAD_REQUEST');
  });

  it('deactivates instead of deleting', async () => {
    const created = await q(company.owner, CREATE_EMPLOYEE, {
      i: newEmployee(company.ho, { employeeCode: 'GONE-1' }),
    });
    const e = created.body.data.createEmployee;
    const res = await q(company.owner, UPDATE_EMPLOYEE, {
      id: e.id,
      i: { ...fullUpdate(company.ho, e.fullName), status: 'inactive', version: e.version },
    });
    expect(res.body.data.updateEmployee.status).toBe('inactive');
    const still = await q(company.owner, GET_EMPLOYEE, { id: e.id });
    expect(still.body.data.employee.status).toBe('inactive');
  });
});

describe('employees: tenant isolation', () => {
  it("never shows one organisation's employees to another", async () => {
    const other = await registerOrg(app);
    const { agent } = await signIn(app, other);
    const list = await q(agent, LIST_EMPLOYEES);
    expect(list.body.data.employees.total).toBe(0);
    expect(code(await q(agent, GET_EMPLOYEE, { id: alice.employeeId }))).toBe('NOT_FOUND');
    const branches = (await q(agent, BRANCHES)).body.data.branches;
    expect(branches.map((b: { id: string }) => b.id)).not.toContain(company.ho);
  });
});

// ---------------------------------------------------------------- helpers

function newEmployee(branchId: string, over: Record<string, unknown> = {}) {
  return {
    employeeCode: 'EMP-X',
    fullName: 'New Person',
    email: null,
    phone: null,
    branchId,
    department: null,
    designation: null,
    joiningDate: '2025-01-01',
    shiftId: null,
    userId: null,
    ...over,
  };
}

function fullUpdate(branchId: string, fullName: string, userId: string | null = null) {
  return {
    fullName,
    email: null,
    phone: null,
    branchId,
    department: null,
    designation: null,
    joiningDate: '2024-01-01',
    shiftId: null,
    userId,
    status: 'active',
  };
}
