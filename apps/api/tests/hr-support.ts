import type request from 'supertest';
import { expect } from 'vitest';
import type { registerOrg } from './helpers';
import { CLIENT, signIn, type TestApp } from './helpers';

export type Agent = ReturnType<typeof request.agent>;
export type Org = Awaited<ReturnType<typeof registerOrg>>;

export const q = (agent: Agent, query: string, variables?: Record<string, unknown>) =>
  agent.post('/graphql').set(CLIENT).send({ query, variables });
export const code = (res: request.Response) => res.body.errors?.[0]?.extensions?.code as string;

export const ROLES = `{ roles { id key } }`;
export const BRANCHES = `{ branches { id code } }`;
export const CREATE_ROLE = `mutation($i: RoleInput!){ createRole(input:$i){ id key } }`;
export const CREATE_BRANCH = `mutation($i: CreateBranchInput!){ createBranch(input:$i){ id code } }`;
export const CREATE_USER = `mutation($i: CreateUserInput!){ createUser(input:$i){ id email } }`;

export const EMP_FIELDS = `id employeeCode fullName email status version branch { id code } shiftId shiftName userId`;
export const CREATE_EMPLOYEE = `mutation($i: CreateEmployeeInput!){ createEmployee(input:$i){ ${EMP_FIELDS} } }`;
export const UPDATE_EMPLOYEE = `mutation($id: ID!, $i: UpdateEmployeeInput!){ updateEmployee(id:$id,input:$i){ ${EMP_FIELDS} } }`;
export const LIST_EMPLOYEES = `query($i: ListEmployeesInput){ employees(input:$i){ total items { ${EMP_FIELDS} } } }`;
export const GET_EMPLOYEE = `query($id: ID!){ employee(id:$id){ ${EMP_FIELDS} } }`;
export const MY_EMPLOYEE = `{ myEmployee { ${EMP_FIELDS} } }`;

export const PUNCH = `mutation($i: PunchInput){ punch(input:$i){ kind today { state date day { status late workedMinutes open firstIn lastOut } punches { kind source at } } } }`;
export const TODAY = `{ attendanceToday { state date day { status late workedMinutes open } punches { kind at } } }`;
export const MANUAL = `mutation($i: ManualPunchInput!){ addManualPunch(input:$i) }`;
export const RANGE = `query($i: AttendanceRangeInput!){ attendance(input:$i){ total timeZone items { employee { id employeeCode } days { date status late workedMinutes open } } } }`;
export const SHIFTS = `{ shifts { id name startTime endTime graceMinutes fullDayMinutes halfDayMinutes status version } }`;
export const CREATE_SHIFT = `mutation($i: ShiftInput!){ createShift(input:$i){ id name version } }`;
export const UPDATE_SHIFT = `mutation($id: ID!, $i: UpdateShiftInput!){ updateShift(id:$id,input:$i){ id name status version } }`;

export const LEAVE_TYPES = `{ leaveTypes { id code name annualDays paid status version } }`;
export const CREATE_LEAVE_TYPE = `mutation($i: CreateLeaveTypeInput!){ createLeaveType(input:$i){ id code version } }`;
export const BALANCES = `query($i: LeaveBalancesInput){ leaveBalances(input:$i){ employeeId year items { leaveType { code } quota used pending remaining } } }`;
export const LEAVE_FIELDS = `id employeeId employeeName leaveTypeCode startDate endDate days status version decisionNote`;
export const REQUEST_LEAVE = `mutation($i: RequestLeaveInput!){ requestLeave(input:$i){ ${LEAVE_FIELDS} } }`;
export const CANCEL_LEAVE = `mutation($id: ID!){ cancelLeave(id:$id){ ${LEAVE_FIELDS} } }`;
export const DECIDE_LEAVE = `mutation($id: ID!, $i: DecideLeaveInput!){ decideLeave(id:$id,input:$i){ ${LEAVE_FIELDS} } }`;
export const LIST_LEAVE = `query($i: ListLeaveInput){ leaveRequests(input:$i){ total items { ${LEAVE_FIELDS} } } }`;

/** Permissions of a branch-level HR coordinator: manage people and attendance, approve leave. */
export const HR_COORDINATOR_PERMISSIONS = [
  'employee.employee.view',
  'employee.employee.create',
  'employee.employee.update',
  'attendance.record.view',
  'attendance.record.manage',
  'attendance.shift.view',
  'attendance.leave.view',
  'attendance.leave.approve',
  'employee.profile.view-own',
  'attendance.punch.create-own',
  'attendance.record.view-own',
  'attendance.leave.request-own',
];

export interface Person {
  userId: string;
  employeeId: string;
  agent: Agent;
}

/**
 * Builds a small company: two branches, an Employee-role user in each, and an
 * HR coordinator scoped to the first branch. Everyone has a linked employee record.
 */
export async function buildCompany(app: TestApp, org: Org) {
  const { agent: owner } = await signIn(app, org);
  const roles = (await q(owner, ROLES)).body.data.roles as { id: string; key: string }[];
  const roleId = Object.fromEntries(roles.map((r) => [r.key, r.id]));
  const ho = (await q(owner, BRANCHES)).body.data.branches[0].id as string;
  const br2Res = await q(owner, CREATE_BRANCH, { i: { code: 'BR2', name: 'Second branch' } });
  expect(br2Res.body.errors).toBeUndefined();
  const br2 = br2Res.body.data.createBranch.id as string;
  const shiftId = (await q(owner, SHIFTS)).body.data.shifts[0].id as string;

  const hrRole = await q(owner, CREATE_ROLE, {
    i: { name: 'HR coordinator', dataScope: 'branch', permissions: HR_COORDINATOR_PERMISSIONS },
  });
  expect(hrRole.body.errors).toBeUndefined();
  roleId.hr = hrRole.body.data.createRole.id;

  let n = 0;
  async function person(opts: {
    role: string;
    branch: string;
    name: string;
    joiningDate?: string;
  }): Promise<Person> {
    n += 1;
    const email = `p${n}-${Math.random().toString(36).slice(2, 8)}@acme.example`;
    const password = 'a long enough password';
    const user = await q(owner, CREATE_USER, {
      i: {
        fullName: opts.name,
        email,
        password,
        roleId: roleId[opts.role],
        branchIds: [opts.branch],
      },
    });
    expect(user.body.errors).toBeUndefined();
    const userId = user.body.data.createUser.id as string;
    const emp = await q(owner, CREATE_EMPLOYEE, {
      i: {
        employeeCode: `E${String(n).padStart(3, '0')}`,
        fullName: opts.name,
        email,
        branchId: opts.branch,
        joiningDate: opts.joiningDate ?? '2024-01-01',
        userId,
        shiftId,
      },
    });
    expect(emp.body.errors).toBeUndefined();
    const { agent } = await signIn(app, { input: { ...org.input, email, password } });
    return { userId, employeeId: emp.body.data.createEmployee.id as string, agent };
  }

  return { owner, roleId, ho, br2, shiftId, person };
}
