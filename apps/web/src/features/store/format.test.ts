import { describe, expect, it } from 'vitest';
import { MOVEMENT_LABEL, formatQty, formatSigned } from './format';
import { MOVEMENT_KINDS } from '@erp/shared';

describe('formatQty', () => {
  it('drops trailing zeros and groups thousands the Indian way', () => {
    expect(formatQty('12.500')).toBe('12.5');
    expect(formatQty('3.000')).toBe('3');
    expect(formatQty('0.000')).toBe('0');
    expect(formatQty('1250000.250')).toBe('12,50,000.25');
    expect(formatQty('99999999999.999')).toBe('99,99,99,99,999.999');
  });
  it('keeps the sign and leaves odd input alone', () => {
    expect(formatQty('-4.500')).toBe('-4.5');
    expect(formatQty('-0.500')).toBe('-0.5');
    expect(formatQty('abc')).toBe('abc');
  });
});

describe('formatSigned', () => {
  it('always shows a sign', () => {
    expect(formatSigned('10.000')).toBe('+10');
    expect(formatSigned('-2.500')).toBe('-2.5');
  });
});

describe('MOVEMENT_LABEL', () => {
  it('has a label for every kind', () => {
    for (const kind of MOVEMENT_KINDS) expect(MOVEMENT_LABEL[kind]).toBeTruthy();
  });
});
