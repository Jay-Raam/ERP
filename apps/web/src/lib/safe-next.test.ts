import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

describe('safeNext', () => {
  it('keeps same-site paths with their query', () => {
    expect(safeNext('/sale/invoices?page=2')).toBe('/sale/invoices?page=2');
  });

  it.each([
    null,
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'dashboard',
    '/login',
    '/register?x=1',
  ])('falls back to the dashboard for %s', (value) => {
    expect(safeNext(value)).toBe('/dashboard');
  });
});
