import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLES, OWNER_ROLE_KEY } from '@erp/shared';
import { hashPassword } from '../core/password';
import * as orgRepo from '../modules/org/repository';
import * as adminRepo from '../modules/admin/repository';
import { ensureHrDefaults } from '../modules/hr/defaults.repository';
import { insertEmployee } from '../modules/hr/employees.repository';
import { ensureStoreDefaults } from '../modules/store/defaults.repository';
import * as storeRepo from '../modules/store/store.repository';
import { createDatabase } from './client';
import { shifts } from './schema';
import { findTenantBySlug, withTenant } from './tenant';

/** Local demo data. Every account shares one well-known password, so never run this in production. */
export const DEMO_ORG = 'demo';
export const DEMO_PASSWORD = 'Demo@12345678';

export const DEMO_USERS = [
  { email: 'owner@demo.test', fullName: 'Priya Raman', role: 'owner', branches: ['HO', 'CHN-1'] },
  { email: 'admin@demo.test', fullName: 'Arjun Kumar', role: 'super_admin', branches: ['HO'] },
  { email: 'sales@demo.test', fullName: 'Divya Menon', role: 'sale_team', branches: ['CHN-1'] },
  { email: 'accounts@demo.test', fullName: 'Karthik S', role: 'account_team', branches: ['HO'] },
  { email: 'employee@demo.test', fullName: 'Meena Iyer', role: 'employee', branches: ['CHN-1'] },
] as const;

const DEMO_ITEMS = [
  {
    sku: 'RICE-25',
    name: 'Basmati rice 25 kg bag',
    unit: 'pcs',
    category: 'Grocery',
    reorder: '20',
    stock: '120',
  },
  {
    sku: 'OIL-1L',
    name: 'Sunflower oil 1 L',
    unit: 'pcs',
    category: 'Grocery',
    reorder: '50',
    stock: '40',
  },
  {
    sku: 'SUGAR',
    name: 'Sugar',
    unit: 'kg',
    category: 'Grocery',
    reorder: '100',
    stock: '640.500',
  },
  {
    sku: 'PEN-BLUE',
    name: 'Ball pen, blue',
    unit: 'box',
    category: 'Stationery',
    reorder: '10',
    stock: '25',
  },
  {
    sku: 'A4-RIM',
    name: 'A4 paper rim',
    unit: 'pack',
    category: 'Stationery',
    reorder: '15',
    stock: '0',
  },
] as const;

export async function seedDemo(url: string): Promise<'created' | 'exists'> {
  const handle = createDatabase(url, { max: 2 });
  try {
    if (await findTenantBySlug(handle.db, DEMO_ORG)) return 'exists';

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const tenantId = randomUUID();
    await withTenant(handle.db, tenantId, async (tx) => {
      await orgRepo.insertOrganisation(tx, { id: tenantId, slug: DEMO_ORG, name: 'Demo Traders' });
      const roleIds = await orgRepo.insertRoles(tx, tenantId, DEFAULT_ROLES);
      const ho = await orgRepo.insertBranch(tx, {
        tenantId,
        code: 'HO',
        name: 'Head Office',
        isHeadOffice: true,
      });
      const chn = await adminRepo.insertBranchRow(tx, {
        tenantId,
        code: 'CHN-1',
        name: 'Chennai One',
      });
      const branchByCode: Record<string, string> = { HO: ho.id, 'CHN-1': chn };
      await ensureHrDefaults(tx, tenantId);
      const [general] = await tx.select({ id: shifts.id }).from(shifts).limit(1);
      let n = 0;
      let adminId = '';
      for (const u of DEMO_USERS) {
        const userId = await adminRepo.insertUserRow(tx, {
          tenantId,
          email: u.email,
          passwordHash,
          fullName: u.fullName,
          roleId: roleIds.get(u.role === 'owner' ? OWNER_ROLE_KEY : u.role)!,
        });
        await adminRepo.replaceUserBranches(
          tx,
          tenantId,
          userId,
          u.branches.map((code) => branchByCode[code]!),
        );
        if (u.role === 'super_admin') adminId = userId;
        n += 1;
        await insertEmployee(tx, {
          tenantId,
          employeeCode: `EMP-${String(n).padStart(3, '0')}`,
          fullName: u.fullName,
          email: u.email,
          phone: null,
          branchId: branchByCode[u.branches[0]]!,
          department: null,
          designation: null,
          joiningDate: '2024-04-01',
          shiftId: general?.id ?? null,
          userId,
        });
      }

      // Starter store: one warehouse at head office and a few items, some of them running low.
      await ensureStoreDefaults(tx, tenantId);
      const [main] = await storeRepo.listWarehouses(tx, { scope: { kind: 'organisation' } });
      for (const item of DEMO_ITEMS) {
        const itemId = await storeRepo.insertItem(tx, {
          tenantId,
          sku: item.sku,
          name: item.name,
          unit: item.unit,
          category: item.category,
          reorderLevel: item.reorder,
        });
        if (main && Number(item.stock) > 0) {
          await storeRepo.applyMovement(tx, {
            tenantId,
            itemId,
            warehouseId: main.id,
            kind: 'receipt',
            delta: item.stock,
            reference: 'Opening stock',
            reason: null,
            createdBy: adminId,
          });
        }
      }
    });
    return 'created';
  } finally {
    await handle.close();
  }
}

// CLI: pnpm db:seed
if (process.argv[1] && /seed\.(ts|cjs|js)$/.test(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('Set DATABASE_URL\n');
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production') {
    process.stderr.write('Refusing to seed demo accounts when NODE_ENV=production\n');
    process.exit(1);
  }
  seedDemo(url)
    .then((result) => {
      process.stdout.write(
        result === 'exists'
          ? `Demo organisation "${DEMO_ORG}" already exists. Nothing changed.\n`
          : `Demo organisation "${DEMO_ORG}" created.\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(`seed failed: ${(error as Error).message}\n`);
      process.exit(1);
    });
}
