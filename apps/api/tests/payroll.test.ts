import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, registerOrg, testApp } from './helpers';
import {
  CREATE_HOLIDAY,
  CREATE_ROLE,
  MANUAL,
  buildCompany,
  code,
  q,
  type Agent,
  type Org,
  type Person,
} from './hr-support';

// The clock stands on 12 Nov 2026, so October 2026 (31 days, four Sundays) is a finished month.
const NOW = new Date('2026-11-12T10:00:00Z');
const app = testApp({ now: () => NOW });
afterAll(() => database.close());

const RUN = `id periodStart periodEnd label status notes employeeCount grossTotal deductionsTotal netTotal version preparedByName approvedByName approvedAt paidByName paidOn payMethod payReference cancelReason approveEntryId payEntryId cancelEntryId incompleteCount cappedCount`;
const SLIP = `id runId employeeId employeeCode employeeName basic hra allowance daysInPeriod paidHalfDays presentDays halfDays leaveDays offDays holidayDays absentDays shortDays incompleteDays fullGross earned bonus plannedDeductions deductions otherDeductions deductionsCapped adjustmentNote netPay`;
const STRUCT = `employeeId employeeCode employeeName branch { id code } basic hra allowance deductions version`;

const SAVE = `mutation($i: SaveSalaryStructureInput!){ saveSalaryStructure(input:$i){ ${STRUCT} } }`;
const STRUCTURES = `query($i: ListSalaryStructuresInput){ salaryStructures(input:$i){ total items { ${STRUCT} } } }`;
const CREATE = `mutation($i: CreatePayrollRunInput!){ createPayrollRun(input:$i){ run { ${RUN} } skipped { employeeId employeeCode reason } } }`;
const RECALC = `mutation($id: ID!, $i: PayrollVersionInput!){ recalculatePayrollRun(id:$id,input:$i){ run { ${RUN} } skipped { employeeId reason } } }`;
const ADJUST = `mutation($id: ID!, $i: AdjustPayslipInput!){ adjustPayslip(id:$id,input:$i){ ${SLIP} } }`;
const APPROVE = `mutation($id: ID!, $i: PayrollVersionInput!){ approvePayrollRun(id:$id,input:$i){ ${RUN} } }`;
const PAY = `mutation($id: ID!, $i: PayPayrollRunInput!){ payPayrollRun(id:$id,input:$i){ ${RUN} } }`;
const CANCEL = `mutation($id: ID!, $i: CancelPayrollRunInput!){ cancelPayrollRun(id:$id,input:$i){ ${RUN} } }`;
const GET = `query($id: ID!){ payrollRun(id:$id){ ${RUN} } }`;
const RUNS = `query($i: ListPayrollRunsInput){ payrollRuns(input:$i){ total items { id label status } } }`;
const SLIPS = `query($i: ListPayslipsInput!){ payslips(input:$i){ total items { ${SLIP} } } }`;
const MINE = `query($i: MyPayslipsInput){ myPayslips(input:$i){ total items { id periodStart periodEnd runStatus paidOn employeeCode netPay earned bonus deductions } } }`;
const ENTRY = `query($id: ID!){ journalEntry(id:$id){ id entryDate sourceType sourceId reversalOf total lines { account { code } debit credit } } }`;
const TRIAL = `{ trialBalance { balanced rows { code debit credit } } }`;

type Run = {
  id: string;
  status: string;
  version: number;
  label: string;
  employeeCount: number;
  grossTotal: string;
  deductionsTotal: string;
  netTotal: string;
  approveEntryId: string | null;
  payEntryId: string | null;
  cancelEntryId: string | null;
  incompleteCount: number | null;
  cappedCount: number | null;
};
type Slip = {
  id: string;
  employeeId: string;
  earned: string;
  bonus: string;
  deductions: string;
  otherDeductions: string;
  deductionsCapped: boolean;
  netPay: string;
  paidHalfDays: number;
  presentDays: number;
  absentDays: number;
  offDays: number;
  holidayDays: number;
  daysInPeriod: number;
  plannedDeductions: string;
  adjustmentNote: string | null;
};

const PREPARER = [
  'payroll.structure.view',
  'payroll.structure.manage',
  'payroll.run.view',
  'payroll.run.prepare',
  'payroll.run.pay',
];
const APPROVER = ['payroll.run.view', 'payroll.run.approve', 'accounts.journal.view'];
const VIEWER = ['payroll.run.view', 'payroll.structure.view'];

