import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attendancePunches, employees } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import { database, gql, registerOrg, testApp } from './helpers';
import {
  CREATE_SHIFT,
  MANUAL,
  PUNCH,
  RANGE,
  SHIFTS,
  TODAY,
  UPDATE_EMPLOYEE,
  UPDATE_SHIFT,
  buildCompany,
  code,
  q,
  type Org,
  type Person,
} from './hr-support';

// 09:30 in India (04:00 UTC). The clock only moves when a test moves it.
let clock = new Date('2026-11-11T04:00:00Z');
const at = (iso: string) => {
  clock = new Date(iso);
};
const app = testApp({ now: () => clock });
afterAll(() => database.close());

let org: Org;
let company: Awaited<ReturnType<typeof buildCompany>>;
let alice: Person; // branch 1
let bob: Person; // branch 2
let hr: Person; // coordinator, branch 1

beforeAll(async () => {
  org = await registerOrg(app);
  company = await buildCompany(app, org);
  alice = await company.person({ role: 'employee', branch: company.ho, name: 'Alice' });
  bob = await company.person({ role: 'employee', branch: company.br2, name: 'Bob' });
  hr = await company.person({ role: 'hr', branch: company.ho, name: 'Hema HR' });
});

describe('punching', () => {
  it('rejects anonymous callers', async () => {
    expect(code(await gql(app, PUNCH))).toBe('UNAUTHENTICATED');
    expect(code(await gql(app, TODAY))).toBe('UNAUTHENTICATED');
  });

  it('lets the server decide in or out, using its own clock', async () => {
    at('2026-11-11T04:00:00Z'); // 09:30 IST, 15 min after the grace period ends at 09:15
    const first = await q(alice.agent, PUNCH, { i: { note: 'office' } });
    expect(first.body.errors).toBeUndefined();
    expect(first.body.data.punch.kind).toBe('in');
    expect(first.body.data.punch.today.state).toBe('in');
    expect(first.body.data.punch.today.day).toMatchObject({
      late: true,
      open: true,
      status: 'incomplete',
    });

    at('2026-11-11T08:00:00Z'); // 13:30 IST, four hours later
    const second = await q(alice.agent, PUNCH);
    expect(second.body.data.punch.kind).toBe('out');
    expect(second.body.data.punch.today.day).toMatchObject({
      status: 'half_day',
      workedMinutes: 240,
      open: false,
    });
    const stored = second.body.data.punch.today.punches;
    expect(stored.map((p: { kind: string }) => p.kind)).toEqual(['in', 'out']);
    expect(stored.every((p: { source: string }) => p.source === 'self')).toBe(true);
  });

  it('does not accept a time from the client', async () => {
    const res = await q(alice.agent, PUNCH, { i: { note: 'x', at: '2026-01-01T00:00:00Z' } });
    expect(code(res)).toBe('BAD_REQUEST');
  });

  it('refuses a second tap within seconds', async () => {
    at('2026-11-11T08:30:00Z');
    expect((await q(alice.agent, PUNCH)).body.data.punch.kind).toBe('in');
    at('2026-11-11T08:30:03Z');
    expect(code(await q(alice.agent, PUNCH))).toBe('BUSINESS_RULE');
  });

  it('serialises two simultaneous taps so only one is recorded', async () => {
    at('2026-11-12T04:00:00Z');
    const results = await Promise.all([q(bob.agent, PUNCH), q(bob.agent, PUNCH)]);
    const ok = results.filter((r) => !r.body.errors);
    expect(ok).toHaveLength(1);
    expect(code(results.find((r) => r.body.errors)!)).toBe('BUSINESS_RULE');
    const rows = await database.db
      .select()
      .from(attendancePunches)
      .where(eq(attendancePunches.employeeId, bob.employeeId));
    expect(rows).toHaveLength(1);
  });

  it('refuses people with no employee record, and inactive employees', async () => {
    const owner = await q(company.owner, PUNCH);
    expect(code(owner)).toBe('BUSINESS_RULE');
    expect((await q(company.owner, TODAY)).body.data.attendanceToday).toBeNull();

    const current = await database.db
      .select()
      .from(employees)
      .where(eq(employees.id, hr.employeeId));
    await q(company.owner, UPDATE_EMPLOYEE, {
      id: hr.employeeId,
      i: {
        fullName: 'Hema HR',
        email: current[0]!.email,
        phone: null,
        branchId: company.ho,
        department: null,
        designation: null,
        joiningDate: '2024-01-01',
        shiftId: null,
        userId: hr.userId,
        status: 'inactive',
        version: current[0]!.version,
      },
    });
    expect(code(await q(hr.agent, PUNCH))).toBe('BUSINESS_RULE');
  });
});

