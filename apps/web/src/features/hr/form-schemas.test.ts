import {
  updateEmployeeInputSchema,
  updateLeaveTypeInputSchema,
  updateShiftInputSchema,
} from '@erp/shared';
import { describe, expect, it } from 'vitest';

// Regression guards for two edit-form crashes found in the browser:
// zod cannot .omit() from a schema with refinements, and strict schemas reject stray keys.
describe('edit form schemas', () => {
  it('shift edit schema parses the form shape (version kept, no omit needed)', () => {
    const shape = {
      name: 'Evening',
      startTime: '14:00',
      endTime: '22:00',
      graceMinutes: 5,
      fullDayMinutes: 480,
      halfDayMinutes: 240,
      status: 'active',
      version: 2,
    };
    expect(updateShiftInputSchema.safeParse(shape).success).toBe(true);
    expect(updateShiftInputSchema.safeParse({ ...shape, halfDayMinutes: 500 }).success).toBe(false);
  });

  it('leave type edit schema rejects a code key, so the form must not carry one', () => {
    const base = { name: 'Comp off', annualDays: 8, paid: true, status: 'active' as const };
    expect(updateLeaveTypeInputSchema.omit({ version: true }).safeParse(base).success).toBe(true);
    expect(
      updateLeaveTypeInputSchema.omit({ version: true }).safeParse({ ...base, code: 'COMP' })
        .success,
    ).toBe(false);
  });

  it('employee edit schema can be omitted from at load time', () => {
    expect(() => updateEmployeeInputSchema.omit({ version: true })).not.toThrow();
  });
});
