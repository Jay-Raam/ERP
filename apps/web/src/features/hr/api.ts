'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gqlRequest } from '@/lib/api-client';

export type Status = 'active' | 'inactive';
export type DayStatus =
  | 'present'
  | 'half_day'
  | 'short'
  | 'incomplete'
  | 'leave'
  | 'absent'
  | 'off'
  | 'holiday'
  | 'upcoming';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  joiningDate: string;
  status: Status;
  branch: { id: string; code: string; name: string };
  shiftId: string | null;
  shiftName: string | null;
  userId: string | null;
  userEmail: string | null;
  version: number;
}

export interface Shift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  status: Status;
  version: number;
}

export interface LeaveType {
  id: string;
  code: string;
  name: string;
  annualDays: number;
  paid: boolean;
  status: Status;
  version: number;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  decisionNote: string | null;
  createdAt: string;
  version: number;
}

export interface LeaveBalance {
  leaveType: LeaveType;
  quota: number;
  used: number;
  pending: number;
  remaining: number;
}

export interface AttendanceDay {
  date: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  late: boolean;
  open: boolean;
  holidayName?: string | null;
  punches: { id: string | null; kind: 'in' | 'out'; at: string }[];
}

export interface Today {
  date: string;
  timeZone: string;
  state: 'in' | 'out';
  day: AttendanceDay;
  punches: { id: string; kind: 'in' | 'out'; source: string; at: string; note: string | null }[];
}

const EMPLOYEE_FIELDS = `id employeeCode fullName email phone department designation joiningDate status
  shiftId shiftName userId userEmail version branch { id code name }`;
const SHIFT_FIELDS =
  'id name startTime endTime graceMinutes fullDayMinutes halfDayMinutes status version';
const TYPE_FIELDS = 'id code name annualDays paid status version';
const LEAVE_FIELDS = `id employeeId employeeName employeeCode leaveTypeId leaveTypeName leaveTypeCode
  startDate endDate days reason status decisionNote createdAt version`;
const DAY_FIELDS =
  'date status firstIn lastOut workedMinutes late open holidayName punches { id kind at }';

const keys = {
  employees: ['hr', 'employees'] as const,
  today: ['hr', 'today'] as const,
  attendance: ['hr', 'attendance'] as const,
  shifts: ['hr', 'shifts'] as const,
  calendar: ['hr', 'calendar'] as const,
  leaveTypes: ['hr', 'leave-types'] as const,
  balances: ['hr', 'balances'] as const,
  leave: ['hr', 'leave'] as const,
};

function useAction<TVars, TResult>(
  run: (vars: TVars) => Promise<TResult>,
  invalidate: (readonly string[])[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all(
        invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })),
      );
    },
  });
}

// ---------------------------------------------------------------- employees

export interface EmployeeFilter {
  search: string;
  status: Status | '';
  branchId: string;
  page: number;
}
export const EMPLOYEES_PAGE_SIZE = 20;

export const useEmployees = (filter: EmployeeFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.employees, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ employees: { items: Employee[]; total: number } }>(
          `query($input: ListEmployeesInput){ employees(input:$input){ total items { ${EMPLOYEE_FIELDS} } } }`,
          {
            input: {
              search: filter.search || null,
              status: filter.status || null,
              branchId: filter.branchId || null,
              limit: EMPLOYEES_PAGE_SIZE,
              offset: filter.page * EMPLOYEES_PAGE_SIZE,
            },
          },
        )
      ).employees,
  });

export const useSaveEmployee = () =>
  useAction(
    async (vars: { id?: string; version?: number; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateEmployeeInput!){ updateEmployee(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(
            `mutation($input: CreateEmployeeInput!){ createEmployee(input:$input){ id } }`,
            {
              input: vars.input,
            },
          ),
    [keys.employees, keys.attendance],
  );

// --------------------------------------------------------------- attendance

export const useToday = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: keys.today,
    queryFn: async () =>
      (
        await gqlRequest<{ attendanceToday: (Today & { employee: Employee }) | null }>(
          `{ attendanceToday { date timeZone state day { ${DAY_FIELDS} }
              punches { id kind source at note } employee { ${EMPLOYEE_FIELDS} } } }`,
        )
      ).attendanceToday,
  });

export const usePunch = () =>
  useAction(
    async () => gqlRequest<{ punch: { kind: 'in' | 'out' } }>(`mutation{ punch { kind } }`),
    [keys.today, keys.attendance],
  );

export interface AttendanceReport {
  timeZone: string;
  total: number;
  items: {
    employee: { id: string; employeeCode: string; fullName: string; branch: { code: string } };
    days: AttendanceDay[];
  }[];
}

export const useAttendance = (
  range: { from: string; to: string; employeeId?: string; branchId?: string; page?: number },
  enabled = true,
) =>
  useQuery({
    enabled,
    queryKey: [...keys.attendance, range],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ attendance: AttendanceReport }>(
          `query($input: AttendanceRangeInput!){ attendance(input:$input){ timeZone total items {
            employee { id employeeCode fullName branch { code } } days { ${DAY_FIELDS} } } } }`,
          {
            input: {
              from: range.from,
              to: range.to,
              employeeId: range.employeeId || null,
              branchId: range.branchId || null,
              limit: 25,
              offset: (range.page ?? 0) * 25,
            },
          },
        )
      ).attendance,
  });

