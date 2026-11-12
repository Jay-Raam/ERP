import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
import { database, gql, registerOrg, testApp } from './helpers';
import {
  CREATE_ROLE,
  buildCompany,
  code,
  q,
  type Agent,
  type Org,
  type Person,
} from './hr-support';

const app = testApp();
afterAll(() => database.close());

const ITEM = `id sku name unit category reorderLevel status version`;
const WAREHOUSE = `id code name status version branch { id code }`;
const CREATE_ITEM = `mutation($i: CreateItemInput!){ createItem(input:$i){ ${ITEM} } }`;
const UPDATE_ITEM = `mutation($id: ID!, $i: UpdateItemInput!){ updateItem(id:$id,input:$i){ ${ITEM} } }`;
const LIST_ITEMS = `query($i: ListItemsInput){ items(input:$i){ total items { ${ITEM} } } }`;
const CREATE_WH = `mutation($i: CreateWarehouseInput!){ createWarehouse(input:$i){ ${WAREHOUSE} } }`;
const UPDATE_WH = `mutation($id: ID!, $i: UpdateWarehouseInput!){ updateWarehouse(id:$id,input:$i){ ${WAREHOUSE} } }`;
const WAREHOUSES = `query($i: ListWarehousesInput){ warehouses(input:$i){ ${WAREHOUSE} } }`;
const RECEIVE = `mutation($i: ReceiveStockInput!){ receiveStock(input:$i){ balance warehouseId itemId } }`;
const ISSUE = `mutation($i: IssueStockInput!){ issueStock(input:$i){ balance } }`;
const ADJUST = `mutation($i: AdjustStockInput!){ adjustStock(input:$i){ balance } }`;
const TRANSFER = `mutation($i: TransferStockInput!){ transferStock(input:$i){ transferId fromBalance toBalance } }`;
const LEVELS = `query($i: StockLevelsInput){ stockLevels(input:$i){ total items { id sku onHand low reorderLevel byWarehouse { quantity warehouse { code } } } } }`;
const MOVES = `query($i: MovementsInput){ stockMovements(input:$i){ total items { kind quantity balanceAfter reference reason transferId createdByName item { sku } warehouse { code } } } }`;

const STORE_KEEPER = [
  'store.item.view',
  'store.item.create',
  'store.item.update',
  'store.warehouse.view',
  'store.stock.view',
  'store.stock.receive',
  'store.stock.issue',
  'store.stock.adjust',
  'store.stock.transfer',
];
const VIEW_ONLY = ['store.item.view', 'store.warehouse.view', 'store.stock.view'];

let org: Org;
let company: Awaited<ReturnType<typeof buildCompany>>;
let keeper: Person; // branch 1, can do everything stock-related
let br2Keeper: Person; // branch 2
let viewer: Person; // organisation-wide, read only
let plain: Person; // Employee role: no store permissions
let main: string; // MAIN warehouse (head office)
let wh2: string; // warehouse in branch 2
let other: Awaited<ReturnType<typeof buildCompany>>;

let n = 0;
const sku = () => `T${String(++n).padStart(3, '0')}`;
const owner = () => company.owner;

async function newItem(extra: Record<string, unknown> = {}, as: Agent = owner()) {
  const res = await q(as, CREATE_ITEM, {
    i: { sku: sku(), unit: 'pcs', name: `Item ${n}`, ...extra },
  });
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  return res.body.data.createItem as { id: string; sku: string; version: number };
}

const receive = (itemId: string, warehouseId: string, quantity: string, as: Agent = owner()) =>
  q(as, RECEIVE, { i: { itemId, warehouseId, quantity } });
const onHand = async (itemId: string, as: Agent = owner(), warehouseId?: string) => {
  const res = await q(as, LEVELS, { i: { warehouseId } });
  const row = res.body.data.stockLevels.items.find((x: { id: string }) => x.id === itemId);
  return row?.onHand as string | undefined;
};

