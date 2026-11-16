import { describe, expect, it } from 'vitest';
import {
  adjustPayslipInputSchema,
  cancelPayrollRunInputSchema,
  createPayrollRunInputSchema,
  payPayrollRunInputSchema,
  salaryFormSchema,
  saveSalaryStructureInputSchema,
} from './index';

const id = '123e4567-e89b-42d3-a456-426614174000';

describe('saveSalaryStructureInputSchema', () => {
  it('fills the optional amounts with zero and a first save with no version', () => {
    const v = saveSalaryStructureInputSchema.parse({ employeeId: id, basic: '25000' });
    expect(v).toMatchObject({ hra: '0', allowance: '0', deductions: '0', version: null });
  });

  it('accepts two decimals and nothing more', () => {
    expect(
      saveSalaryStructureInputSchema.safeParse({ employeeId: id, basic: '1250.50' }).success,
    ).toBe(true);
    for (const basic of ['0', '-1', '1.005', '1e3', ' ', '', '100000000', '0x10']) {
      expect(
        saveSalaryStructureInputSchema.safeParse({ employeeId: id, basic }).success,
        basic,
      ).toBe(false);
    }
  });

  it('refuses stray fields and a bad employee id', () => {
    expect(
      saveSalaryStructureInputSchema.safeParse({ employeeId: id, basic: '1', tenantId: id })
        .success,
    ).toBe(false);
    expect(saveSalaryStructureInputSchema.safeParse({ employeeId: 'x', basic: '1' }).success).toBe(
      false,
    );
  });

  it('refuses a gross that is too large to add up safely', () => {
    expect(
      saveSalaryStructureInputSchema.safeParse({
        employeeId: id,
        basic: '99999999.99',
        hra: '99999999.99',
      }).success,
    ).toBe(false);
  });
});

describe('salaryFormSchema', () => {
  it('needs every amount, since an empty field is not zero', () => {
    expect(
      salaryFormSchema.safeParse({ basic: '1000', hra: '', allowance: '0', deductions: '0' })
        .success,
    ).toBe(false);
    expect(
      salaryFormSchema.safeParse({ basic: '1000', hra: '0', allowance: '0', deductions: '0' })
        .success,
    ).toBe(true);
  });
});

describe('createPayrollRunInputSchema', () => {
  it('takes a month and nothing else', () => {
    expect(createPayrollRunInputSchema.safeParse({ month: '2026-10' }).success).toBe(true);
    for (const month of ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', 'October']) {
      expect(createPayrollRunInputSchema.safeParse({ month }).success, month).toBe(false);
    }
    expect(createPayrollRunInputSchema.safeParse({ month: '2026-10', extra: 1 }).success).toBe(
      false,
    );
  });
});

describe('payroll decisions', () => {
  it('needs a version, a method, a date and a reason where they apply', () => {
    expect(adjustPayslipInputSchema.parse({ version: 1 })).toMatchObject({
      bonus: '0',
      otherDeductions: '0',
    });
    expect(adjustPayslipInputSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(
      payPayrollRunInputSchema.safeParse({ version: 2, method: 'cash', paidOn: '2026-11-05' })
        .success,
    ).toBe(true);
    expect(
      payPayrollRunInputSchema.safeParse({ version: 2, method: 'barter', paidOn: '2026-11-05' })
        .success,
    ).toBe(false);
    expect(
      payPayrollRunInputSchema.safeParse({ version: 2, method: 'cash', paidOn: '2026-02-30' })
        .success,
    ).toBe(false);
    expect(cancelPayrollRunInputSchema.safeParse({ version: 1, reason: '' }).success).toBe(false);
    expect(
      cancelPayrollRunInputSchema.safeParse({ version: 1, reason: 'Wrong month' }).success,
    ).toBe(true);
  });
});
