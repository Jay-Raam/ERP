import { describe, expect, it } from 'vitest';
import { finishedMonths, formatDays, monthName } from './format';

describe('monthName', () => {
  it('spells the month out', () => {
    expect(monthName('2026-10')).toBe('October 2026');
    expect(monthName('2026-01')).toBe('January 2026');
  });
});

describe('finishedMonths', () => {
  it('starts with the month before the current one', () => {
    const list = finishedMonths('2026-11-13', 3);
    expect(list.map((m) => m.value)).toEqual(['2026-10', '2026-09', '2026-08']);
    expect(list[0]!.label).toBe('October 2026');
  });

  it('wraps over the new year', () => {
    expect(finishedMonths('2026-01-05', 2).map((m) => m.value)).toEqual(['2025-12', '2025-11']);
  });

  it('gives a year of months by default', () => {
    const list = finishedMonths('2026-11-13');
    expect(list).toHaveLength(12);
    expect(list.at(-1)!.value).toBe('2025-11');
  });
});

describe('formatDays', () => {
  it('shows whole and half days', () => {
    expect(formatDays(62)).toBe('31');
    expect(formatDays(59)).toBe('29.5');
    expect(formatDays(1)).toBe('0.5');
    expect(formatDays(0)).toBe('0');
  });
});