describe('manual corrections', () => {
  const session = (
    employeeId: string,
    inAt: string | null,
    outAt: string | null,
    reason = 'Forgot to punch',
  ) => ({ employeeId, inAt, outAt, reason });

  it('is forbidden without attendance.record.manage', async () => {
    const res = await q(alice.agent, MANUAL, {
      i: session(alice.employeeId, '2026-11-10T09:00:00+05:30', '2026-11-10T18:00:00+05:30'),
    });
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('back-fills a whole missed day between existing punches, marked manual', async () => {
    at('2026-11-12T10:00:00Z');
    const ok = await q(company.owner, MANUAL, {
      i: session(alice.employeeId, '2026-11-10T09:00:00+05:30', '2026-11-10T18:00:00+05:30'),
    });
    expect(ok.body.errors).toBeUndefined();
    const rows = await database.db
      .select()
      .from(attendancePunches)
      .where(eq(attendancePunches.employeeId, alice.employeeId));
    const manualRows = rows.filter((r) => r.source === 'manual');
    expect(manualRows.map((r) => r.kind).sort()).toEqual(['in', 'out']);
    expect(manualRows[0]!.note).toBe('Forgot to punch');
  });

  it('requires a reason and at least one time, and the out after the in', async () => {
    const noReason = await q(company.owner, MANUAL, {
      i: session(alice.employeeId, '2026-11-08T09:00:00+05:30', '2026-11-08T18:00:00+05:30', ''),
    });
    expect(code(noReason)).toBe('VALIDATION_ERROR');
    const none = await q(company.owner, MANUAL, { i: session(alice.employeeId, null, null) });
    expect(code(none)).toBe('VALIDATION_ERROR');
    const backwards = await q(company.owner, MANUAL, {
      i: session(alice.employeeId, '2026-11-08T18:00:00+05:30', '2026-11-08T09:00:00+05:30'),
    });
    expect(code(backwards)).toBe('VALIDATION_ERROR');
  });

  it('enforces alternating in/out against the neighbours', async () => {
    at('2026-11-12T10:00:00Z');
    // The 10th already holds in 09:00 and out 18:00, so another "in" at 12:00 breaks the order.
    const inside = await q(company.owner, MANUAL, {
      i: session(alice.employeeId, '2026-11-10T12:00:00+05:30', null),
    });
    expect(code(inside)).toBe('BUSINESS_RULE');
    // A session that would swallow existing punches is refused too.
    const swallow = await q(company.owner, MANUAL, {
      i: session(alice.employeeId, '2026-11-10T08:00:00+05:30', '2026-11-10T19:00:00+05:30'),
    });
    expect(code(swallow)).toBe('BUSINESS_RULE');
    // An "out" at 07:00 would come before any "in".
    const early = await q(company.owner, MANUAL, {
      i: session(alice.employeeId, null, '2026-11-09T07:00:00+05:30'),
    });
    expect(code(early)).toBe('BUSINESS_RULE');
  });

  it('rejects the future and a duplicate instant', async () => {
    at('2026-11-12T10:00:00Z');
    const future = await q(company.owner, MANUAL, {
      i: session(alice.employeeId, '2026-11-20T09:00:00+05:30', null),
    });
    expect(code(future)).toBe('BUSINESS_RULE');
    const dup = await q(company.owner, MANUAL, {
      i: session(alice.employeeId, '2026-11-10T09:00:00+05:30', null),
    });
    expect(['BUSINESS_RULE', 'CONFLICT']).toContain(code(dup));
  });

  it('keeps a branch coordinator inside their branch', async () => {
    at('2026-11-12T10:00:00Z');
    // Closes Alice's open "in" from the afternoon of the 11th.
    const mine = await q(hr.agent, MANUAL, {
      i: session(alice.employeeId, null, '2026-11-11T20:00:00+05:30'),
    });
    expect(mine.body.errors).toBeUndefined();
    const other = await q(hr.agent, MANUAL, {
      i: session(bob.employeeId, '2026-11-09T09:00:00+05:30', '2026-11-09T18:00:00+05:30'),
    });
    expect(code(other)).toBe('NOT_FOUND');
  });
});

describe('append-only punches', () => {
  it('lets the application role insert and read but never update or delete', async () => {
    await expect(
      withTenant(database.db, org.tenantId, (tx) =>
        tx.update(attendancePunches).set({ note: 'tampered' }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(database.db, org.tenantId, (tx) => tx.delete(attendancePunches)),
    ).rejects.toThrow();
    const count = await database.db.execute(sql`select count(*)::int as n from attendance_punches`);
    expect(count).toBeDefined();
  });
});

describe('attendance report', () => {
  it('shows a branch coordinator only their branch', async () => {
    at('2026-11-12T10:00:00Z');
    const res = await q(hr.agent, RANGE, { i: { from: '2026-11-09', to: '2026-11-12' } });
    expect(res.body.errors).toBeUndefined();
    const codes = res.body.data.attendance.items.map(
      (i: { employee: { employeeCode: string } }) => i.employee.employeeCode,
    );
    expect(codes).not.toContain(await codeOf(bob.employeeId));
    expect(codes).toContain(await codeOf(alice.employeeId));
  });

  it('builds days from punches, leave and absence in the organisation time zone', async () => {
    at('2026-11-12T10:00:00Z');
    const res = await q(company.owner, RANGE, {
      i: { employeeId: alice.employeeId, from: '2026-11-09', to: '2026-11-14' },
    });
    expect(res.body.data.attendance.timeZone).toBe('Asia/Kolkata');
    const days = Object.fromEntries(
      res.body.data.attendance.items[0].days.map((d: { date: string }) => [d.date, d]),
    );
    expect(days['2026-11-09']).toMatchObject({ status: 'absent' });
    expect(days['2026-11-10']).toMatchObject({
      status: 'present',
      workedMinutes: 540,
      late: false,
    });
    expect(days['2026-11-11']).toMatchObject({ status: 'present', workedMinutes: 600, late: true });
    expect(days['2026-11-12']).toMatchObject({ status: 'absent' });
    expect(days['2026-11-14']).toMatchObject({ status: 'upcoming' });
  });

  it('shows the Employee role only themselves, whatever they ask for', async () => {
    const own = await q(alice.agent, RANGE, { i: { from: '2026-11-09', to: '2026-11-12' } });
    expect(own.body.data.attendance.items).toHaveLength(1);
    expect(own.body.data.attendance.items[0].employee.id).toBe(alice.employeeId);
    const peek = await q(alice.agent, RANGE, {
      i: { from: '2026-11-09', to: '2026-11-12', employeeId: bob.employeeId },
    });
    expect(code(peek)).toBe('FORBIDDEN');
  });

  it('hides out-of-scope employees from a coordinator who asks by id', async () => {
    const res = await q(hr.agent, RANGE, {
      i: { from: '2026-11-09', to: '2026-11-12', employeeId: bob.employeeId },
    });
    expect(code(res)).toBe('NOT_FOUND');
  });

  it('validates the range', async () => {
    for (const i of [
      { from: '2026-11-12', to: '2026-11-01' },
      { from: '2026-01-01', to: '2026-12-31' },
      { from: 'bad', to: '2026-11-01' },
    ]) {
      expect(code(await q(company.owner, RANGE, { i }))).toBe('VALIDATION_ERROR');
    }
  });

  it("does not leak another organisation's punches", async () => {
    const other = await registerOrg(app);
    const stranger = await buildCompany(app, other);
    const res = await q(stranger.owner, RANGE, { i: { from: '2026-11-09', to: '2026-11-12' } });
    expect(res.body.data.attendance.total).toBe(0);
  });
});

describe('weekly off', () => {
  it('shows Sunday as off by default, not absent', async () => {
    at('2026-11-20T10:00:00Z');
    const res = await q(company.owner, RANGE, {
      i: { employeeId: bob.employeeId, from: '2026-11-14', to: '2026-11-16' },
    });
    const days = res.body.data.attendance.items[0].days.map((d: { status: string }) => d.status);
    expect(days).toEqual(['absent', 'off', 'absent']); // Sat, Sun, Mon
  });
});

describe('shifts', () => {
  it('needs the manage permission to change them', async () => {
    const input = {
      name: 'Night',
      startTime: '21:00',
      endTime: '06:00',
      graceMinutes: 10,
      fullDayMinutes: 480,
      halfDayMinutes: 240,
    };
    expect(code(await q(alice.agent, CREATE_SHIFT, { i: input }))).toBe('FORBIDDEN');
    expect(code(await q(alice.agent, SHIFTS))).toBe('FORBIDDEN');
    const ok = await q(company.owner, CREATE_SHIFT, { i: input });
    expect(ok.body.data.createShift.name).toBe('Night');
    expect(code(await q(company.owner, CREATE_SHIFT, { i: input }))).toBe('CONFLICT');
  });

  it('validates minutes and uses optimistic locking', async () => {
    const bad = await q(company.owner, CREATE_SHIFT, {
      i: {
        name: 'Bad',
        startTime: '09:00',
        endTime: '17:00',
        graceMinutes: 0,
        fullDayMinutes: 240,
        halfDayMinutes: 240,
      },
    });
    expect(code(bad)).toBe('VALIDATION_ERROR');

    const shift = (await q(company.owner, SHIFTS)).body.data.shifts.find(
      (s: { name: string }) => s.name === 'Night',
    );
    const body = {
      name: 'Night',
      startTime: '20:00',
      endTime: '05:00',
      graceMinutes: 10,
      fullDayMinutes: 480,
      halfDayMinutes: 240,
      status: 'active',
      version: shift.version,
    };
    const ok = await q(company.owner, UPDATE_SHIFT, { id: shift.id, i: body });
    expect(ok.body.data.updateShift.version).toBe(shift.version + 1);
    expect(code(await q(company.owner, UPDATE_SHIFT, { id: shift.id, i: body }))).toBe('CONFLICT');
  });
});

async function codeOf(employeeId: string) {
  const [row] = await database.db.select().from(employees).where(eq(employees.id, employeeId));
  return row!.employeeCode;
}