beforeAll(async () => {
  org = await registerOrg(app);
  company = await buildCompany(app, org);
  const mkRole = async (name: string, dataScope: string, permissions: string[]) => {
    const res = await q(owner(), CREATE_ROLE, { i: { name, dataScope, permissions } });
    expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
    return res.body.data.createRole.id as string;
  };
  company.roleId.keeper = await mkRole('Store keeper', 'branch', STORE_KEEPER);
  company.roleId.viewer = await mkRole('Store viewer', 'organisation', VIEW_ONLY);
  keeper = await company.person({ role: 'keeper', branch: company.ho, name: 'Kavi Keeper' });
  br2Keeper = await company.person({ role: 'keeper', branch: company.br2, name: 'Bala Keeper' });
  viewer = await company.person({ role: 'viewer', branch: company.ho, name: 'Vimal Viewer' });
  plain = await company.person({ role: 'employee', branch: company.ho, name: 'Plain Person' });

  main = (await q(owner(), WAREHOUSES)).body.data.warehouses[0].id;
  const made = await q(owner(), CREATE_WH, {
    i: { code: 'BR2-STORE', name: 'Branch 2 store', branchId: company.br2 },
  });
  expect(made.body.errors).toBeUndefined();
  wh2 = made.body.data.createWarehouse.id;
  other = await buildCompany(app, await registerOrg(app));
});

describe('store: permissions', () => {
  it('rejects anonymous callers', async () => {
    for (const query of [LIST_ITEMS, WAREHOUSES, LEVELS, MOVES]) {
      expect(code(await gql(app, query))).toBe('UNAUTHENTICATED');
    }
  });

  it('keeps a plain employee out of the store entirely', async () => {
    for (const query of [LIST_ITEMS, WAREHOUSES, LEVELS, MOVES]) {
      expect(code(await q(plain.agent, query))).toBe('FORBIDDEN');
    }
    const item = await newItem();
    expect(code(await receive(item.id, main, '1', plain.agent))).toBe('FORBIDDEN');
  });

  it('lets a read-only role look but not touch', async () => {
    const item = await newItem();
    expect((await q(viewer.agent, LIST_ITEMS)).body.errors).toBeUndefined();
    expect((await q(viewer.agent, LEVELS)).body.errors).toBeUndefined();
    const write = [
      q(viewer.agent, CREATE_ITEM, { i: { sku: 'NOPE', unit: 'pcs', name: 'No' } }),
      q(viewer.agent, CREATE_WH, { i: { code: 'NO', name: 'No', branchId: company.ho } }),
      receive(item.id, main, '1', viewer.agent),
      q(viewer.agent, ISSUE, { i: { itemId: item.id, warehouseId: main, quantity: '1' } }),
      q(viewer.agent, ADJUST, {
        i: { itemId: item.id, warehouseId: main, quantity: '1', reason: 'because' },
      }),
      q(viewer.agent, TRANSFER, {
        i: { itemId: item.id, fromWarehouseId: main, toWarehouseId: wh2, quantity: '1' },
      }),
    ];
    for (const res of await Promise.all(write)) expect(code(res)).toBe('FORBIDDEN');
  });
});

