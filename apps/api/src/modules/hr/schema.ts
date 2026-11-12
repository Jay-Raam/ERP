import type { GraphQLContext } from '../../graphql/context';
import type { AttendanceService } from './attendance.service';
import type { EmployeesService } from './employees.service';
import type { LeaveService } from './leave.service';

export const hrTypeDefs = /* GraphQL */ `
  type EmployeeBranch {
    id: ID!
    code: String!
    name: String!
  }

  type Employee {
    id: ID!
    employeeCode: String!
    fullName: String!
    email: String
    phone: String
    department: String
    designation: String
    joiningDate: String!
    status: RecordStatus!
    branch: EmployeeBranch!
    shiftId: ID
    shiftName: String
    userId: ID
    userEmail: String
    createdAt: String!
    version: Int!
  }

  type EmployeePage {
    items: [Employee!]!
    total: Int!
  }

  input CreateEmployeeInput {
    employeeCode: String!
    fullName: String!
    email: String
    phone: String
    branchId: ID!
    department: String
    designation: String
    joiningDate: String!
    shiftId: ID
    userId: ID
  }

  input UpdateEmployeeInput {
    fullName: String!
    email: String
    phone: String
    branchId: ID!
    department: String
    designation: String
    joiningDate: String!
    shiftId: ID
    userId: ID
    status: RecordStatus!
    version: Int!
  }

  input ListEmployeesInput {
    search: String
    status: RecordStatus
    branchId: ID
    limit: Int
    offset: Int
  }

  extend type Query {
    employees(input: ListEmployeesInput): EmployeePage!
    employee(id: ID!): Employee!
    "The signed-in user's own employee record, or null if none is linked."
    myEmployee: Employee
  }

  extend type Mutation {
    createEmployee(input: CreateEmployeeInput!): Employee!
    updateEmployee(id: ID!, input: UpdateEmployeeInput!): Employee!
  }

  enum PunchKind {
    in
    out
  }

  enum DayStatus {
    present
    half_day
    short
    incomplete
    leave
    absent
    upcoming
  }

  enum LeaveStatus {
    pending
    approved
    rejected
    cancelled
  }

  enum LeaveDecision {
    approve
    reject
  }

  type Punch {
    id: ID
    kind: PunchKind!
    at: String!
  }

  type RecordedPunch {
    id: ID!
    kind: PunchKind!
    source: String!
    at: String!
    note: String
  }

  type AttendanceDay {
    date: String!
    status: DayStatus!
    firstIn: String
    lastOut: String
    workedMinutes: Int!
    late: Boolean!
    open: Boolean!
    punches: [Punch!]!
  }

  type TodayAttendance {
    employee: Employee!
    date: String!
    timeZone: String!
    "in = currently clocked in, out = not clocked in."
    state: PunchKind!
    day: AttendanceDay!
    punches: [RecordedPunch!]!
  }

  type PunchResult {
    kind: PunchKind!
    today: TodayAttendance!
  }

  type EmployeeAttendance {
    employee: Employee!
    days: [AttendanceDay!]!
  }

  type AttendanceReport {
    timeZone: String!
    from: String!
    to: String!
    total: Int!
    items: [EmployeeAttendance!]!
  }

  type Shift {
    id: ID!
    name: String!
    startTime: String!
    endTime: String!
    graceMinutes: Int!
    fullDayMinutes: Int!
    halfDayMinutes: Int!
    status: RecordStatus!
    version: Int!
  }

  type LeaveType {
    id: ID!
    code: String!
    name: String!
    annualDays: Float!
    paid: Boolean!
    status: RecordStatus!
    version: Int!
  }

  type LeaveBalance {
    leaveType: LeaveType!
    quota: Float!
    used: Float!
    pending: Float!
    remaining: Float!
  }

  type LeaveBalances {
    employeeId: ID
    year: Int!
    items: [LeaveBalance!]!
  }

  type LeaveRequest {
    id: ID!
    employeeId: ID!
    employeeName: String!
    employeeCode: String!
    leaveTypeId: ID!
    leaveTypeName: String!
    leaveTypeCode: String!
    startDate: String!
    endDate: String!
    days: Float!
    reason: String!
    status: LeaveStatus!
    decidedAt: String
    decisionNote: String
    createdAt: String!
    version: Int!
  }

  type LeavePage {
    items: [LeaveRequest!]!
    total: Int!
  }

  input PunchInput {
    note: String
  }

  input ManualPunchInput {
    employeeId: ID!
    "ISO date-time with offset, e.g. 2026-11-11T09:05:00+05:30. Give an in time, an out time, or both."
    inAt: String
    outAt: String
    reason: String!
  }

  input AttendanceRangeInput {
    from: String!
    to: String!
    employeeId: ID
    branchId: ID
    limit: Int
    offset: Int
  }

  input ShiftInput {
    name: String!
    startTime: String!
    endTime: String!
    graceMinutes: Int!
    fullDayMinutes: Int!
    halfDayMinutes: Int!
  }

  input UpdateShiftInput {
    name: String!
    startTime: String!
    endTime: String!
    graceMinutes: Int!
    fullDayMinutes: Int!
    halfDayMinutes: Int!
    status: RecordStatus!
    version: Int!
  }

  input CreateLeaveTypeInput {
    code: String!
    name: String!
    annualDays: Float!
    paid: Boolean!
  }

  input UpdateLeaveTypeInput {
    name: String!
    annualDays: Float!
    paid: Boolean!
    status: RecordStatus!
    version: Int!
  }

  input RequestLeaveInput {
    leaveTypeId: ID!
    startDate: String!
    endDate: String!
    reason: String!
  }

  input DecideLeaveInput {
    decision: LeaveDecision!
    note: String
    version: Int!
  }

  input ListLeaveInput {
    status: LeaveStatus
    employeeId: ID
    limit: Int
    offset: Int
  }

  input LeaveBalancesInput {
    employeeId: ID
    year: Int
  }

  extend type Query {
    "The signed-in person's day so far. Null if no employee record is linked."
    attendanceToday: TodayAttendance
    attendance(input: AttendanceRangeInput!): AttendanceReport!
    shifts: [Shift!]!
    leaveTypes: [LeaveType!]!
    leaveBalances(input: LeaveBalancesInput): LeaveBalances!
    leaveRequests(input: ListLeaveInput): LeavePage!
  }

  extend type Mutation {
    "Clock in or out. The server decides which, and uses its own clock."
    punch(input: PunchInput): PunchResult!
    addManualPunch(input: ManualPunchInput!): Boolean!
    createShift(input: ShiftInput!): Shift!
    updateShift(id: ID!, input: UpdateShiftInput!): Shift!
    createLeaveType(input: CreateLeaveTypeInput!): LeaveType!
    updateLeaveType(id: ID!, input: UpdateLeaveTypeInput!): LeaveType!
    requestLeave(input: RequestLeaveInput!): LeaveRequest!
    cancelLeave(id: ID!): LeaveRequest!
    decideLeave(id: ID!, input: DecideLeaveInput!): LeaveRequest!
  }
`;

