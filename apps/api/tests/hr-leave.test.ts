import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, gql, registerOrg, testApp } from './helpers';
import {
  BALANCES,
  CANCEL_LEAVE,
  CREATE_LEAVE_TYPE,
  DECIDE_LEAVE,
  LEAVE_TYPES,
  LIST_LEAVE,
  RANGE,
  REQUEST_LEAVE,
  buildCompany,
  code,
  q,
  type Org,
  type Person,
} from './hr-support';

let clock = new Date('2026-11-11T04:00:00Z');
const app = testApp({ now: () => clock });
afterAll(() => database.close());

let org: Org;
let company: Awaited<ReturnType<typeof buildCompany>>;
let alice: Person; // employee, branch 1
let bob: Person; // employee, branch 2
let hr: Person; // coordinator, branch 1
let cl: string;
let sl: string;

const ask = (
  leaveTypeId: string,
  startDate: string,
  endDate: string,
  reason = 'Family function',
) => ({
  leaveTypeId,
  startDate,
  endDate,
  reason,
});
const approve = (version: number, note?: string) => ({ decision: 'approve', note, version });

beforeAll(async () => {
  org = await registerOrg(app);
  company = await buildCompany(app, org);
  alice = await company.person({ role: 'employee', branch: company.ho, name: 'Alice' });
  bob = await company.person({ role: 'employee', branch: company.br2, name: 'Bob' });
  hr = await company.person({ role: 'hr', branch: company.ho, name: 'Hema HR' });
  const types = (await q(company.owner, LEAVE_TYPES)).body.data.leaveTypes as {
    id: string;
    code: string;
  }[];
  cl = types.find((t) => t.code === 'CL')!.id; // 12 days
  sl = types.find((t) => t.code === 'SL')!.id; // 12 days
});

describe('leave types', () => {
  it('rejects anonymous callers', async () => {
    expect(code(await gql(app, LEAVE_TYPES))).toBe('UNAUTHENTICATED');
  });

  it('lets anyone who can request leave see the types, but only managers change them', async () => {
    expect((await q(alice.agent, LEAVE_TYPES)).body.errors).toBeUndefined();
    const input = { code: 'comp', name: 'Compensatory off', annualDays: 6, paid: true };
    expect(code(await q(alice.agent, CREATE_LEAVE_TYPE, { i: input }))).toBe('FORBIDDEN');
    expect(code(await q(hr.agent, CREATE_LEAVE_TYPE, { i: input }))).toBe('FORBIDDEN');
    const ok = await q(company.owner, CREATE_LEAVE_TYPE, { i: input });
    expect(ok.body.data.createLeaveType.code).toBe('COMP'); // normalised
    expect(code(await q(company.owner, CREATE_LEAVE_TYPE, { i: input }))).toBe('CONFLICT');
  });

  it('validates quota', async () => {
    for (const annualDays of [-1, 400, 1.3]) {
      const res = await q(company.owner, CREATE_LEAVE_TYPE, {
        i: { code: 'BAD', name: 'Bad type', annualDays, paid: true },
      });
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
  });
});

describe('requesting leave', () => {
  it('computes days on the server and reserves them against the balance', async () => {
    const res = await q(alice.agent, REQUEST_LEAVE, { i: ask(cl, '2026-12-01', '2026-12-03') });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.requestLeave).toMatchObject({
      days: 3,
      status: 'pending',
      leaveTypeCode: 'CL',
    });

    const bal = await q(alice.agent, BALANCES, { i: { year: 2026 } });
    const item = bal.body.data.leaveBalances.items.find(
      (i: { leaveType: { code: string } }) => i.leaveType.code === 'CL',
    );
    expect(item).toMatchObject({ quota: 12, used: 0, pending: 3, remaining: 9 });
  });

  it('refuses overlapping dates', async () => {
    const res = await q(alice.agent, REQUEST_LEAVE, { i: ask(sl, '2026-12-03', '2026-12-04') });
    expect(code(res)).toBe('BUSINESS_RULE');
  });

  it('never lets the balance go negative', async () => {
    const res = await q(alice.agent, REQUEST_LEAVE, { i: ask(cl, '2026-12-10', '2026-12-20') }); // 11 > 9
    expect(code(res)).toBe('BUSINESS_RULE');
    const exact = await q(alice.agent, REQUEST_LEAVE, { i: ask(cl, '2026-12-10', '2026-12-18') }); // 9
    expect(exact.body.errors).toBeUndefined();
    const more = await q(alice.agent, REQUEST_LEAVE, { i: ask(cl, '2026-12-22', '2026-12-22') });
    expect(code(more)).toBe('BUSINESS_RULE'); // nothing left
  });

  it('validates dates, reason, type and year boundary', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [ask(cl, '2026-13-01', '2026-13-02'), 'VALIDATION_ERROR'],
      [ask(cl, '2026-05-10', '2026-05-09'), 'VALIDATION_ERROR'],
      [ask(cl, '2026-01-01', '2026-04-01'), 'VALIDATION_ERROR'], // over 60 days
      [ask(cl, '2026-02-01', '2026-02-02', ''), 'VALIDATION_ERROR'],
      [ask('not-a-uuid', '2026-02-01', '2026-02-02'), 'VALIDATION_ERROR'],
      [ask('00000000-0000-4000-8000-000000000001', '2026-02-01', '2026-02-02'), 'VALIDATION_ERROR'],
      [ask(cl, '2026-12-30', '2027-01-02'), 'BUSINESS_RULE'], // spans two years
      [ask(cl, '2023-12-01', '2023-12-02'), 'BUSINESS_RULE'], // before joining (2024-01-01)
    ];
    for (const [i, expected] of cases) {
      expect(code(await q(alice.agent, REQUEST_LEAVE, { i }))).toBe(expected);
    }
  });

  it('refuses people with no employee record', async () => {
    const res = await q(company.owner, REQUEST_LEAVE, { i: ask(cl, '2026-03-01', '2026-03-02') });
    expect(code(res)).toBe('BUSINESS_RULE');
  });

  it('lets only one of two simultaneous requests through when the balance covers just one', async () => {
    const results = await Promise.all([
      q(bob.agent, REQUEST_LEAVE, { i: ask(sl, '2026-03-02', '2026-03-08') }), // 7 days
      q(bob.agent, REQUEST_LEAVE, { i: ask(sl, '2026-04-06', '2026-04-12') }), // 7 days
    ]);
    expect(results.filter((r) => !r.body.errors)).toHaveLength(1);
    expect(code(results.find((r) => r.body.errors)!)).toBe('BUSINESS_RULE');
    const bal = await q(bob.agent, BALANCES, { i: { year: 2026 } });
    const item = bal.body.data.leaveBalances.items.find(
      (i: { leaveType: { code: string } }) => i.leaveType.code === 'SL',
    );
    expect(item.remaining).toBe(5);
  });
});