let company: Awaited<ReturnType<typeof buildCompany>>;
let prep: Person;
let appr: Person;
let viewer: Person;
let branchy: Person;
let plain: Person;
let ann: Person; // Rs 40,000 gross, Rs 500 deduction, present five days
let bob: Person; // Rs 15,000 gross, Rs 3,000 deduction, never punches
let eve: Person; // joined 20 Oct 2026, Rs 31,000 gross
let dev: Person; // no structure
let both: Person; // may prepare and approve
let october: Run;
let other: Awaited<ReturnType<typeof buildCompany>>;
let otherOrg: Org;
const owner = () => company.owner;

async function must<T>(res: { body: { errors?: unknown; data: T } }) {
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  return res.body.data;
}

const paise = (v: string) => Math.round(Number(v) * 100);

async function setSalary(
  who: Person,
  v: { basic: string; hra?: string; allowance?: string; deductions?: string },
  version: number | null = null,
  as: Agent = prep.agent,
) {
  return q(as, SAVE, { i: { employeeId: who.employeeId, version, ...v } });
}

async function create(month: string, as: Agent = prep.agent) {
  const d = (await must(await q(as, CREATE, { i: { month } }))) as {
    createPayrollRun: { run: Run; skipped: { employeeId: string; employeeCode: string }[] };
  };
  return d.createPayrollRun;
}

async function getRun(id: string, as: Agent = owner()) {
  return ((await must(await q(as, GET, { id }))) as { payrollRun: Run }).payrollRun;
}

async function slips(runId: string, as: Agent = prep.agent) {
  const d = (await must(await q(as, SLIPS, { i: { runId, limit: 100 } }))) as {
    payslips: { total: number; items: Slip[] };
  };
  return Object.fromEntries(d.payslips.items.map((s) => [s.employeeId, s]));
}

async function trial() {
  const d = (await must(await q(owner(), TRIAL))) as {
    trialBalance: { balanced: boolean; rows: { code: string; debit: string; credit: string }[] };
  };
  expect(d.trialBalance.balanced).toBe(true);
  // net position per account in paise, debit positive
  return Object.fromEntries(
    d.trialBalance.rows.map((r) => [r.code, paise(r.debit) - paise(r.credit)]),
  ) as Record<string, number>;
}

const approve = async (run: Run, as: Agent = appr.agent) =>
  (
    (await must(await q(as, APPROVE, { id: run.id, i: { version: run.version } }))) as {
      approvePayrollRun: Run;
    }
  ).approvePayrollRun;

beforeAll(async () => {
  otherOrg = await registerOrg(app);
  const org: Org = await registerOrg(app);
  company = await buildCompany(app, org);
  const mkRole = async (name: string, dataScope: string, permissions: string[]) => {
    const res = await q(owner(), CREATE_ROLE, { i: { name, dataScope, permissions } });
    expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
    return res.body.data.createRole.id as string;
  };
  company.roleId.prep = await mkRole('Payroll clerk', 'organisation', PREPARER);
  company.roleId.appr = await mkRole('Payroll approver', 'organisation', APPROVER);
  company.roleId.viewer = await mkRole('Payroll viewer', 'organisation', VIEWER);
  company.roleId.both = await mkRole('Payroll all-rounder', 'organisation', [
    ...PREPARER,
    'payroll.run.approve',
  ]);
  company.roleId.branchy = await mkRole('Branch payroll', 'branch', PREPARER);
  prep = await company.person({ role: 'prep', branch: company.ho, name: 'Priya Payroll' });
  appr = await company.person({ role: 'appr', branch: company.ho, name: 'Arun Approver' });
  viewer = await company.person({ role: 'viewer', branch: company.ho, name: 'Vani Viewer' });
  both = await company.person({ role: 'both', branch: company.ho, name: 'Both Roles' });
  branchy = await company.person({ role: 'branchy', branch: company.ho, name: 'Bala Branch' });
  plain = await company.person({ role: 'employee', branch: company.ho, name: 'Plain Person' });
  ann = await company.person({ role: 'employee', branch: company.ho, name: 'Ann Employee' });
  bob = await company.person({ role: 'employee', branch: company.br2, name: 'Bob Employee' });
  eve = await company.person({
    role: 'employee',
    branch: company.ho,
    name: 'Eve Newjoiner',
    joiningDate: '2026-10-20',
  });
  dev = await company.person({ role: 'employee', branch: company.ho, name: 'Dev Nosalary' });
  other = await buildCompany(app, otherOrg);

  // 2 Oct 2026 is a company holiday; Sundays are the weekly off.
  await must(
    await q(owner(), CREATE_HOLIDAY, { i: { holidayDate: '2026-10-02', name: 'Gandhi Jayanti' } }),
  );
  // Ann works five days in October: the 1st, and the 5th to the 8th.
  for (const day of ['01', '05', '06', '07', '08']) {
    await must(
      await q(owner(), MANUAL, {
        i: {
          employeeId: ann.employeeId,
          inAt: `2026-10-${day}T09:00:00+05:30`,
          outAt: `2026-10-${day}T18:00:00+05:30`,
          reason: 'Test data',
        },
      }),
    );
  }
});