type Args<T> = { input: T };
type IdArgs<T> = { id: string; input: T };

export const isoDate = <U extends { createdAt: Date }>(u: U) => ({
  ...u,
  createdAt: u.createdAt.toISOString(),
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type DayLike = {
  date: string;
  status: string;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  late: boolean;
  open: boolean;
  punches: { id?: string; kind: string; at: Date }[];
};

const shapeDay = (d: DayLike) => ({
  ...d,
  firstIn: iso(d.firstIn),
  lastOut: iso(d.lastOut),
  punches: d.punches.map((p) => ({ id: p.id ?? null, kind: p.kind, at: p.at.toISOString() })),
});

type Today = NonNullable<Awaited<ReturnType<AttendanceService['today']>>>;

const shapeToday = (t: Today) => ({
  ...t,
  employee: isoDate(t.employee),
  day: shapeDay(t.day),
  punches: t.punches.map((p) => ({ ...p, at: p.at.toISOString() })),
});

const shapeLeave = <L extends { decidedAt: Date | null; createdAt: Date }>(l: L) => ({
  ...l,
  decidedAt: iso(l.decidedAt),
  createdAt: l.createdAt.toISOString(),
});

export function hrResolvers(
  employees: EmployeesService,
  attendance: AttendanceService,
  leave: LeaveService,
) {
  return {
    Query: {
      employees: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) => {
        const page = await employees.list(await ctx.viewer(), a.input);
        return { total: page.total, items: page.items.map(isoDate) };
      },
      employee: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        isoDate(await employees.get(await ctx.viewer(), a.id)),
      myEmployee: async (_p: unknown, _a: unknown, ctx: GraphQLContext) => {
        const row = await employees.mine(await ctx.viewer());
        return row ? isoDate(row) : null;
      },
      attendanceToday: async (_p: unknown, _a: unknown, ctx: GraphQLContext) => {
        const t = await attendance.today(await ctx.viewer());
        return t ? shapeToday(t) : null;
      },
      attendance: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) => {
        const report = await attendance.range(await ctx.viewer(), a.input);
        return {
          ...report,
          items: report.items.map((i) => ({
            employee: isoDate(i.employee),
            days: i.days.map(shapeDay),
          })),
        };
      },
      shifts: async (_p: unknown, _a: unknown, ctx: GraphQLContext) =>
        attendance.listShifts(await ctx.viewer()),
      leaveTypes: async (_p: unknown, _a: unknown, ctx: GraphQLContext) =>
        leave.listTypes(await ctx.viewer()),
      leaveBalances: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) =>
        leave.balances(await ctx.viewer(), a.input),
      leaveRequests: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) => {
        const page = await leave.list(await ctx.viewer(), a.input);
        return { total: page.total, items: page.items.map(shapeLeave) };
      },
    },
    Mutation: {
      createEmployee: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        isoDate(await employees.create(await ctx.viewer(), a.input)),
      updateEmployee: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        isoDate(await employees.update(await ctx.viewer(), a.id, a.input)),
      punch: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) => {
        const r = await attendance.punch(await ctx.viewer(), a.input);
        const { kind, ...today } = r;
        return { kind, today: shapeToday(today as Today) };
      },
      addManualPunch: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        attendance.addManualPunch(await ctx.viewer(), a.input),
      createShift: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        attendance.createShift(await ctx.viewer(), a.input),
      updateShift: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        attendance.updateShift(await ctx.viewer(), a.id, a.input),
      createLeaveType: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        leave.createType(await ctx.viewer(), a.input),
      updateLeaveType: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        leave.updateType(await ctx.viewer(), a.id, a.input),
      requestLeave: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        shapeLeave(await leave.request(await ctx.viewer(), a.input)),
      cancelLeave: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        shapeLeave(await leave.cancel(await ctx.viewer(), a.id)),
      decideLeave: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeLeave(await leave.decide(await ctx.viewer(), a.id, a.input)),
    },
  };
}
