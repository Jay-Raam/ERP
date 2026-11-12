import type { DayStatus, LeaveStatus } from './api';

/** "9:30 am" in the organisation's time zone (not the browser's). */
export function formatTime(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/** "Wed, 11 Nov" for a YYYY-MM-DD calendar date (no time zone shifting). */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatDateRange(start: string, end: string): string {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  present: 'Present',
  half_day: 'Half day',
  short: 'Short',
  incomplete: 'Not clocked out',
  leave: 'On leave',
  absent: 'Absent',
  off: 'Day off',
  holiday: 'Holiday',
  upcoming: '',
};

export const LEAVE_STATUS_LABEL: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** Local calendar date (YYYY-MM-DD) of the browser, for default date pickers. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

/**
 * Reads a <input type="datetime-local"> value ("2026-11-10T09:00") as wall-clock
 * time in the organisation's zone, and returns the matching UTC instant as ISO.
 */
export function zonedToIso(local: string, timeZone: string): string {
  const guess = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  let utc = guess - offsetMinutes(guess, timeZone) * 60_000;
  utc = guess - offsetMinutes(utc, timeZone) * 60_000; // settle across a DST change
  return new Date(utc).toISOString();
}

/** Index 0 = Sunday, matching the API's weeklyOffDays. */
export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** "Sunday", "Saturday and Sunday", "Friday, Saturday and Sunday" or "none". */
export function describeWeeklyOff(days: readonly number[]): string {
  const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAYS[d] ?? '');
  if (names.length === 0) return 'none';
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
