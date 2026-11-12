import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, gql, registerOrg, testApp } from './helpers';
import {
  CREATE_HOLIDAY,
  DELETE_HOLIDAY,
  RANGE,
  SET_WEEKLY_OFF,
  UPDATE_HOLIDAY,
  WORK_CALENDAR,
  buildCompany,
  code,
  q,
  type Org,
  type Person,
} from './hr-support';

const clock = new Date('2026-11-20T10:00:00Z');
const app = testApp({ now: () => clock });
afterAll(() => database.close());

let org: Org;
let company: Awaited<ReturnType<typeof buildCompany>>;
let alice: Person;
let other: Awaited<ReturnType<typeof buildCompany>>;

beforeAll(async () => {
  org = await registerOrg(app);
  company = await buildCompany(app, org);
  alice = await company.person({ role: 'employee', branch: company.ho, name: 'Alice' });
  other = await buildCompany(app, await registerOrg(app));
});

const statuses = async (from: string, to: string) => {
  const res = await q(company.owner, RANGE, { i: { employeeId: alice.employeeId, from, to } });
  return res.body.data.attendance.items[0].days.map((d: { status: string }) => d.status);
};

describe('work calendar: permissions', () => {
  it('rejects anonymous callers', async () => {
    expect(code(await gql(app, WORK_CALENDAR))).toBe('UNAUTHENTICATED');
  });

  it('lets an employee read the calendar but not change it', async () => {
    const read = await q(alice.agent, WORK_CALENDAR, { y: 2026 });
    expect(read.body.errors).toBeUndefined();
    expect(read.body.data.workCalendar.weeklyOffDays).toEqual([0]);
    const input = { holidayDate: '2026-12-25', name: 'Christmas' };
    expect(code(await q(alice.agent, CREATE_HOLIDAY, { i: input }))).toBe('FORBIDDEN');
    expect(code(await q(alice.agent, SET_WEEKLY_OFF, { i: { weeklyOffDays: [0, 6] } }))).toBe(
      'FORBIDDEN',
    );
    expect(code(await q(alice.agent, DELETE_HOLIDAY, { id: crypto.randomUUID() }))).toBe(
      'FORBIDDEN',
    );
  });
});

describe('weekly off days', () => {
  it('changes which days count as off, and validates the input', async () => {
    expect(await statuses('2026-11-14', '2026-11-16')).toEqual(['absent', 'off', 'absent']);

    const set = await q(company.owner, SET_WEEKLY_OFF, { i: { weeklyOffDays: [6, 0, 6] } });
    expect(set.body.data.updateWeeklyOff.weeklyOffDays).toEqual([0, 6]); // sorted, no duplicates
    expect(await statuses('2026-11-14', '2026-11-16')).toEqual(['off', 'off', 'absent']);

    for (const bad of [[7], [-1], [0, 1, 2, 3, 4, 5, 6]]) {
      const res = await q(company.owner, SET_WEEKLY_OFF, { i: { weeklyOffDays: bad } });
      expect(code(res)).toBe('VALIDATION_ERROR');
    }
    // Two-day weekend still in place after the rejected attempts.
    expect(await statuses('2026-11-14', '2026-11-14')).toEqual(['off']);

    await q(company.owner, SET_WEEKLY_OFF, { i: { weeklyOffDays: [0] } });
  });

  it('does not touch another organisation', async () => {
    await q(company.owner, SET_WEEKLY_OFF, { i: { weeklyOffDays: [5] } });
    const theirs = await q(other.owner, WORK_CALENDAR, { y: 2026 });
    expect(theirs.body.data.workCalendar.weeklyOffDays).toEqual([0]);
    await q(company.owner, SET_WEEKLY_OFF, { i: { weeklyOffDays: [0] } });
  });
});

