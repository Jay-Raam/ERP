import { describe, expect, it } from 'vitest';
import { checkExtraGrant, groupCatalogue, splitGrants, toggleKey } from './permission-model';

describe('permission model', () => {
  it('groups the catalogue by module', () => {
    const groups = groupCatalogue();
    expect(groups.map((g) => g.module)).toContain('rbac');
    for (const g of groups) expect(g.items.every((i) => i.module === g.module)).toBe(true);
  });

  it('keeps wildcard grants apart so saving never drops them', () => {
    const { checked, extra } = splitGrants(['rbac.role.view', 'sale.*.*', 'report.sales.view']);
    expect(checked).toEqual(['rbac.role.view']);
    expect(extra).toEqual(['sale.*.*', 'report.sales.view']);
  });

  it('toggles a key without duplicating it', () => {
    expect(toggleKey(['a.b.c'], 'a.b.c', true)).toEqual(['a.b.c']);
    expect(toggleKey(['a.b.c'], 'a.b.c', false)).toEqual([]);
    expect(toggleKey([], 'x.y.z', true)).toEqual(['x.y.z']);
  });

  it('validates hand-typed grants', () => {
    const actor = ['sale.*.*'];
    expect(checkExtraGrant(' SALE.invoice.view ', [], actor)).toEqual({
      ok: true,
      value: 'sale.invoice.view',
    });
    expect(checkExtraGrant('nonsense', [], actor).ok).toBe(false);
    expect(checkExtraGrant('sale.invoice.view', ['sale.invoice.view'], actor).ok).toBe(false);
    expect(checkExtraGrant('store.*.*', [], actor).ok).toBe(false);
    expect(checkExtraGrant('*', [], actor).ok).toBe(false);
  });
});
