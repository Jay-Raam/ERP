/**
 * Permissions are data. A key looks like `sale.invoice.create`
 * (module.resource.action). A role is a set of keys; `*` segments are wildcards.
 */
export const MODULES = [
  'org',
  'branch',
  'employee',
  'rbac',
  'accounts',
  'attendance',
  'payroll',
  'sale',
  'store',
  'purchase',
  'report',
] as const;

export type ModuleKey = (typeof MODULES)[number];
export type PermissionKey = `${ModuleKey}.${string}.${string}`;

/** Owner holds this and can never be locked out. */
export const WILDCARD = '*';

const KEY_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export function isPermissionKey(value: string): value is PermissionKey {
  return KEY_PATTERN.test(value) && (MODULES as readonly string[]).includes(value.split('.')[0]!);
}

function matches(granted: string, required: string): boolean {
  if (granted === WILDCARD) return true;
  const g = granted.split('.');
  const r = required.split('.');
  if (g.length !== 3 || r.length !== 3) return false;
  return g.every((segment, i) => segment === WILDCARD || segment === r[i]);
}

/**
 * True when any granted key covers the required key.
 * Supports `*`, `sale.*.*` and `sale.invoice.*`. Unknown or malformed input denies.
 */
export function hasPermission(granted: Iterable<string>, required: string): boolean {
  if (!KEY_PATTERN.test(required)) return false;
  for (const key of granted) {
    if (matches(key, required)) return true;
  }
  return false;
}
