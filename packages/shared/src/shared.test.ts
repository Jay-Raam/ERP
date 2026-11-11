import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROLES,
  cleanText,
  hasPermission,
  isErrorCode,
  isPermissionGrant,
  isPermissionKey,
  loginInputSchema,
  registerOrganisationInputSchema,
} from './index';

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

describe('default roles', () => {
  const role = (key: string) => DEFAULT_ROLES.find((r) => r.key === key)!;

  it('every seeded grant is well formed', () => {
    for (const r of DEFAULT_ROLES) {
      for (const grant of r.permissions) expect(isPermissionGrant(grant), grant).toBe(true);
    }
  });

  it('matches the agreed matrix on the sensitive cells', () => {
    expect(hasPermission(role('owner').permissions, 'payroll.run.approve')).toBe(true);
    expect(hasPermission(role('super_admin').permissions, 'payroll.run.prepare')).toBe(false);
    expect(hasPermission(role('super_admin').permissions, 'accounts.journal.post')).toBe(false);
    expect(hasPermission(role('super_admin').permissions, 'accounts.journal.view')).toBe(true);
    expect(hasPermission(role('account_team').permissions, 'payroll.run.prepare')).toBe(true);
    expect(hasPermission(role('account_team').permissions, 'payroll.run.approve')).toBe(false);
    expect(hasPermission(role('sale_team').permissions, 'purchase.order.create')).toBe(false);
    expect(hasPermission(role('employee').permissions, 'sale.invoice.view')).toBe(false);
    expect(hasPermission(role('employee').permissions, 'payroll.payslip.view-own')).toBe(true);
    expect(hasPermission(role('employee').permissions, 'payroll.payslip.view')).toBe(false);
  });
});

describe('registerOrganisationInputSchema', () => {
  const valid = {
    organisationName: '  Acme   Traders ',
    organisation: 'Acme-Traders',
    ownerName: 'Priya R',
    email: 'Priya@Acme.in',
    password: 'correct horse battery',
  };

  it('cleans and normalises valid input', () => {
    expect(registerOrganisationInputSchema.parse(valid)).toEqual({
      organisationName: 'Acme Traders',
      organisation: 'acme-traders',
      ownerName: 'Priya R',
      email: 'priya@acme.in',
      password: 'correct horse battery',
    });
  });

  it.each([
    ['organisationName', '<script>alert(1)</script>'],
    ['organisationName', 'A'],
    ['organisationName', 'x'.repeat(121)],
    ['ownerName', '<img src=x onerror=alert(1)>'],
    ['organisation', 'admin'],
    ['organisation', 'a b'],
    ['organisation', '../etc'],
    ['email', 'nope'],
    ['password', 'short'],
    ['password', 'p'.repeat(129)],
  ])('rejects %s = %s', (field, value) => {
    const result = registerOrganisationInputSchema.safeParse({ ...valid, [field]: value });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.path[0]).toBe(field);
  });

  it('rejects fields the form does not have', () => {
    expect(registerOrganisationInputSchema.safeParse({ ...valid, role: 'owner' }).success).toBe(
      false,
    );
    expect(registerOrganisationInputSchema.safeParse({ ...valid, tenantId: 'x' }).success).toBe(
      false,
    );
  });
});

describe('cleanText', () => {
  it('removes invisible and control characters', () => {
    expect(cleanText('  a\u0000b\u200bc\u202e  d\n\te ')).toBe('a b c d e');
  });
});
