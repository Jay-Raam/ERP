import { DEFAULT_ROLES } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { NAVIGATION, visibleNavigation } from './navigation';

const labelsFor = (roleKey: string) =>
  visibleNavigation(DEFAULT_ROLES.find((r) => r.key === roleKey)!.permissions).map((i) => i.label);

describe('visibleNavigation', () => {
  it('shows the Owner everything', () => {
    expect(labelsFor('owner')).toEqual(NAVIGATION.map((i) => i.label));
  });

  it('shows an Employee only self-service areas', () => {
    expect(labelsFor('employee')).toEqual(['Dashboard', 'Attendance', 'Payroll']);
  });

  it('hides Purchase and Roles from the Sale team', () => {
    const labels = labelsFor('sale_team');
    expect(labels).toContain('Sales');
    expect(labels).toContain('Store');
    expect(labels).not.toContain('Purchase');
    expect(labels).not.toContain('Roles');
    expect(labels).not.toContain('Branches');
  });

  it('shows the Account team accounts, purchase bills and financial reports', () => {
    const labels = labelsFor('account_team');
    expect(labels).toEqual(expect.arrayContaining(['Accounts', 'Payroll', 'Purchase', 'Reports']));
    expect(labels).not.toContain('Roles');
    expect(labels).not.toContain('Employees');
  });

  it('shows someone with no permissions only the dashboard', () => {
    expect(visibleNavigation([]).map((i) => i.label)).toEqual(['Dashboard']);
  });

  it('shows Users, Roles and Branches to a Super Admin but not to the Sale team', () => {
    expect(labelsFor('super_admin')).toEqual(
      expect.arrayContaining(['Users', 'Roles', 'Branches']),
    );
    expect(labelsFor('sale_team')).not.toContain('Users');
  });
});

describe('groupedNavigation', () => {
  it('lists sections in order and drops empty ones', async () => {
    const { groupedNavigation } = await import('./navigation');
    const employee = DEFAULT_ROLES.find((r) => r.key === 'employee')!.permissions;
    expect(groupedNavigation(employee).map((g) => g.group)).toEqual([
      'Overview',
      'Operations',
      'Finance',
    ]);
    const owner = DEFAULT_ROLES.find((r) => r.key === 'owner')!.permissions;
    expect(groupedNavigation(owner).map((g) => g.group)).toEqual([
      'Overview',
      'Organisation',
      'Operations',
      'Finance',
    ]);
  });
});
