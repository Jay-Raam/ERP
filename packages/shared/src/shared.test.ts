import { describe, expect, it } from 'vitest';
import { hasPermission, isErrorCode, isPermissionKey, loginInputSchema } from './index';

describe('hasPermission', () => {
  it('grants on exact match and wildcards', () => {
    expect(hasPermission(['sale.invoice.create'], 'sale.invoice.create')).toBe(true);
    expect(hasPermission(['*'], 'payroll.run.approve')).toBe(true);
    expect(hasPermission(['sale.*.*'], 'sale.invoice.create')).toBe(true);
    expect(hasPermission(['sale.invoice.*'], 'sale.invoice.void')).toBe(true);
  });

  it('denies everything else', () => {
    expect(hasPermission([], 'sale.invoice.create')).toBe(false);
    expect(hasPermission(['sale.invoice.view'], 'sale.invoice.create')).toBe(false);
    expect(hasPermission(['sale.*.*'], 'store.item.create')).toBe(false);
    expect(hasPermission(['sale.invoice'], 'sale.invoice.create')).toBe(false);
    expect(hasPermission(['*'], 'not a key')).toBe(false);
    expect(hasPermission(['*'], '')).toBe(false);
  });
});

describe('isPermissionKey', () => {
  it('accepts known modules only', () => {
    expect(isPermissionKey('sale.invoice.create')).toBe(true);
    expect(isPermissionKey('hacker.invoice.create')).toBe(false);
    expect(isPermissionKey('sale.invoice')).toBe(false);
  });
});

describe('loginInputSchema', () => {
  it('normalises organisation and email', () => {
    const parsed = loginInputSchema.parse({
      organisation: '  Acme-Traders ',
      email: ' Owner@Acme.IN ',
      password: ' keep spaces ',
    });
    expect(parsed).toEqual({
      organisation: 'acme-traders',
      email: 'owner@acme.in',
      password: ' keep spaces ',
    });
  });

  it('rejects unknown fields, bad slugs and bad emails', () => {
    const base = { organisation: 'acme', email: 'a@b.co', password: 'x' };
    expect(loginInputSchema.safeParse({ ...base, role: 'owner' }).success).toBe(false);
    expect(loginInputSchema.safeParse({ ...base, organisation: "acme'; drop" }).success).toBe(
      false,
    );
    expect(loginInputSchema.safeParse({ ...base, email: '<script>@x' }).success).toBe(false);
    expect(loginInputSchema.safeParse({ ...base, password: 'p'.repeat(129) }).success).toBe(false);
  });
});

describe('isErrorCode', () => {
  it('recognises only known codes', () => {
    expect(isErrorCode('FORBIDDEN')).toBe(true);
    expect(isErrorCode('NOPE')).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });
});