describe('payroll: permissions', () => {
  it('rejects a plain employee on every payroll query and mutation', async () => {
    const dummy = '00000000-0000-4000-8000-000000000001';
    expect(code(await q(plain.agent, STRUCTURES))).toBe('FORBIDDEN');
    expect(code(await q(plain.agent, RUNS))).toBe('FORBIDDEN');
    expect(code(await q(plain.agent, GET, { id: dummy }))).toBe('FORBIDDEN');
    expect(code(await q(plain.agent, SLIPS, { i: { runId: dummy } }))).toBe('FORBIDDEN');
    expect(code(await q(plain.agent, CREATE, { i: { month: '2026-10' } }))).toBe('FORBIDDEN');
    expect(code(await q(plain.agent, SAVE, { i: { employeeId: dummy, basic: '1' } }))).toBe(
      'FORBIDDEN',
    );
    expect(code(await q(plain.agent, APPROVE, { id: dummy, i: { version: 1 } }))).toBe('FORBIDDEN');
    expect(
      code(
        await q(plain.agent, PAY, {
          id: dummy,
          i: { version: 1, method: 'cash', paidOn: '2026-11-01' },
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(code(await q(plain.agent, CANCEL, { id: dummy, i: { version: 1, reason: 'no' } }))).toBe(
      'FORBIDDEN',
    );
    expect(code(await q(plain.agent, ADJUST, { id: dummy, i: { version: 1 } }))).toBe('FORBIDDEN');
  });

  it('lets a viewer look but not change anything', async () => {
    expect(await must(await q(viewer.agent, STRUCTURES))).toBeTruthy();
    expect(await must(await q(viewer.agent, RUNS))).toBeTruthy();
    expect(code(await q(viewer.agent, CREATE, { i: { month: '2026-10' } }))).toBe('FORBIDDEN');
    expect(
      code(await q(viewer.agent, SAVE, { i: { employeeId: ann.employeeId, basic: '1' } })),
    ).toBe('FORBIDDEN');
  });

  it('keeps preparing and approving apart', async () => {
    const dummy = '00000000-0000-4000-8000-000000000001';
    expect(code(await q(prep.agent, APPROVE, { id: dummy, i: { version: 1 } }))).toBe('FORBIDDEN');
    expect(code(await q(appr.agent, CREATE, { i: { month: '2026-10' } }))).toBe('FORBIDDEN');
    expect(
      code(
        await q(appr.agent, PAY, {
          id: dummy,
          i: { version: 1, method: 'cash', paidOn: '2026-11-01' },
        }),
      ),
    ).toBe('FORBIDDEN');
  });

  it('needs organisation-wide access, even with every payroll permission', async () => {
    const res = await q(branchy.agent, STRUCTURES);
    expect(code(res)).toBe('FORBIDDEN');
    expect(res.body.errors[0].message).toMatch(/organisation-wide/);
    expect(code(await q(branchy.agent, RUNS))).toBe('FORBIDDEN');
    expect(code(await q(branchy.agent, CREATE, { i: { month: '2026-10' } }))).toBe('FORBIDDEN');
  });
});

describe('salary structures', () => {
  it('lists active employees with and without a salary', async () => {
    const d = (await must(await q(prep.agent, STRUCTURES, { i: { limit: 100 } }))) as {
      salaryStructures: { total: number; items: { employeeId: string; basic: string | null }[] };
    };
    const mine = d.salaryStructures.items.find((i) => i.employeeId === ann.employeeId);
    expect(mine?.basic).toBeNull();
    expect(d.salaryStructures.total).toBeGreaterThanOrEqual(9);
  });

  it('refuses to prepare a payroll while nobody has a salary, and leaves no run behind', async () => {
    const res = await q(prep.agent, CREATE, { i: { month: '2026-10' } });
    expect(code(res)).toBe('BUSINESS_RULE');
    expect(res.body.errors[0].message).toMatch(/salary structure/i);
    const runs = (await must(await q(prep.agent, RUNS))) as { payrollRuns: { total: number } };
    expect(runs.payrollRuns.total).toBe(0);
  });

  it('sets a salary for the first time, then changes it with the version', async () => {
    const first = (await must(
      await setSalary(ann, { basic: '30000', hra: '10000', allowance: '0', deductions: '500' }),
    )) as { saveSalaryStructure: { basic: string; hra: string; version: number } };
    expect(first.saveSalaryStructure).toMatchObject({
      basic: '30000.00',
      hra: '10000.00',
      version: 1,
    });

    const second = (await must(
      await setSalary(ann, { basic: '30000', hra: '10000', deductions: '500' }, 1),
    )) as { saveSalaryStructure: { version: number } };
    expect(second.saveSalaryStructure.version).toBe(2);
  });

  it('refuses a stale version, and a second "first" save', async () => {
    expect(code(await setSalary(ann, { basic: '31000' }, 1))).toBe('CONFLICT');
    expect(code(await setSalary(ann, { basic: '31000' }, null))).toBe('CONFLICT');
  });

  it('validates every amount', async () => {
    const bad = async (v: Record<string, unknown>) =>
      code(await q(prep.agent, SAVE, { i: { employeeId: bob.employeeId, ...v } }));
    expect(await bad({ basic: '0' })).toBe('VALIDATION_ERROR');
    expect(await bad({ basic: '-5' })).toBe('VALIDATION_ERROR');
    expect(await bad({ basic: '' })).toBe('VALIDATION_ERROR');
    expect(await bad({ basic: '1e5' })).toBe('VALIDATION_ERROR');
    expect(await bad({ basic: '100.999' })).toBe('VALIDATION_ERROR');
    expect(await bad({ basic: '100000000' })).toBe('VALIDATION_ERROR');
    expect(await bad({ basic: '1000', hra: '-1' })).toBe('VALIDATION_ERROR');
    expect(await bad({ basic: '1000', deductions: '1000.01' })).toBe('VALIDATION_ERROR');
    expect(await bad({ employeeId: 'nope', basic: '1000' })).toBe('VALIDATION_ERROR');
  });

  it('does not find an employee of another organisation', async () => {
    const outsider = await other.person({ role: 'employee', branch: other.ho, name: 'Outsider' });
    const res = await q(prep.agent, SAVE, {
      i: { employeeId: outsider.employeeId, basic: '1000' },
    });
    expect(code(res)).toBe('NOT_FOUND');
  });

  it('sets the rest and filters the ones still missing', async () => {
    await must(await setSalary(bob, { basic: '15000', deductions: '3000' }));
    await must(await setSalary(eve, { basic: '31000' }));
    const d = (await must(
      await q(prep.agent, STRUCTURES, { i: { missingOnly: true, limit: 100 } }),
    )) as { salaryStructures: { items: { employeeId: string }[] } };
    const ids = d.salaryStructures.items.map((i) => i.employeeId);
    expect(ids).toContain(dev.employeeId);
    expect(ids).not.toContain(ann.employeeId);
    expect(ids).not.toContain(bob.employeeId);
  });
});

describe('preparing a run', () => {
  it('only prepares a month that has finished', async () => {
    for (const month of ['2026-11', '2026-12', '2027-01']) {
      expect(code(await q(prep.agent, CREATE, { i: { month } }))).toBe('VALIDATION_ERROR');
    }
    for (const month of ['2026-13', '2026-00', 'October', '', '2026-1', '2026-10-01']) {
      expect(code(await q(prep.agent, CREATE, { i: { month } }))).toBe('VALIDATION_ERROR');
    }
    expect(
      code(await q(prep.agent, CREATE, { i: { month: '2026-10', surprise: true } })),
    ).toBeDefined();
  });

  it('works out each payslip from attendance and the salary', async () => {
    const made = await create('2026-10');
    october = made.run;
    expect(october).toMatchObject({
      status: 'draft',
      label: 'October 2026',
      employeeCount: 3,
      version: expect.any(Number),
    });
    // The people with no salary are listed, not silently dropped.
    expect(made.skipped.map((s) => s.employeeId)).toContain(dev.employeeId);
    expect(made.skipped.map((s) => s.employeeId)).not.toContain(ann.employeeId);

    const s = await slips(october.id);
    const a = s[ann.employeeId]!;
    // Four Sundays and the holiday are paid, plus five days worked: 10 days = 20 half days.
    expect(a).toMatchObject({
      daysInPeriod: 31,
      presentDays: 5,
      offDays: 4,
      holidayDays: 1,
      paidHalfDays: 20,
      earned: '12903.23', // 40000 x 10 / 31
      deductions: '500.00',
      plannedDeductions: '500.00',
      deductionsCapped: false,
      netPay: '12403.23',
    });

    const b = s[bob.employeeId]!;
    // Never punched: only the Sundays and the holiday are paid, and the fixed deduction is cut down.
    expect(b).toMatchObject({
      absentDays: 26,
      paidHalfDays: 10,
      earned: '2419.35', // 15000 x 5 / 31
      deductions: '2419.35',
      plannedDeductions: '3000.00',
      deductionsCapped: true,
      netPay: '0.00',
    });

    const e = s[eve.employeeId]!;
    // Joined on the 20th: the days before are not counted. 25 Oct is a Sunday, so one paid day.
    expect(e).toMatchObject({ offDays: 1, paidHalfDays: 2, earned: '1000.00', netPay: '1000.00' });

    expect(october).toMatchObject({
      grossTotal: '16322.58',
      deductionsTotal: '2919.35',
      netTotal: '13403.23',
    });
  });

  it('puts the same month in only once', async () => {
    const res = await q(prep.agent, CREATE, { i: { month: '2026-10' } });
    expect(code(res)).toBe('BUSINESS_RULE');
    expect(res.body.errors[0].message).toMatch(/already exists/);
  });

  it('warns about capped deductions on the run', async () => {
    const run = await getRun(october.id);
    expect(run.cappedCount).toBe(1);
    expect(run.incompleteCount).toBe(0);
  });

  it('adjusts one payslip with a bonus', async () => {
    const a = (await slips(october.id))[ann.employeeId]!;
    const run = await getRun(october.id);
    const d = (await must(
      await q(prep.agent, ADJUST, {
        id: a.id,
        i: { version: run.version, bonus: '1000', otherDeductions: '0', note: 'Diwali' },
      }),
    )) as { adjustPayslip: Slip };
    expect(d.adjustPayslip).toMatchObject({
      bonus: '1000.00',
      adjustmentNote: 'Diwali',
      netPay: '13403.23',
    });
    october = await getRun(october.id);
    expect(october).toMatchObject({
      grossTotal: '17322.58',
      deductionsTotal: '2919.35',
      netTotal: '14403.23',
    });
  });

  it('refuses an adjustment on a stale run, or one that cannot be taken', async () => {
    const s = await slips(october.id);
    const a = s[ann.employeeId]!;
    const b = s[bob.employeeId]!;
    expect(code(await q(prep.agent, ADJUST, { id: a.id, i: { version: 1, bonus: '5' } }))).toBe(
      'CONFLICT',
    );
    // Bob has nothing left to deduct from.
    const tooMuch = await q(prep.agent, ADJUST, {
      id: b.id,
      i: { version: october.version, bonus: '0', otherDeductions: '10' },
    });
    expect(code(tooMuch)).toBe('VALIDATION_ERROR');
    for (const bad of [{ bonus: '-1' }, { bonus: 'x' }, { otherDeductions: '1.234' }]) {
      expect(
        code(await q(prep.agent, ADJUST, { id: a.id, i: { version: october.version, ...bad } })),
      ).toBe('VALIDATION_ERROR');
    }
    expect(
      code(
        await q(prep.agent, ADJUST, {
          id: '00000000-0000-4000-8000-000000000009',
          i: { version: october.version },
        }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('recalculates from the latest salaries and keeps the bonus', async () => {
    // Eve gets a rise: 62000 instead of 31000.
    await must(await setSalary(eve, { basic: '62000' }, 1));
    const run = await getRun(october.id);
    const d = (await must(
      await q(prep.agent, RECALC, { id: run.id, i: { version: run.version } }),
    )) as {
      recalculatePayrollRun: { run: Run };
    };
    october = d.recalculatePayrollRun.run;
    const s = await slips(october.id);
    expect(s[eve.employeeId]!).toMatchObject({ earned: '2000.00' });
    expect(s[ann.employeeId]!).toMatchObject({ bonus: '1000.00', adjustmentNote: 'Diwali' });
    // Back to the original salary, and again.
    await must(await setSalary(eve, { basic: '31000' }, 2));
    const d2 = (await must(
      await q(prep.agent, RECALC, { id: october.id, i: { version: october.version } }),
    )) as { recalculatePayrollRun: { run: Run } };
    october = d2.recalculatePayrollRun.run;
    expect(october).toMatchObject({ grossTotal: '17322.58', netTotal: '14403.23' });
    expect(code(await q(prep.agent, RECALC, { id: october.id, i: { version: 1 } }))).toBe(
      'CONFLICT',
    );
  });

  it('cancels a draft, after which the month can be prepared again', async () => {
    const sept = await create('2026-09');
    expect(sept.run.employeeCount).toBe(2); // Eve had not joined yet
    const res = await q(prep.agent, CANCEL, {
      id: sept.run.id,
      i: { version: sept.run.version, reason: 'Wrong salaries' },
    });
    const cancelled = (await must(res)) as { cancelPayrollRun: Run };
    expect(cancelled.cancelPayrollRun).toMatchObject({ status: 'cancelled', cancelEntryId: null });
    expect(
      code(
        await q(prep.agent, CANCEL, {
          id: sept.run.id,
          i: { version: cancelled.cancelPayrollRun.version, reason: 'again' },
        }),
      ),
    ).toBe('BUSINESS_RULE');
    const again = await create('2026-09');
    expect(again.run.id).not.toBe(sept.run.id);
  });

  it('keeps the list in month order and filters by status', async () => {
    const all = (await must(await q(prep.agent, RUNS, { i: { limit: 50 } }))) as {
      payrollRuns: { total: number; items: { label: string; status: string }[] };
    };
    expect(all.payrollRuns.items.map((i) => i.label)).toEqual([
      'October 2026',
      'September 2026',
      'September 2026',
    ]);
    const cancelled = (await must(await q(prep.agent, RUNS, { i: { status: 'cancelled' } }))) as {
      payrollRuns: { total: number };
    };
    expect(cancelled.payrollRuns.total).toBe(1);
  });

  it('searches payslips', async () => {
    const d = (await must(
      await q(prep.agent, SLIPS, { i: { runId: october.id, search: 'Newjoiner' } }),
    )) as { payslips: { total: number; items: Slip[] } };
    expect(d.payslips.total).toBe(1);
  });

  it('keeps payroll out of reach of other organisations', async () => {
    expect(code(await q(other.owner, GET, { id: october.id }))).toBe('NOT_FOUND');
    expect(code(await q(other.owner, SLIPS, { i: { runId: october.id } }))).toBe('NOT_FOUND');
    expect(
      code(await q(other.owner, APPROVE, { id: october.id, i: { version: october.version } })),
    ).toBe('NOT_FOUND');
    const runs = (await must(await q(other.owner, RUNS))) as { payrollRuns: { total: number } };
    expect(runs.payrollRuns.total).toBe(0);
    const structures = (await must(await q(other.owner, STRUCTURES, { i: { limit: 100 } }))) as {
      salaryStructures: { items: { employeeId: string }[] };
    };
    expect(structures.salaryStructures.items.map((i) => i.employeeId)).not.toContain(
      ann.employeeId,
    );
  });
});

describe('approval, payment and cancellation', () => {
  let before: Record<string, number>;
  let approved: Run;
  let paid: Run;

  it('is not approved by the person who prepared it', async () => {
    const aug = await create('2026-08', both.agent);
    const res = await q(both.agent, APPROVE, { id: aug.run.id, i: { version: aug.run.version } });
    expect(code(res)).toBe('BUSINESS_RULE');
    expect(res.body.errors[0].message).toMatch(/Someone else/);
    expect((await getRun(aug.run.id)).status).toBe('draft');
    // Someone else can, and a stale version cannot.
    expect(code(await q(appr.agent, APPROVE, { id: aug.run.id, i: { version: 1 } }))).toBe(
      'CONFLICT',
    );
    expect(await approve(aug.run)).toMatchObject({ status: 'approved' });
  });

  it('cancels an approved run with a reversing entry, and only for someone who can approve', async () => {
    const augRun = (
      (await must(await q(owner(), RUNS, { i: { status: 'approved' } }))) as {
        payrollRuns: { items: { id: string }[] };
      }
    ).payrollRuns.items[0]!;
    const aug = await getRun(augRun.id);
    expect(aug.approveEntryId).toBeTruthy();
    const net = await trial();
    expect(net['5200']).toBeGreaterThan(0);

    // The clerk may prepare but cannot undo posted books.
    expect(
      code(
        await q(prep.agent, CANCEL, { id: aug.id, i: { version: aug.version, reason: 'Oops' } }),
      ),
    ).toBe('FORBIDDEN');
    // The approver cannot prepare, which cancelling starts with.
    expect(
      code(
        await q(appr.agent, CANCEL, { id: aug.id, i: { version: aug.version, reason: 'Oops' } }),
      ),
    ).toBe('FORBIDDEN');

    const res = (await must(
      await q(both.agent, CANCEL, {
        id: aug.id,
        i: { version: aug.version, reason: 'Wrong month' },
      }),
    )) as { cancelPayrollRun: Run };
    expect(res.cancelPayrollRun).toMatchObject({ status: 'cancelled' });
    expect(res.cancelPayrollRun.cancelEntryId).toBeTruthy();

    const after = await trial();
    expect(after['5200'] ?? 0).toBe(0);
    expect(after['2200'] ?? 0).toBe(0);
    expect(after['2210'] ?? 0).toBe(0);

    const rev = (await must(
      await q(owner(), ENTRY, { id: res.cancelPayrollRun.cancelEntryId }),
    )) as { journalEntry: { reversalOf: string; sourceType: string } };
    expect(rev.journalEntry.reversalOf).toBe(aug.approveEntryId);
    expect(rev.journalEntry.sourceType).toBe('reversal');
  });

  it('approves October and posts the salary expense and what is owed', async () => {
    before = await trial();
    october = await getRun(october.id);
    approved = await approve(october);
    expect(approved).toMatchObject({ status: 'approved', approvedByName: 'Arun Approver' });
    expect(approved.approveEntryId).toBeTruthy();

    const e = (await must(await q(appr.agent, ENTRY, { id: approved.approveEntryId }))) as {
      journalEntry: {
        entryDate: string;
        sourceType: string;
        sourceId: string;
        total: string;
        lines: { account: { code: string }; debit: string; credit: string }[];
      };
    };
    expect(e.journalEntry).toMatchObject({
      entryDate: '2026-10-31',
      sourceType: 'payroll',
      sourceId: october.id,
    });
    const lines = Object.fromEntries(e.journalEntry.lines.map((l) => [l.account.code, l]));
    expect(lines['5200']).toMatchObject({ debit: '17322.58', credit: '0.00' });
    expect(lines['2200']).toMatchObject({ debit: '0.00', credit: '14403.23' });
    expect(lines['2210']).toMatchObject({ debit: '0.00', credit: '2919.35' });

    const t = await trial();
    expect(t['5200']! - (before['5200'] ?? 0)).toBe(1732258);
    expect(t['2200']! - (before['2200'] ?? 0)).toBe(-1440323);
  });

  it('cannot be changed once approved', async () => {
    const a = (await slips(october.id))[ann.employeeId]!;
    expect(
      code(await q(prep.agent, ADJUST, { id: a.id, i: { version: approved.version, bonus: '5' } })),
    ).toBe('BUSINESS_RULE');
    expect(
      code(await q(prep.agent, RECALC, { id: october.id, i: { version: approved.version } })),
    ).toBe('BUSINESS_RULE');
    expect(
      code(await q(appr.agent, APPROVE, { id: october.id, i: { version: approved.version } })),
    ).toBe('BUSINESS_RULE');
  });

  it('stops even a direct database edit of an approved payslip', async () => {
    const a = (await slips(october.id))[ann.employeeId]!;
    await expect(
      database.db.execute(sql`update payslips set bonus = 99999 where id = ${a.id}`),
    ).rejects.toThrow();
    await expect(
      database.db.execute(sql`delete from payslips where id = ${a.id}`),
    ).rejects.toThrow();
    expect((await slips(october.id))[ann.employeeId]).toMatchObject({ bonus: '1000.00' });
  });

  it('is paid only once approved, on a sensible date, by someone who may pay', async () => {
    const draft = (await must(await q(owner(), RUNS, { i: { status: 'draft' } }))) as {
      payrollRuns: { items: { id: string }[] };
    };
    const sep = await getRun(draft.payrollRuns.items[0]!.id);
    const ok = { method: 'cash', paidOn: '2026-11-05' };
    expect(code(await q(prep.agent, PAY, { id: sep.id, i: { version: sep.version, ...ok } }))).toBe(
      'BUSINESS_RULE',
    );

    expect(
      code(await q(appr.agent, PAY, { id: october.id, i: { version: approved.version, ...ok } })),
    ).toBe('FORBIDDEN');
    for (const paidOn of ['2026-10-30', '2026-11-13', '2027-01-01']) {
      expect(
        code(
          await q(prep.agent, PAY, {
            id: october.id,
            i: { version: approved.version, method: 'cash', paidOn },
          }),
        ),
      ).toBe('VALIDATION_ERROR');
    }
    // An unknown method never reaches the service: GraphQL itself rejects the enum value.
    expect(
      code(
        await q(prep.agent, PAY, {
          id: october.id,
          i: { version: approved.version, ...ok, method: 'barter' },
        }),
      ),
    ).toBe('BAD_REQUEST');
    for (const bad of [{ paidOn: 'tomorrow' }, { reference: 'x'.repeat(41) }]) {
      expect(
        code(
          await q(prep.agent, PAY, {
            id: october.id,
            i: { version: approved.version, ...ok, ...bad },
          }),
        ),
      ).toBe('VALIDATION_ERROR');
    }
    expect(code(await q(prep.agent, PAY, { id: october.id, i: { version: 1, ...ok } }))).toBe(
      'CONFLICT',
    );
  });

  it('pays October from the cash account and settles what was owed', async () => {
    const res = (await must(
      await q(prep.agent, PAY, {
        id: october.id,
        i: { version: approved.version, method: 'cash', paidOn: '2026-11-05', reference: 'CASH-1' },
      }),
    )) as { payPayrollRun: Run & { paidOn: string; payMethod: string; payReference: string } };
    paid = res.payPayrollRun;
    expect(paid).toMatchObject({
      status: 'paid',
      paidOn: '2026-11-05',
      payMethod: 'cash',
      payReference: 'CASH-1',
      paidByName: 'Priya Payroll',
    });
    const t = await trial();
    // What was owed to staff is settled; the tax-style deductions stay owed until paid on.
    expect(t['2200'] ?? 0).toBe(before['2200'] ?? 0);
    expect(t['1000']! - (before['1000'] ?? 0)).toBe(-1440323);
    expect(t['2210']! - (before['2210'] ?? 0)).toBe(-291935);
  });

  it('cannot cancel, approve or pay a paid run again', async () => {
    expect(
      code(
        await q(owner(), CANCEL, { id: paid.id, i: { version: paid.version, reason: 'Undo it' } }),
      ),
    ).toBe('BUSINESS_RULE');
    expect(code(await q(appr.agent, APPROVE, { id: paid.id, i: { version: paid.version } }))).toBe(
      'BUSINESS_RULE',
    );
    expect(
      code(
        await q(prep.agent, PAY, {
          id: paid.id,
          i: { version: paid.version, method: 'cash', paidOn: '2026-11-06' },
        }),
      ),
    ).toBe('BUSINESS_RULE');
  });

  it('pays September by bank into the bank account', async () => {
    const draft = (await must(await q(owner(), RUNS, { i: { status: 'draft' } }))) as {
      payrollRuns: { items: { id: string }[] };
    };
    const sep = await getRun(draft.payrollRuns.items[0]!.id);
    const sepApproved = await approve(sep);
    const bank = await trial();
    const res = (await must(
      await q(prep.agent, PAY, {
        id: sep.id,
        i: { version: sepApproved.version, method: 'bank', paidOn: '2026-11-10' },
      }),
    )) as { payPayrollRun: Run };
    expect(res.payPayrollRun).toMatchObject({ status: 'paid' });
    const t = await trial();
    expect(t['1010']! - (bank['1010'] ?? 0)).toBe(-paise(sepApproved.netTotal));
    expect(t['1000'] ?? 0).toBe(bank['1000'] ?? 0);
  });
});

describe('my payslips', () => {
  it('shows an employee only their own payslips from runs that were approved', async () => {
    const d = (await must(await q(ann.agent, MINE))) as {
      myPayslips: {
        total: number;
        items: {
          periodStart: string;
          runStatus: string;
          employeeCode: string;
          netPay: string;
          earned: string;
          bonus: string;
        }[];
      };
    };
    expect(d.myPayslips.total).toBe(2);
    expect(d.myPayslips.items.map((i) => i.periodStart)).toEqual(['2026-10-01', '2026-09-01']);
    expect(d.myPayslips.items[0]).toMatchObject({
      runStatus: 'paid',
      earned: '12903.23',
      bonus: '1000.00',
      netPay: '13403.23',
    });
    const codes = new Set(d.myPayslips.items.map((i) => i.employeeCode));
    expect(codes.size).toBe(1);

    const bobs = (await must(await q(bob.agent, MINE))) as {
      myPayslips: { items: { employeeCode: string; netPay: string }[] };
    };
    expect(bobs.myPayslips.items.every((i) => !codes.has(i.employeeCode))).toBe(true);
    expect(bobs.myPayslips.items[0]).toMatchObject({ netPay: '0.00' });
  });

  it('hides a draft run, and shows nothing to someone with no employee record', async () => {
    const eves = (await must(await q(eve.agent, MINE))) as { myPayslips: { total: number } };
    // Eve joined on 20 October, so she is only on the October run.
    expect(eves.myPayslips.total).toBe(1);
    const none = (await must(await q(owner(), MINE))) as { myPayslips: { total: number } };
    expect(none.myPayslips.total).toBe(0);
    const devs = (await must(await q(dev.agent, MINE))) as { myPayslips: { total: number } };
    expect(devs.myPayslips.total).toBe(0);
  });

  it('needs the own-payslip permission', async () => {
    expect(code(await q(appr.agent, MINE))).toBe('FORBIDDEN');
  });
});

describe('payroll: rate limit', () => {
  it('slows down someone who keeps changing salaries', async () => {
    const limited = testApp({
      now: () => NOW,
      limits: { payrollWritesPerUser: { limit: 2, windowMs: 60_000 } },
    });
    const org = await registerOrg(limited);
    const co = await buildCompany(limited, org);
    const person = await co.person({ role: 'employee', branch: co.ho, name: 'Rate Test' });
    const save = (basic: string, version: number | null) =>
      q(co.owner, SAVE, { i: { employeeId: person.employeeId, basic, version } });
    expect((await save('1000', null)).body.errors).toBeUndefined();
    expect((await save('1100', 1)).body.errors).toBeUndefined();
    expect(code(await save('1200', 2))).toBe('RATE_LIMITED');
  });
});
