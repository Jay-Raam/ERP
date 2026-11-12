import { z } from 'zod';
import { emailSchema } from './auth';
import { cleanText, plainText } from './text';

const uuid = z.uuid('Invalid id');
const nullishUuid = uuid.nullish().transform((v) => v ?? null);

/** A single-line optional text field: blank becomes null, markup is rejected. */
function optionalText(label: string, max: number) {
  return z
    .string()
    .nullish()
    .transform((v) => (v === null || v === undefined ? null : cleanText(v) || null))
    .pipe(
      z
        .string()
        .max(max, `${label} must be at most ${max} characters`)
        .regex(/^[^<>]*$/, `${label} cannot contain < or >`)
        .nullable(),
    );
}

export const dateSchema = z.iso.date('Use a date like 2026-11-30');

/** Calendar days from `from` to `to`, inclusive. */
export function daysInclusive(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

const nullishInt = (min: number, max: number, fallback: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => v ?? fallback);

const pageFields = {
  limit: nullishInt(1, 100, 25),
  offset: nullishInt(0, 100_000, 0),
};

// ----------------------------------------------------------------- employees

export const employeeCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Code must be at least 2 characters')
  .max(20, 'Code must be at most 20 characters')
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Use letters, numbers and hyphens only');

const employeeFields = {
  fullName: plainText('Full name', 2, 120),
  email: z
    .string()
    .nullish()
    .transform((v) => (v === null || v === undefined || v.trim() === '' ? null : v))
    .pipe(emailSchema.nullable()),
  phone: z
    .string()
    .nullish()
    .transform((v) =>
      v === null || v === undefined || v.trim() === '' ? null : v.replace(/[\s-]/g, ''),
    )
    .pipe(
      z
        .string()
        .regex(/^\+?[0-9]{7,15}$/, 'Enter a valid phone number')
        .nullable(),
    ),
  branchId: uuid,
  department: optionalText('Department', 80),
  designation: optionalText('Designation', 80),
  joiningDate: dateSchema,
  shiftId: nullishUuid,
  userId: nullishUuid,
};

export const createEmployeeInputSchema = z.strictObject({
  employeeCode: employeeCodeSchema,
  ...employeeFields,
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeInputSchema>;

export const updateEmployeeInputSchema = z.strictObject({
  ...employeeFields,
  status: z.enum(['active', 'inactive']),
  version: z.number().int().min(1),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeInputSchema>;

export const listEmployeesInputSchema = z.strictObject({
  search: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((v) => (v ? v : undefined)),
  status: z
    .enum(['active', 'inactive'])
    .nullish()
    .transform((v) => v ?? undefined),
  branchId: uuid.nullish().transform((v) => v ?? undefined),
  ...pageFields,
});

// ------------------------------------------------------------------- shifts

const timeOfDay = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use a time like 09:30');

const shiftFields = {
  name: plainText('Shift name', 2, 60),
  startTime: timeOfDay,
  endTime: timeOfDay,
  graceMinutes: z.number().int().min(0).max(120),
  fullDayMinutes: z.number().int().min(60).max(960),
  halfDayMinutes: z.number().int().min(30).max(960),
};

function checkShift(
  v: { fullDayMinutes: number; halfDayMinutes: number },
  ctx: z.RefinementCtx,
): void {
  if (v.halfDayMinutes >= v.fullDayMinutes) {
    ctx.addIssue({
      code: 'custom',
      path: ['halfDayMinutes'],
      message: 'Half day must be shorter than a full day',
    });
  }
}

export const createShiftInputSchema = z.strictObject(shiftFields).superRefine(checkShift);
export const updateShiftInputSchema = z
  .strictObject({
    ...shiftFields,
    status: z.enum(['active', 'inactive']),
    version: z.number().int().min(1),
  })
  .superRefine(checkShift);

// --------------------------------------------------------------- attendance

export const punchInputSchema = z.strictObject({
  note: optionalText('Note', 200),
});

const punchTime = z.iso.datetime({ offset: true, message: 'Use a date and time' });

/**
 * A missed session: the "in", the "out", or both. Entering both at once is what
 * lets someone back-fill a whole missed day, which two separate entries could not
 * (a lone "in" would leave the sequence broken until its "out" arrived).
 */
export const manualPunchInputSchema = z
  .strictObject({
    employeeId: uuid,
    inAt: punchTime.nullish().transform((v) => v ?? null),
    outAt: punchTime.nullish().transform((v) => v ?? null),
    reason: plainText('Reason', 3, 200),
  })
  .superRefine((v, ctx) => {
    if (!v.inAt && !v.outAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['inAt'],
        message: 'Enter an in time, an out time, or both',
      });
    }
    if (v.inAt && v.outAt && Date.parse(v.outAt) <= Date.parse(v.inAt)) {
      ctx.addIssue({ code: 'custom', path: ['outAt'], message: 'Out must be after in' });
    }
  });

export const MAX_ATTENDANCE_DAYS = 62;

export const attendanceRangeInputSchema = z
  .strictObject({
    from: dateSchema,
    to: dateSchema,
    employeeId: uuid.nullish().transform((v) => v ?? undefined),
    branchId: uuid.nullish().transform((v) => v ?? undefined),
    limit: nullishInt(1, 100, 50),
    offset: nullishInt(0, 100_000, 0),
  })
  .superRefine((v, ctx) => {
    const days = daysInclusive(v.from, v.to);
    if (days < 1) ctx.addIssue({ code: 'custom', path: ['to'], message: 'End is before start' });
    if (days > MAX_ATTENDANCE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `Choose at most ${MAX_ATTENDANCE_DAYS} days`,
      });
    }
  });

// -------------------------------------------------------------------- leave

const leaveTypeFields = {
  name: plainText('Leave type', 2, 60),
  annualDays: z.number().min(0).max(366).multipleOf(0.5),
  paid: z.boolean(),
};

export const leaveCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Code is required')
  .max(8, 'Code must be at most 8 characters')
  .regex(/^[A-Z0-9]+$/, 'Use letters and numbers only');

export const createLeaveTypeInputSchema = z.strictObject({
  code: leaveCodeSchema,
  ...leaveTypeFields,
});
export const updateLeaveTypeInputSchema = z.strictObject({
  ...leaveTypeFields,
  status: z.enum(['active', 'inactive']),
  version: z.number().int().min(1),
});

export const MAX_LEAVE_DAYS = 60;

export const requestLeaveInputSchema = z
  .strictObject({
    leaveTypeId: uuid,
    startDate: dateSchema,
    endDate: dateSchema,
    reason: plainText('Reason', 3, 300),
  })
  .superRefine((v, ctx) => {
    const days = daysInclusive(v.startDate, v.endDate);
    if (days < 1)
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End is before start' });
    if (days > MAX_LEAVE_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: `Request at most ${MAX_LEAVE_DAYS} days at a time`,
      });
    }
  });

export const decideLeaveInputSchema = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  note: optionalText('Note', 200),
  version: z.number().int().min(1),
});

export const listLeaveInputSchema = z.strictObject({
  status: z
    .enum(['pending', 'approved', 'rejected', 'cancelled'])
    .nullish()
    .transform((v) => v ?? undefined),
  employeeId: uuid.nullish().transform((v) => v ?? undefined),
  limit: nullishInt(1, 100, 25),
  offset: nullishInt(0, 100_000, 0),
});

export const leaveYearSchema = z
  .number()
  .int()
  .min(2000)
  .max(2100)
  .nullish()
  .transform((v) => v ?? new Date().getUTCFullYear());