describe('visibility', () => {
  it('shows the Employee role only their own requests', async () => {
    const res = await q(alice.agent, LIST_LEAVE);
    const names = res.body.data.leaveRequests.items.map(
      (r: { employeeName: string }) => r.employeeName,
    );
    expect(new Set(names)).toEqual(new Set(['Alice']));
    // Asking for someone else's changes nothing.
    const peek = await q(alice.agent, LIST_LEAVE, { i: { employeeId: bob.employeeId } });
    expect(
      new Set(
        peek.body.data.leaveRequests.items.map((r: { employeeName: string }) => r.employeeName),
      ),
    ).toEqual(new Set(['Alice']));
  });

  it('shows a branch coordinator their own branch and not the other', async () => {
    const res = await q(hr.agent, LIST_LEAVE);
    const names = res.body.data.leaveRequests.items.map(
      (r: { employeeName: string }) => r.employeeName,
    );
    expect(names).toContain('Alice');
    expect(names).not.toContain('Bob');
  });

  it("only shows someone else's balance to a manager with that person in scope", async () => {
    expect(code(await q(alice.agent, BALANCES, { i: { employeeId: bob.employeeId } }))).toBe(
      'FORBIDDEN',
    );
    expect(
      (await q(hr.agent, BALANCES, { i: { employeeId: alice.employeeId } })).body.errors,
    ).toBeUndefined();
    expect(code(await q(hr.agent, BALANCES, { i: { employeeId: bob.employeeId } }))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('deciding', () => {
  let pending: { id: string; version: number };

  beforeAll(async () => {
    const list = await q(company.owner, LIST_LEAVE, { i: { status: 'pending' } });
    pending = list.body.data.leaveRequests.items.find(
      (r: { employeeName: string; startDate: string }) =>
        r.employeeName === 'Alice' && r.startDate === '2026-12-01',
    );
  });

  it('forbids the Employee role from approving', async () => {
    const res = await q(alice.agent, DECIDE_LEAVE, { id: pending.id, i: approve(pending.version) });
    expect(code(res)).toBe('FORBIDDEN');
  });

  it("treats another branch's request as missing", async () => {
    const bobs = await q(company.owner, LIST_LEAVE, { i: { employeeId: bob.employeeId } });
    const r = bobs.body.data.leaveRequests.items[0];
    expect(code(await q(hr.agent, DECIDE_LEAVE, { id: r.id, i: approve(r.version) }))).toBe(
      'NOT_FOUND',
    );
  });

  it('does not let a coordinator decide their own request', async () => {
    const mine = await q(hr.agent, REQUEST_LEAVE, { i: ask(cl, '2026-05-04', '2026-05-05') });
    const { id, version } = mine.body.data.requestLeave;
    const res = await q(hr.agent, DECIDE_LEAVE, { id, i: approve(version) });
    expect(code(res)).toBe('FORBIDDEN');
    // The owner (a different person) can.
    expect(
      (await q(company.owner, DECIDE_LEAVE, { id, i: approve(version) })).body.errors,
    ).toBeUndefined();
  });

  it('approves with a stale-version guard and refuses a second decision', async () => {
    const stale = await q(hr.agent, DECIDE_LEAVE, {
      id: pending.id,
      i: approve(pending.version + 5),
    });
    expect(code(stale)).toBe('CONFLICT');

    const ok = await q(hr.agent, DECIDE_LEAVE, {
      id: pending.id,
      i: approve(pending.version, 'Enjoy'),
    });
    expect(ok.body.data.decideLeave).toMatchObject({ status: 'approved', decisionNote: 'Enjoy' });
    const again = await q(hr.agent, DECIDE_LEAVE, {
      id: pending.id,
      i: { decision: 'reject', version: ok.body.data.decideLeave.version },
    });
    expect(code(again)).toBe('BUSINESS_RULE');

    const bal = await q(alice.agent, BALANCES, { i: { year: 2026 } });
    const item = bal.body.data.leaveBalances.items.find(
      (i: { leaveType: { code: string } }) => i.leaveType.code === 'CL',
    );
    expect(item).toMatchObject({ used: 3, pending: 9, remaining: 0 });
  });

  it('shows approved leave in the attendance report', async () => {
    clock = new Date('2026-12-02T04:00:00Z');
    const res = await q(company.owner, RANGE, {
      i: { employeeId: alice.employeeId, from: '2026-12-01', to: '2026-12-04' },
    });
    const days = res.body.data.attendance.items[0].days.map(
      (d: { date: string; status: string }) => d.status,
    );
    expect(days).toEqual(['leave', 'leave', 'leave', 'upcoming']);
    clock = new Date('2026-11-11T04:00:00Z');
  });

  it('frees the days when a request is rejected', async () => {
    const list = await q(company.owner, LIST_LEAVE, {
      i: { status: 'pending', employeeId: alice.employeeId },
    });
    const r = list.body.data.leaveRequests.items[0]; // the 9-day request
    const rejected = await q(hr.agent, DECIDE_LEAVE, {
      id: r.id,
      i: { decision: 'reject', note: 'Busy period', version: r.version },
    });
    expect(rejected.body.data.decideLeave.status).toBe('rejected');
    const bal = await q(alice.agent, BALANCES, { i: { year: 2026 } });
    const item = bal.body.data.leaveBalances.items.find(
      (i: { leaveType: { code: string } }) => i.leaveType.code === 'CL',
    );
    expect(item).toMatchObject({ used: 3, pending: 0, remaining: 9 });
  });
});

describe('cancelling', () => {
  it("does not let someone cancel another person's request", async () => {
    const list = await q(company.owner, LIST_LEAVE, {
      i: { employeeId: alice.employeeId, status: 'approved' },
    });
    const r = list.body.data.leaveRequests.items[0];
    expect(code(await q(bob.agent, CANCEL_LEAVE, { id: r.id }))).toBe('NOT_FOUND');
    // Even a manager cannot cancel on someone's behalf; they reject instead.
    expect(code(await q(hr.agent, CANCEL_LEAVE, { id: r.id }))).toBe('NOT_FOUND');
  });

  it('lets the requester withdraw an approved request that has not started, and frees the days', async () => {
    const list = await q(company.owner, LIST_LEAVE, {
      i: { employeeId: alice.employeeId, status: 'approved' },
    });
    const r = list.body.data.leaveRequests.items[0];
    const res = await q(alice.agent, CANCEL_LEAVE, { id: r.id });
    expect(res.body.data.cancelLeave.status).toBe('cancelled');
    const bal = await q(alice.agent, BALANCES, { i: { year: 2026 } });
    const item = bal.body.data.leaveBalances.items.find(
      (i: { leaveType: { code: string } }) => i.leaveType.code === 'CL',
    );
    expect(item.remaining).toBe(12);
    // A cancelled request cannot be cancelled again.
    expect(code(await q(alice.agent, CANCEL_LEAVE, { id: r.id }))).toBe('BUSINESS_RULE');
  });

  it('will not cancel leave that has already started', async () => {
    const made = await q(alice.agent, REQUEST_LEAVE, { i: ask(cl, '2026-11-11', '2026-11-12') });
    const { id, version } = made.body.data.requestLeave;
    await q(company.owner, DECIDE_LEAVE, { id, i: approve(version) });
    clock = new Date('2026-11-12T04:00:00Z');
    expect(code(await q(alice.agent, CANCEL_LEAVE, { id }))).toBe('BUSINESS_RULE');
    clock = new Date('2026-11-11T04:00:00Z');
  });
});

describe('tenant isolation', () => {
  it("never shows one organisation's leave to another", async () => {
    const other = await registerOrg(app);
    const stranger = await buildCompany(app, other);
    const res = await q(stranger.owner, LIST_LEAVE);
    expect(res.body.data.leaveRequests.total).toBe(0);
    const list = await q(company.owner, LIST_LEAVE);
    const id = list.body.data.leaveRequests.items[0].id;
    expect(
      code(await q(stranger.owner, DECIDE_LEAVE, { id, i: { decision: 'approve', version: 1 } })),
    ).toBe('NOT_FOUND');
  });
});
