import { describe, expect, it } from 'vitest';
import { addDays, formatDateRange, formatDuration, formatTime, zonedToIso } from './format';

describe('zonedToIso', () => {
  it('reads wall-clock time in the organisation zone, not the browser zone', () => {
    expect(zonedToIso('2026-11-10T09:00', 'Asia/Kolkata')).toBe('2026-11-10T03:30:00.000Z');
    expect(zonedToIso('2026-11-10T09:00', 'UTC')).toBe('2026-11-10T09:00:00.000Z');
  });

  it('follows daylight saving', () => {
    expect(zonedToIso('2026-01-15T09:00', 'America/New_York')).toBe('2026-01-15T14:00:00.000Z');
    expect(zonedToIso('2026-07-15T09:00', 'America/New_York')).toBe('2026-07-15T13:00:00.000Z');
  });
});

describe('formatting', () => {
  it('shows times in the given zone', () => {
    expect(formatTime('2026-11-11T04:00:00Z', 'Asia/Kolkata').toLowerCase()).toBe('9:30 am');
    expect(formatTime(null, 'UTC')).toBe('—');
  });

  it('formats durations and date ranges', () => {
    expect(formatDuration(95)).toBe('1h 35m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDateRange('2026-11-11', '2026-11-11')).not.toContain('–');
    expect(formatDateRange('2026-11-11', '2026-11-13')).toContain('–');
  });

  it('adds days across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