describe('holidays', () => {
  it('creates, lists by year, edits with optimistic locking, and deletes', async () => {
    const made = await q(company.owner, CREATE_HOLIDAY, {
      i: { holidayDate: '2026-11-18', name: 'Founders day' },
    });
    const h = made.body.data.createHoliday;
    expect(h).toMatchObject({ holidayDate: '2026-11-18', name: 'Founders day', version: 1 });

    const next = await q(company.owner, CREATE_HOLIDAY, {
      i: { holidayDate: '2027-01-26', name: 'Republic Day' },
    });
    expect(next.body.errors).toBeUndefined();

    const y2026 = (await q(alice.agent, WORK_CALENDAR, { y: 2026 })).body.data.workCalendar;
    expect(y2026.holidays.map((x: { name: string }) => x.name)).toEqual(['Founders day']);
    // Defaults to the year of the (injected) clock.
    const dflt = (await q(alice.agent, WORK_CALENDAR)).body.data.workCalendar;
    expect(dflt.year).toBe(2026);

    const edited = await q(company.owner, UPDATE_HOLIDAY, {
      id: h.id,
      i: { holidayDate: '2026-11-19', name: 'Founders day (moved)', version: 1 },
    });
    expect(edited.body.data.updateHoliday).toMatchObject({ version: 2, holidayDate: '2026-11-19' });
    const stale = await q(company.owner, UPDATE_HOLIDAY, {
      id: h.id,
      i: { holidayDate: '2026-11-19', name: 'x y', version: 1 },
    });
    expect(code(stale)).toBe('CONFLICT');

    expect((await q(company.owner, DELETE_HOLIDAY, { id: h.id })).body.data.deleteHoliday).toBe(
      true,
    );
    expect(code(await q(company.owner, DELETE_HOLIDAY, { id: h.id }))).toBe('NOT_FOUND');
  });

  it('refuses two holidays on one date, and bad input', async () => {
    const input = { holidayDate: '2026-12-25', name: 'Christmas' };
    expect((await q(company.owner, CREATE_HOLIDAY, { i: input })).body.errors).toBeUndefined();
    const dup = await q(company.owner, CREATE_HOLIDAY, { i: { ...input, name: 'Again' } });
    expect(code(dup)).toBe('CONFLICT');
    expect(dup.body.errors[0].extensions.fieldErrors.holidayDate).toBeDefined();

    for (const bad of [
      { holidayDate: 'not-a-date', name: 'Valid name' },
      { holidayDate: '2026-02-30', name: 'Valid name' },
      { holidayDate: '2026-03-03', name: 'A' },
      { holidayDate: '2026-03-03', name: '<b>Bold</b>' },
    ]) {
      expect(code(await q(company.owner, CREATE_HOLIDAY, { i: bad }))).toBe('VALIDATION_ERROR');
    }
  });

  it('shows a holiday with no punches as a holiday, not absent', async () => {
    await q(company.owner, CREATE_HOLIDAY, {
      i: { holidayDate: '2026-11-17', name: 'Local fest' },
    });
    // Mon 16 absent, Tue 17 holiday, Wed 18 absent
    expect(await statuses('2026-11-16', '2026-11-18')).toEqual(['absent', 'holiday', 'absent']);
    const res = await q(company.owner, RANGE, {
      i: { employeeId: alice.employeeId, from: '2026-11-17', to: '2026-11-17' },
    });
    expect(res.body.errors).toBeUndefined();
  });

  it('keeps one organisation’s holidays and records away from another', async () => {
    const theirs = (await q(other.owner, WORK_CALENDAR, { y: 2026 })).body.data.workCalendar;
    expect(theirs.holidays).toEqual([]);
    const mine = (await q(company.owner, WORK_CALENDAR, { y: 2026 })).body.data.workCalendar;
    const someId = mine.holidays[0].id;
    expect(code(await q(other.owner, DELETE_HOLIDAY, { id: someId }))).toBe('NOT_FOUND');
    expect(
      code(
        await q(other.owner, UPDATE_HOLIDAY, {
          id: someId,
          i: { holidayDate: '2026-09-09', name: 'Stolen', version: 1 },
        }),
      ),
    ).toBe('NOT_FOUND');
  });
});
