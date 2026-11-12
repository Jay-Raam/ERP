/** Pure rules for turning punches into a day's attendance. No database, no clock. */

export type PunchKind = 'in' | 'out';

export interface PunchLike {
  kind: PunchKind;
  at: Date;
}

export interface ShiftRules {
  /** "HH:MM" or "HH:MM:SS" in the organisation's time zone. */
  startTime: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
}

export type DayStatus =
  'present' | 'half_day' | 'short' | 'incomplete' | 'leave' | 'absent' | 'upcoming';

export interface DaySummary {
  date: string;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  late: boolean;
  /** An "in" with no matching "out" yet. */
  open: boolean;
  status: DayStatus;
}

export const MIN_GAP_SECONDS = 10;

/** The next punch must be the opposite of the last one; the first is always "in". */
export function nextPunchKind(last: PunchLike | null): PunchKind {
  return last?.kind === 'in' ? 'out' : 'in';
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(at: Date, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  const map: Record<string, string> = {};
  for (const p of f.formatToParts(at)) map[p.type] = p.value;
  return map;
}

/** The calendar day (YYYY-MM-DD) this instant falls on in the given zone. */
export function localDate(at: Date, timeZone: string): string {
  const p = parts(at, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Minutes after local midnight in the given zone. */
export function localMinutes(at: Date, timeZone: string): number {
  const p = parts(at, timeZone);
  return Number(p.hour) * 60 + Number(p.minute);
}

function minutesOfDay(time: string): number {
  const [h, m] = time.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * One employee, one local day. Punches must already be sorted by time.
 * Worked time is the sum of each in→out pair; a trailing "in" is open and
 * adds nothing until it is closed (the day shows "incomplete").
 */
export function summariseDay(
  date: string,
  punches: readonly PunchLike[],
  shift: ShiftRules | null,
  timeZone: string,
): DaySummary {
  let worked = 0;
  let openSince: Date | null = null;
  let firstIn: Date | null = null;
  let lastOut: Date | null = null;
  for (const p of punches) {
    if (p.kind === 'in') {
      if (!openSince) openSince = p.at;
      firstIn ??= p.at;
    } else if (openSince) {
      worked += Math.max(0, Math.round((p.at.getTime() - openSince.getTime()) / 60_000));
      openSince = null;
      lastOut = p.at;
    }
  }
  const late =
    shift !== null &&
    firstIn !== null &&
    localMinutes(firstIn, timeZone) > minutesOfDay(shift.startTime) + shift.graceMinutes;

  const full = shift?.fullDayMinutes ?? 480;
  const half = shift?.halfDayMinutes ?? 240;
  let status: DayStatus;
  if (openSince) status = 'incomplete';
  else if (worked >= full) status = 'present';
  else if (worked >= half) status = 'half_day';
  else status = 'short';

  return { date, firstIn, lastOut, workedMinutes: worked, late, open: openSince !== null, status };
}

/** Groups sorted punches by local date. */
export function groupByLocalDate<T extends PunchLike>(
  punches: readonly T[],
  timeZone: string,
): Map<string, T[]> {
  const days = new Map<string, T[]>();
  for (const p of punches) {
    const key = localDate(p.at, timeZone);
    const list = days.get(key);
    if (list) list.push(p);
    else days.set(key, [p]);
  }
  return days;
}

const DAY_MS = 86_400_000;

/** Every YYYY-MM-DD from `from` to `to`, inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export interface LeaveSpan {
  startDate: string;
  endDate: string;
}

/**
 * One employee across a date range. A day with punches is summarised from them;
 * otherwise it is leave (approved), upcoming (after today), not yet employed
 * (omitted), or absent.
 */
export function buildDays(opts: {
  from: string;
  to: string;
  today: string;
  joiningDate: string;
  punches: readonly (PunchLike & { id?: string })[];
  leave: readonly LeaveSpan[];
  shift: ShiftRules | null;
  timeZone: string;
}): (DaySummary & { punches: (PunchLike & { id?: string })[] })[] {
  const byDate = groupByLocalDate(opts.punches, opts.timeZone);
  const result: (DaySummary & { punches: (PunchLike & { id?: string })[] })[] = [];
  for (const date of eachDate(opts.from, opts.to)) {
    if (date < opts.joiningDate) continue;
    const dayPunches = byDate.get(date) ?? [];
    if (dayPunches.length > 0) {
      result.push({
        ...summariseDay(date, dayPunches, opts.shift, opts.timeZone),
        punches: dayPunches,
      });
      continue;
    }
    const onLeave = opts.leave.some((l) => l.startDate <= date && date <= l.endDate);
    const status: DayStatus = onLeave ? 'leave' : date > opts.today ? 'upcoming' : 'absent';
    result.push({
      date,
      firstIn: null,
      lastOut: null,
      workedMinutes: 0,
      late: false,
      open: false,
      status,
      punches: [],
    });
  }
  return result;
}
