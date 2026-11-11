import {
  PERMISSION_CATALOGUE,
  grantCovered,
  isPermissionGrant,
  type PermissionDef,
} from '@erp/shared';

export interface PermissionGroup {
  module: string;
  items: readonly PermissionDef[];
}

const MODULE_LABEL: Record<string, string> = {
  org: 'Organisation',
  branch: 'Branches',
  employee: 'Employees',
  rbac: 'Roles and users',
  accounts: 'Accounts',
  attendance: 'Attendance',
  payroll: 'Payroll',
  sale: 'Sales',
  store: 'Store',
  purchase: 'Purchase',
  report: 'Reports',
};

export const moduleLabel = (module: string) => MODULE_LABEL[module] ?? module;

/** The catalogue grouped by module, in catalogue order. */
export function groupCatalogue(
  catalogue: readonly PermissionDef[] = PERMISSION_CATALOGUE,
): PermissionGroup[] {
  const groups = new Map<string, PermissionDef[]>();
  for (const def of catalogue) groups.set(def.module, [...(groups.get(def.module) ?? []), def]);
  return [...groups].map(([module, items]) => ({ module, items }));
}

/**
 * Splits a role's grants into the ones the checkbox list can show and the rest
 * (wildcards such as `sale.*.*`). The editor keeps the rest untouched so
 * saving a role never silently drops a grant it cannot display.
 */
export function splitGrants(
  permissions: readonly string[],
  catalogue: readonly PermissionDef[] = PERMISSION_CATALOGUE,
) {
  const known = new Set(catalogue.map((p) => p.key));
  return {
    checked: permissions.filter((p) => known.has(p)),
    extra: permissions.filter((p) => !known.has(p)),
  };
}

export function toggleKey(list: readonly string[], key: string, on: boolean): string[] {
  const without = list.filter((k) => k !== key);
  return on ? [...without, key] : without;
}

export type ExtraGrantCheck = { ok: true; value: string } | { ok: false; message: string };

/** Validates a hand-typed grant such as `sale.*.view`. */
export function checkExtraGrant(
  raw: string,
  existing: readonly string[],
  actorPermissions: readonly string[],
): ExtraGrantCheck {
  const value = raw.trim().toLowerCase();
  if (!isPermissionGrant(value)) {
    return { ok: false, message: 'Use the form module.resource.action; * is allowed' };
  }
  if (existing.includes(value)) return { ok: false, message: 'Already added' };
  if (!grantCovered(actorPermissions, value)) {
    return { ok: false, message: 'You cannot grant a permission you do not have' };
  }
  return { ok: true, value };
}