describe('store: defaults and warehouses', () => {
  it('gives every organisation a Main store at head office', async () => {
    const list = (await q(owner(), WAREHOUSES)).body.data.warehouses;
    const first = list.find((w: { code: string }) => w.code === 'MAIN');
    expect(first).toMatchObject({ name: 'Main store', status: 'active' });
    expect(first.branch.id).toBe(company.ho);
  });

  it('creates warehouses, refuses duplicate codes, and edits with optimistic locking', async () => {
    const made = await q(owner(), CREATE_WH, {
      i: { code: 'cold-1', name: 'Cold room', branchId: company.ho },
    });
    const w = made.body.data.createWarehouse;
    expect(w.code).toBe('COLD-1'); // normalised
    const dup = await q(owner(), CREATE_WH, {
      i: { code: 'COLD-1', name: 'Again', branchId: company.ho },
    });
    expect(code(dup)).toBe('CONFLICT');
    expect(dup.body.errors[0].extensions.fieldErrors.code).toBeDefined();

    const edit = await q(owner(), UPDATE_WH, {
      id: w.id,
      i: { name: 'Cold room A', status: 'active', version: 1 },
    });
    expect(edit.body.data.updateWarehouse).toMatchObject({ name: 'Cold room A', version: 2 });
    const stale = await q(owner(), UPDATE_WH, {
      id: w.id,
      i: { name: 'Cold room B', status: 'active', version: 1 },
    });
    expect(code(stale)).toBe('CONFLICT');
  });

  it('validates warehouse input, and the branch cannot be changed afterwards', async () => {
    for (const bad of [
      { code: 'X', name: 'Valid name', branchId: company.ho },
      { code: 'OK-1', name: '<b>x</b>', branchId: company.ho },
      { code: 'bad code!', name: 'Valid name', branchId: company.ho },
      { code: 'OK-2', name: 'Valid name', branchId: 'nope' },
    ]) {
      expect(code(await q(owner(), CREATE_WH, { i: bad }))).toBe('VALIDATION_ERROR');
    }
    const res = await q(owner(), UPDATE_WH, {
      id: wh2,
      i: { name: 'Moved', status: 'active', version: 1, branchId: company.ho },
    });
    expect(code(res)).toBe('BAD_REQUEST');
  });

  it('only shows branch-scoped people their own branch’s warehouses', async () => {
    const mine = (await q(keeper.agent, WAREHOUSES)).body.data.warehouses;
    expect(mine.every((w: { branch: { id: string } }) => w.branch.id === company.ho)).toBe(true);
    expect(mine.map((w: { id: string }) => w.id)).not.toContain(wh2);
    const theirs = (await q(br2Keeper.agent, WAREHOUSES)).body.data.warehouses;
    expect(theirs.map((w: { id: string }) => w.id)).toEqual([wh2]);
  });

  it('stops a branch-scoped manager creating a warehouse in another branch', async () => {
    const roleId = await q(owner(), CREATE_ROLE, {
      i: {
        name: 'Branch store lead',
        dataScope: 'branch',
        permissions: [...VIEW_ONLY, 'store.warehouse.manage'],
      },
    });
    company.roleId.lead = roleId.body.data.createRole.id;
    const lead = await company.person({ role: 'lead', branch: company.ho, name: 'Lena Lead' });
    expect(
      code(
        await q(lead.agent, CREATE_WH, {
          i: { code: 'ELSE-1', name: 'Elsewhere', branchId: company.br2 },
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(
      (
        await q(lead.agent, CREATE_WH, {
          i: { code: 'OWN-1', name: 'Own branch', branchId: company.ho },
        })
      ).body.errors,
    ).toBeUndefined();
    expect(
      code(
        await q(lead.agent, UPDATE_WH, {
          id: wh2,
          i: { name: 'Hijack', status: 'active', version: 1 },
        }),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('store: items', () => {
  it('creates items with a normalised SKU and refuses duplicates', async () => {
    const made = await q(keeper.agent, CREATE_ITEM, {
      i: {
        sku: ' ab-100 ',
        unit: 'kg',
        name: '  Rice   flour ',
        category: 'Grocery',
        reorderLevel: '12.5',
      },
    });
    expect(made.body.data.createItem).toMatchObject({
      sku: 'AB-100',
      name: 'Rice flour',
      unit: 'kg',
      category: 'Grocery',
      reorderLevel: '12.500',
      status: 'active',
      version: 1,
    });
    const dup = await q(keeper.agent, CREATE_ITEM, {
      i: { sku: 'AB-100', unit: 'pcs', name: 'Other' },
    });
    expect(code(dup)).toBe('CONFLICT');
    expect(dup.body.errors[0].extensions.fieldErrors.sku).toBeDefined();
  });

  it('rejects bad input', async () => {
    const good = { sku: 'GOOD-1', unit: 'pcs', name: 'Good item' };
    for (const bad of [
      { ...good, sku: 'a' },
      { ...good, sku: 'has space' },
      { ...good, unit: 'tonne' },
      { ...good, name: 'x' },
      { ...good, name: '<script>' },
      { ...good, category: '<i>' },
      { ...good, reorderLevel: '-1' },
      { ...good, reorderLevel: '1e3' },
      { ...good, reorderLevel: '1.2345' },
    ]) {
      expect(code(await q(keeper.agent, CREATE_ITEM, { i: bad })), JSON.stringify(bad)).toBe(
        'VALIDATION_ERROR',
      );
    }
  });

  it('edits name, category, reorder level and status; SKU and unit are fixed', async () => {
    const item = await newItem({ name: 'Edit me' });
    const edit = await q(keeper.agent, UPDATE_ITEM, {
      id: item.id,
      i: { name: 'Edited', category: null, reorderLevel: '3', status: 'inactive', version: 1 },
    });
    expect(edit.body.data.updateItem).toMatchObject({
      name: 'Edited',
      status: 'inactive',
      version: 2,
    });
    expect(
      code(
        await q(keeper.agent, UPDATE_ITEM, {
          id: item.id,
          i: { name: 'Again', status: 'active', version: 1 },
        }),
      ),
    ).toBe('CONFLICT');
    expect(
      code(
        await q(keeper.agent, UPDATE_ITEM, {
          id: item.id,
          i: { name: 'Again', status: 'active', version: 2, sku: 'NEW' },
        }),
      ),
    ).toBe('BAD_REQUEST');
  });

  it('searches, filters by status and pages', async () => {
    await newItem({ name: 'Searchable widget zzq' });
    const found = await q(keeper.agent, LIST_ITEMS, { i: { search: 'widget zzq' } });
    expect(found.body.data.items.total).toBe(1);
    const inactive = await q(keeper.agent, LIST_ITEMS, { i: { status: 'inactive' } });
    expect(
      inactive.body.data.items.items.every((x: { status: string }) => x.status === 'inactive'),
    ).toBe(true);
    const page = await q(keeper.agent, LIST_ITEMS, { i: { limit: 2, offset: 0 } });
    expect(page.body.data.items.items).toHaveLength(2);
    expect(page.body.data.items.total).toBeGreaterThan(2);
    // % and _ are plain characters in a search, not wildcards.
    expect((await q(keeper.agent, LIST_ITEMS, { i: { search: '%' } })).body.data.items.total).toBe(
      0,
    );
  });

  it('treats a malformed or foreign id as an error, not a crash', async () => {
    const GET = `query($id: ID!){ item(id:$id){ id } }`;
    expect(code(await q(owner(), GET, { id: 'nope' }))).toBe('VALIDATION_ERROR');
    const theirs = (
      await q(other.owner, CREATE_ITEM, { i: { sku: 'THEIRS', unit: 'pcs', name: 'Their item' } })
    ).body.data.createItem.id;
    expect(code(await q(owner(), GET, { id: theirs }))).toBe('NOT_FOUND');
  });
});

describe('store: receiving, issuing and adjusting', () => {
  it('moves the balance and writes the ledger', async () => {
    const item = await newItem({ unit: 'kg' });
    expect((await receive(item.id, main, '100')).body.data.receiveStock.balance).toBe('100.000');
    const issued = await q(keeper.agent, ISSUE, {
      i: { itemId: item.id, warehouseId: main, quantity: '30.25', reference: 'Order 7' },
    });
    expect(issued.body.data.issueStock.balance).toBe('69.750');
    const adj = await q(keeper.agent, ADJUST, {
      i: { itemId: item.id, warehouseId: main, quantity: '-4.5', reason: 'Damaged in handling' },
    });
    expect(adj.body.data.adjustStock.balance).toBe('65.250');

    const moves = (await q(owner(), MOVES, { i: { itemId: item.id } })).body.data.stockMovements;
    expect(moves.total).toBe(3);
    // Newest first, each row records the balance right after it.
    expect(moves.items.map((m: { kind: string }) => m.kind)).toEqual([
      'adjustment',
      'issue',
      'receipt',
    ]);
    expect(moves.items.map((m: { balanceAfter: string }) => m.balanceAfter)).toEqual([
      '65.250',
      '69.750',
      '100.000',
    ]);
    expect(moves.items.map((m: { quantity: string }) => m.quantity)).toEqual([
      '-4.500',
      '-30.250',
      '100.000',
    ]);
    expect(moves.items[1]).toMatchObject({ reference: 'Order 7', createdByName: 'Kavi Keeper' });
    expect(moves.items[0].reason).toBe('Damaged in handling');
  });

  it('never lets stock go negative, and leaves no trace of the failed attempt', async () => {
    const item = await newItem();
    await receive(item.id, main, '5');
    const res = await q(owner(), ISSUE, {
      i: { itemId: item.id, warehouseId: main, quantity: '5.001' },
    });
    expect(code(res)).toBe('BUSINESS_RULE');
    expect(res.body.errors[0].extensions.fieldErrors.quantity[0]).toMatch(/only 5 on hand/);
    const adj = await q(owner(), ADJUST, {
      i: { itemId: item.id, warehouseId: main, quantity: '-6', reason: 'Recount' },
    });
    expect(code(adj)).toBe('BUSINESS_RULE');
    expect(await onHand(item.id)).toBe('5.000');
    expect(
      (await q(owner(), MOVES, { i: { itemId: item.id } })).body.data.stockMovements.total,
    ).toBe(1);
    // Issuing from a warehouse that never held the item is also refused.
    expect(
      code(await q(owner(), ISSUE, { i: { itemId: item.id, warehouseId: wh2, quantity: '1' } })),
    ).toBe('BUSINESS_RULE');
  });

  it('adds decimals exactly', async () => {
    const item = await newItem({ unit: 'l' });
    await receive(item.id, main, '0.1');
    expect((await receive(item.id, main, '0.2')).body.data.receiveStock.balance).toBe('0.300');
    expect(await onHand(item.id)).toBe('0.300');
  });

  it('validates quantities', async () => {
    const item = await newItem();
    for (const quantity of [
      '0',
      '0.000',
      '-1',
      '1e3',
      '1.2345',
      'abc',
      '',
      ' ',
      '99999999999999',
      '01',
      '.5',
    ]) {
      expect(code(await receive(item.id, main, quantity)), `receive ${quantity}`).toBe(
        'VALIDATION_ERROR',
      );
    }
    for (const quantity of ['0', '-0', '1e3', 'x']) {
      const res = await q(owner(), ADJUST, {
        i: { itemId: item.id, warehouseId: main, quantity, reason: 'Recount' },
      });
      expect(code(res), `adjust ${quantity}`).toBe('VALIDATION_ERROR');
    }
    // An adjustment always needs a reason.
    expect(
      code(
        await q(owner(), ADJUST, {
          i: { itemId: item.id, warehouseId: main, quantity: '1', reason: ' ' },
        }),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(await onHand(item.id)).toBe('0.000');
  });

  it('refuses inactive items and warehouses, and unknown ids', async () => {
    const item = await newItem();
    await q(owner(), UPDATE_ITEM, {
      id: item.id,
      i: { name: 'Retired', status: 'inactive', version: 1 },
    });
    expect(code(await receive(item.id, main, '1'))).toBe('VALIDATION_ERROR');

    const live = await newItem();
    const w = (
      await q(owner(), CREATE_WH, { i: { code: 'OLD-1', name: 'Old store', branchId: company.ho } })
    ).body.data.createWarehouse;
    await q(owner(), UPDATE_WH, {
      id: w.id,
      i: { name: 'Old store', status: 'inactive', version: 1 },
    });
    expect(code(await receive(live.id, w.id, '1'))).toBe('VALIDATION_ERROR');

    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(code(await receive(ghost, main, '1'))).toBe('NOT_FOUND');
    expect(code(await receive(live.id, ghost, '1'))).toBe('NOT_FOUND');
  });

  it('keeps a branch-scoped keeper inside their branch', async () => {
    const item = await newItem();
    expect((await receive(item.id, main, '10', keeper.agent)).body.errors).toBeUndefined();
    // Another branch's warehouse looks like it does not exist.
    expect(code(await receive(item.id, wh2, '10', keeper.agent))).toBe('NOT_FOUND');
    expect(code(await receive(item.id, main, '10', br2Keeper.agent))).toBe('NOT_FOUND');
  });
});

describe('store: transfers', () => {
  it('moves stock between warehouses as two linked ledger rows', async () => {
    const item = await newItem();
    await receive(item.id, main, '10');
    const res = await q(owner(), TRANSFER, {
      i: {
        itemId: item.id,
        fromWarehouseId: main,
        toWarehouseId: wh2,
        quantity: '4',
        reference: 'TR-1',
      },
    });
    expect(res.body.data.transferStock).toMatchObject({ fromBalance: '6.000', toBalance: '4.000' });
    expect(await onHand(item.id, owner(), main)).toBe('6.000');
    expect(await onHand(item.id, owner(), wh2)).toBe('4.000');
    expect(await onHand(item.id)).toBe('10.000'); // nothing created or lost

    const legs = (
      await q(owner(), MOVES, { i: { itemId: item.id } })
    ).body.data.stockMovements.items.filter((m: { transferId: string | null }) => m.transferId);
    expect(legs).toHaveLength(2);
    expect(legs[0].transferId).toBe(legs[1].transferId);
    expect(legs.map((l: { kind: string }) => l.kind).sort()).toEqual([
      'transfer_in',
      'transfer_out',
    ]);
  });

  it('refuses a transfer that is too big, to the same place, or into the unknown — changing nothing', async () => {
    const item = await newItem();
    await receive(item.id, main, '3');
    const base = { itemId: item.id, fromWarehouseId: main, toWarehouseId: wh2 };
    expect(code(await q(owner(), TRANSFER, { i: { ...base, quantity: '3.5' } }))).toBe(
      'BUSINESS_RULE',
    );
    expect(
      code(await q(owner(), TRANSFER, { i: { ...base, toWarehouseId: main, quantity: '1' } })),
    ).toBe('VALIDATION_ERROR');
    expect(
      code(
        await q(owner(), TRANSFER, {
          i: { ...base, toWarehouseId: '00000000-0000-4000-8000-000000000000', quantity: '1' },
        }),
      ),
    ).toBe('NOT_FOUND');
    expect(await onHand(item.id, owner(), main)).toBe('3.000');
    expect(await onHand(item.id, owner(), wh2)).toBe('0.000');
    expect(
      (await q(owner(), MOVES, { i: { itemId: item.id } })).body.data.stockMovements.total,
    ).toBe(1);
  });

  it('cannot move stock into or out of a warehouse outside the person’s branch', async () => {
    const item = await newItem();
    await receive(item.id, main, '5');
    const res = await q(keeper.agent, TRANSFER, {
      i: { itemId: item.id, fromWarehouseId: main, toWarehouseId: wh2, quantity: '1' },
    });
    expect(code(res)).toBe('NOT_FOUND');
    expect(await onHand(item.id, owner(), main)).toBe('5.000');
  });
});

describe('store: concurrency', () => {
  it('lets exactly as many issues succeed as there is stock', async () => {
    const item = await newItem();
    await receive(item.id, main, '5');
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        q(owner(), ISSUE, { i: { itemId: item.id, warehouseId: main, quantity: '1' } }),
      ),
    );
    const ok = results.filter((r) => !r.body.errors).length;
    expect(ok).toBe(5);
    expect(results.filter((r) => code(r) === 'BUSINESS_RULE')).toHaveLength(7);
    expect(await onHand(item.id)).toBe('0.000');
    const moves = (await q(owner(), MOVES, { i: { itemId: item.id } })).body.data.stockMovements;
    expect(moves.total).toBe(6); // 1 receipt + 5 issues
  });

  it('does not deadlock when transfers run in opposite directions at once', async () => {
    const item = await newItem();
    await receive(item.id, main, '50');
    await receive(item.id, wh2, '50');
    const calls = Array.from({ length: 24 }, (_, i) =>
      q(owner(), TRANSFER, {
        i:
          i % 2 === 0
            ? { itemId: item.id, fromWarehouseId: main, toWarehouseId: wh2, quantity: '1' }
            : { itemId: item.id, fromWarehouseId: wh2, toWarehouseId: main, quantity: '1' },
      }),
    );
    const results = await Promise.all(calls);
    expect(
      results.every((r) => !r.body.errors),
      JSON.stringify(results.find((r) => r.body.errors)?.body),
    ).toBe(true);
    expect(await onHand(item.id)).toBe('100.000');
  });
});

describe('store: stock levels and movements', () => {
  it('flags items at or below their reorder level and breaks stock down by warehouse', async () => {
    const lowItem = await newItem({ name: 'Running low qq', reorderLevel: '10' });
    const fine = await newItem({ name: 'Plenty qq', reorderLevel: '10' });
    const never = await newItem({ name: 'No level qq' });
    await receive(lowItem.id, main, '10');
    await receive(fine.id, main, '11');
    await receive(fine.id, wh2, '4');
    const all = (await q(owner(), LEVELS, { i: { search: 'qq', limit: 50 } })).body.data
      .stockLevels;
    const by = Object.fromEntries(all.items.map((x: { id: string }) => [x.id, x]));
    expect(by[lowItem.id]).toMatchObject({ onHand: '10.000', low: true });
    expect(by[fine.id]).toMatchObject({ onHand: '15.000', low: false });
    expect(by[never.id]).toMatchObject({ onHand: '0.000', low: false });
    expect(
      by[fine.id].byWarehouse.map((b: { warehouse: { code: string }; quantity: string }) => [
        b.warehouse.code,
        b.quantity,
      ]),
    ).toEqual([
      ['BR2-STORE', '4.000'],
      ['MAIN', '11.000'],
    ]);

    const onlyLow = (await q(owner(), LEVELS, { i: { search: 'qq', lowOnly: true } })).body.data
      .stockLevels;
    expect(onlyLow.items.map((x: { id: string }) => x.id)).toEqual([lowItem.id]);
    expect(onlyLow.total).toBe(1);

    const inWh2 = (await q(owner(), LEVELS, { i: { search: 'qq', warehouseId: wh2 } })).body.data
      .stockLevels;
    expect(inWh2.items.find((x: { id: string }) => x.id === fine.id).onHand).toBe('4.000');
  });

  it('counts only the warehouses a branch-scoped person can see', async () => {
    const item = await newItem({ name: 'Scoped zzs' });
    await receive(item.id, main, '7');
    await receive(item.id, wh2, '9');
    expect(await onHand(item.id, owner())).toBe('16.000');
    expect(await onHand(item.id, keeper.agent)).toBe('7.000');
    expect(await onHand(item.id, br2Keeper.agent)).toBe('9.000');
    const moves = (await q(keeper.agent, MOVES, { i: { itemId: item.id } })).body.data
      .stockMovements;
    expect(moves.items.map((m: { warehouse: { code: string } }) => m.warehouse.code)).toEqual([
      'MAIN',
    ]);
    expect(code(await q(keeper.agent, LEVELS, { i: { warehouseId: wh2 } }))).toBe('NOT_FOUND');
  });

  it('filters movements by kind and warehouse, and pages them', async () => {
    const item = await newItem();
    await receive(item.id, main, '8');
    await q(owner(), ISSUE, { i: { itemId: item.id, warehouseId: main, quantity: '2' } });
    const issues = await q(owner(), MOVES, { i: { itemId: item.id, kind: 'issue' } });
    expect(issues.body.data.stockMovements.items).toHaveLength(1);
    const page = await q(owner(), MOVES, { i: { itemId: item.id, limit: 1, offset: 1 } });
    expect(page.body.data.stockMovements.total).toBe(2);
    expect(page.body.data.stockMovements.items[0].kind).toBe('receipt');
    expect(code(await q(owner(), MOVES, { i: { limit: 500 } }))).toBe('VALIDATION_ERROR');
  });
});

describe('store: isolation and database guarantees', () => {
  it('never shows or touches another organisation’s store', async () => {
    const theirs = (
      await q(other.owner, CREATE_ITEM, {
        i: { sku: 'ISOLATED', unit: 'pcs', name: 'Isolated item' },
      })
    ).body.data.createItem;
    const theirWh = (await q(other.owner, WAREHOUSES)).body.data.warehouses[0].id;
    await receive(theirs.id, theirWh, '9', other.owner);

    const mine = (await q(owner(), LIST_ITEMS, { i: { search: 'ISOLATED' } })).body.data.items;
    expect(mine.total).toBe(0);
    expect(code(await receive(theirs.id, main, '1'))).toBe('NOT_FOUND');
    const item = await newItem();
    expect(code(await receive(item.id, theirWh, '1'))).toBe('NOT_FOUND');
    expect(
      code(
        await q(owner(), UPDATE_ITEM, {
          id: theirs.id,
          i: { name: 'Hijack', status: 'active', version: 1 },
        }),
      ),
    ).toBe('NOT_FOUND');
  });

  it('is enforced by the database: the ledger cannot be edited or deleted, balances cannot go negative', async () => {
    const item = await newItem();
    await receive(item.id, main, '2');
    const [row] = await database.db.execute<{ tenant_id: string }>(
      sql`select tenant_id from items where id = ${item.id}`,
    );
    const tid = row!.tenant_id;
    await expect(
      withTenant(database.db, tid, (tx) =>
        tx.execute(sql`update stock_movements set quantity = 99 where item_id = ${item.id}`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(database.db, tid, (tx) =>
        tx.execute(sql`delete from stock_movements where item_id = ${item.id}`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(database.db, tid, (tx) =>
        tx.execute(sql`update stock_balances set quantity = -1 where item_id = ${item.id}`),
      ),
    ).rejects.toThrow();
    expect(await onHand(item.id)).toBe('2.000');
  });
});

describe('store: limits found by the security review', () => {
  it('refuses to take a warehouse past its maximum instead of failing with a 500', async () => {
    const item = await newItem();
    expect((await receive(item.id, main, '99999999999.999')).body.data.receiveStock.balance).toBe(
      '99999999999.999',
    );
    const over = await receive(item.id, main, '0.001');
    expect(code(over)).toBe('BUSINESS_RULE');
    expect(over.body.errors[0].extensions.fieldErrors.quantity[0]).toMatch(/Too much stock/);
    const adj = await q(owner(), ADJUST, {
      i: { itemId: item.id, warehouseId: main, quantity: '1', reason: 'Recount' },
    });
    expect(code(adj)).toBe('BUSINESS_RULE');
    expect(await onHand(item.id)).toBe('99999999999.999');
  });

  it('refuses a transfer into a full warehouse and changes nothing', async () => {
    const item = await newItem();
    await receive(item.id, wh2, '99999999999.999');
    await receive(item.id, main, '5');
    for (const [from, to] of [
      [main, wh2],
      [wh2, main],
    ] as const) {
      // Whichever order the legs run in, the destination being full is a clean rule error.
      if (from === wh2) continue;
      const res = await q(owner(), TRANSFER, {
        i: { itemId: item.id, fromWarehouseId: from, toWarehouseId: to, quantity: '1' },
      });
      expect(code(res)).toBe('BUSINESS_RULE');
    }
    expect(await onHand(item.id, owner(), main)).toBe('5.000');
    expect(await onHand(item.id, owner(), wh2)).toBe('99999999999.999');
    expect(
      (await q(owner(), MOVES, { i: { itemId: item.id } })).body.data.stockMovements.total,
    ).toBe(2);
  });

  it('ignores control characters in a search instead of crashing', async () => {
    await newItem({ name: 'Searchable nul item' });
    const hit = await q(owner(), LIST_ITEMS, { i: { search: 'nul\u0000 item' } });
    expect(hit.body.errors).toBeUndefined();
    expect(hit.body.data.items.total).toBe(1);
    const levels = await q(owner(), LEVELS, { i: { search: '\u0000' } });
    expect(levels.body.errors).toBeUndefined();
  });

  it('limits how fast one user can change stock', async () => {
    const strict = testApp({ limits: { stockWritesPerUser: { limit: 3, windowMs: 60_000 } } });
    const o = await registerOrg(strict);
    const c = await buildCompany(strict, o);
    const item = (
      await q(c.owner, CREATE_ITEM, { i: { sku: 'RATE-1', unit: 'pcs', name: 'Rate item' } })
    ).body.data.createItem.id;
    const wh = (await q(c.owner, WAREHOUSES)).body.data.warehouses[0].id;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await receive(item, wh, '1', c.owner));
    expect(results.map((r) => code(r) ?? 'ok')).toEqual([
      'ok',
      'ok',
      'ok',
      'RATE_LIMITED',
      'RATE_LIMITED',
    ]);
    expect(await onHand(item, c.owner)).toBe('3.000');
  });
});
