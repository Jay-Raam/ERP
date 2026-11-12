import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, version } from './columns';
import { branches, organisations, recordStatus, users } from './tenancy';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'restrict' });

export const punchKind = pgEnum('punch_kind', ['in', 'out']);
export const punchSource = pgEnum('punch_source', ['self', 'manual']);
export const leaveStatus = pgEnum('leave_status', ['pending', 'approved', 'rejected', 'cancelled']);

export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    graceMinutes: integer('grace_minutes').notNull().default(0),
    /** Worked minutes that make a full day. */
    fullDayMinutes: integer('full_day_minutes').notNull().default(480),
    /** Worked minutes that make a half day. */
    halfDayMinutes: integer('half_day_minutes').notNull().default(240),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('shifts_tenant_name_unique').on(t.tenantId, t.name),
    unique('shifts_tenant_id_unique').on(t.tenantId, t.id),
    check('shifts_minutes_order', sql`${t.halfDayMinutes} < ${t.fullDayMinutes}`),
  ],
);

/** Days the whole organisation is closed (Diwali, Republic Day...). Nobody is marked absent on them. */
export const holidays = pgTable(
  'holidays',
  {
    id: id(),
    tenantId: tenantId(),
    holidayDate: date('holiday_date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    ...timestamps,
    version: version(),
  },
  (t) => [unique('holidays_tenant_date_unique').on(t.tenantId, t.holidayDate)],
);

export const employees = pgTable(
  'employees',
  {
    id: id(),
    tenantId: tenantId(),
    employeeCode: text('employee_code').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    branchId: uuid('branch_id').notNull(),
    department: text('department'),
    designation: text('designation'),
    joiningDate: date('joining_date', { mode: 'string' }).notNull(),
    shiftId: uuid('shift_id'),
    /** The sign-in account, if this person has one. At most one employee per user. */
    userId: uuid('user_id'),
    /** Employees are never deleted; they are made inactive. */
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('employees_tenant_code_unique').on(t.tenantId, t.employeeCode),
    unique('employees_tenant_email_unique').on(t.tenantId, t.email),
    unique('employees_tenant_user_unique').on(t.tenantId, t.userId),
    unique('employees_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'employees_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'employees_shift_fk',
      columns: [t.tenantId, t.shiftId],
      foreignColumns: [shifts.tenantId, shifts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'employees_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    index('employees_tenant_branch_idx').on(t.tenantId, t.branchId),
  ],
);

/** Append-only: the application role may insert and read, never update or delete. */
export const attendancePunches = pgTable(
  'attendance_punches',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    punchedAt: timestamp('punched_at', { withTimezone: true }).notNull(),
    kind: punchKind('kind').notNull(),
    source: punchSource('source').notNull(),
    note: text('note'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('punches_employee_time_unique').on(t.tenantId, t.employeeId, t.punchedAt),
    foreignKey({
      name: 'punches_employee_fk',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'punches_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'punches_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    index('punches_tenant_time_idx').on(t.tenantId, t.punchedAt),
  ],
);

export const leaveTypes = pgTable(
  'leave_types',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    annualDays: numeric('annual_days', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    paid: boolean('paid').notNull().default(true),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('leave_types_tenant_code_unique').on(t.tenantId, t.code),
    unique('leave_types_tenant_id_unique').on(t.tenantId, t.id),
    check('leave_types_days_range', sql`${t.annualDays} >= 0 AND ${t.annualDays} <= 366`),
  ],
);

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    leaveTypeId: uuid('leave_type_id').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    /** Calendar days, computed on the server. */
    days: numeric('days', { precision: 5, scale: 1, mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    status: leaveStatus('status').notNull().default('pending'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    check('leave_requests_dates_order', sql`${t.endDate} >= ${t.startDate}`),
    check('leave_requests_days_positive', sql`${t.days} > 0`),
    foreignKey({
      name: 'leave_requests_employee_fk',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'leave_requests_type_fk',
      columns: [t.tenantId, t.leaveTypeId],
      foreignColumns: [leaveTypes.tenantId, leaveTypes.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'leave_requests_decided_by_fk',
      columns: [t.tenantId, t.decidedBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    index('leave_requests_employee_idx').on(t.tenantId, t.employeeId, t.startDate),
  ],
);