export const useManualPunch = () =>
  useAction(
    (input: { employeeId: string; inAt: string | null; outAt: string | null; reason: string }) =>
      gqlRequest(`mutation($input: ManualPunchInput!){ addManualPunch(input:$input) }`, { input }),
    [keys.attendance, keys.today],
  );

export const useShifts = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: keys.shifts,
    queryFn: async () =>
      (await gqlRequest<{ shifts: Shift[] }>(`{ shifts { ${SHIFT_FIELDS} } }`)).shifts,
  });

export const useSaveShift = () =>
  useAction(
    async (vars: { id?: string; version?: number; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateShiftInput!){ updateShift(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(`mutation($input: ShiftInput!){ createShift(input:$input){ id } }`, {
            input: vars.input,
          }),
    [keys.shifts, keys.attendance],
  );

// ----------------------------------------------------------------- calendar

export interface Holiday {
  id: string;
  holidayDate: string;
  name: string;
  version: number;
}

export interface WorkCalendar {
  timeZone: string;
  /** 0 = Sunday … 6 = Saturday. */
  weeklyOffDays: number[];
  year: number;
  holidays: Holiday[];
}

const CALENDAR_FIELDS = 'timeZone weeklyOffDays year holidays { id holidayDate name version }';

/** `year` null asks for the current year (in the organisation's time zone). */
export const useWorkCalendar = (year: number | null, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.calendar, year],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ workCalendar: WorkCalendar }>(
          `query($year: Int){ workCalendar(year:$year){ ${CALENDAR_FIELDS} } }`,
          { year },
        )
      ).workCalendar,
  });

// Days off change what the attendance views show, so those refresh too.
const CALENDAR_INVALIDATES = [keys.calendar, keys.attendance, keys.today];

export const useSaveWeeklyOff = () =>
  useAction(
    (weeklyOffDays: number[]) =>
      gqlRequest(
        `mutation($input: WeeklyOffInput!){ updateWeeklyOff(input:$input){ weeklyOffDays } }`,
        { input: { weeklyOffDays } },
      ),
    CALENDAR_INVALIDATES,
  );

export const useSaveHoliday = () =>
  useAction(
    async (vars: {
      id?: string;
      version?: number;
      input: { holidayDate: string; name: string };
    }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateHolidayInput!){ updateHoliday(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(`mutation($input: HolidayInput!){ createHoliday(input:$input){ id } }`, {
            input: vars.input,
          }),
    CALENDAR_INVALIDATES,
  );

export const useDeleteHoliday = () =>
  useAction(
    (id: string) => gqlRequest(`mutation($id: ID!){ deleteHoliday(id:$id) }`, { id }),
    CALENDAR_INVALIDATES,
  );

// -------------------------------------------------------------------- leave

export const useLeaveTypes = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: keys.leaveTypes,
    queryFn: async () =>
      (await gqlRequest<{ leaveTypes: LeaveType[] }>(`{ leaveTypes { ${TYPE_FIELDS} } }`))
        .leaveTypes,
  });

export const useSaveLeaveType = () =>
  useAction(
    async (vars: { id?: string; version?: number; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateLeaveTypeInput!){ updateLeaveType(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(
            `mutation($input: CreateLeaveTypeInput!){ createLeaveType(input:$input){ id } }`,
            {
              input: vars.input,
            },
          ),
    [keys.leaveTypes, keys.balances],
  );

export const useBalances = (year: number, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.balances, year],
    queryFn: async () =>
      (
        await gqlRequest<{ leaveBalances: { employeeId: string | null; items: LeaveBalance[] } }>(
          `query($input: LeaveBalancesInput){ leaveBalances(input:$input){ employeeId items {
            quota used pending remaining leaveType { ${TYPE_FIELDS} } } } }`,
          { input: { year } },
        )
      ).leaveBalances,
  });

export interface LeaveFilter {
  status: LeaveStatus | '';
  page: number;
}
export const LEAVE_PAGE_SIZE = 20;

export const useLeave = (filter: LeaveFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.leave, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ leaveRequests: { items: LeaveRequest[]; total: number } }>(
          `query($input: ListLeaveInput){ leaveRequests(input:$input){ total items { ${LEAVE_FIELDS} } } }`,
          {
            input: {
              status: filter.status || null,
              limit: LEAVE_PAGE_SIZE,
              offset: filter.page * LEAVE_PAGE_SIZE,
            },
          },
        )
      ).leaveRequests,
  });

export const useRequestLeave = () =>
  useAction(
    (input: { leaveTypeId: string; startDate: string; endDate: string; reason: string }) =>
      gqlRequest(`mutation($input: RequestLeaveInput!){ requestLeave(input:$input){ id } }`, {
        input,
      }),
    [keys.leave, keys.balances, keys.attendance],
  );

export const useCancelLeave = () =>
  useAction(
    (id: string) => gqlRequest(`mutation($id: ID!){ cancelLeave(id:$id){ id } }`, { id }),
    [keys.leave, keys.balances, keys.attendance],
  );

export const useDecideLeave = () =>
  useAction(
    (vars: { id: string; decision: 'approve' | 'reject'; note: string | null; version: number }) =>
      gqlRequest(
        `mutation($id: ID!, $input: DecideLeaveInput!){ decideLeave(id:$id,input:$input){ id } }`,
        {
          id: vars.id,
          input: { decision: vars.decision, note: vars.note, version: vars.version },
        },
      ),
    [keys.leave, keys.balances, keys.attendance],
  );
