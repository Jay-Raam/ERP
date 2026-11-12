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

const SUPPLIER = `id code name contactName email phone gstin address status version`;
const LINE = `id quantity receivedQuantity unitPrice gstRate subtotal taxAmount total item { id sku name unit }`;
const ORDER = `id number status orderDate expectedDate notes subtotal taxTotal grandTotal version createdByName approvedByName approvedAt cancelledAt supplier { id code name } branch { id code }`;
const DETAIL = `${ORDER} lines { ${LINE} } receipts { id number supplierInvoiceNo notes receivedByName warehouse { code } lines { quantity item { sku } } }`;

const CREATE_SUPPLIER = `mutation($i: CreateSupplierInput!){ createSupplier(input:$i){ ${SUPPLIER} } }`;
const UPDATE_SUPPLIER = `mutation($id: ID!, $i: UpdateSupplierInput!){ updateSupplier(id:$id,input:$i){ ${SUPPLIER} } }`;
const LIST_SUPPLIERS = `query($i: ListSuppliersInput){ suppliers(input:$i){ total items { ${SUPPLIER} } } }`;
const CREATE_ORDER = `mutation($i: CreateOrderInput!){ createPurchaseOrder(input:$i){ ${DETAIL} } }`;
const UPDATE_ORDER = `mutation($id: ID!, $i: UpdateOrderInput!){ updatePurchaseOrder(id:$id,input:$i){ ${DETAIL} } }`;
const APPROVE = `mutation($id: ID!, $i: OrderDecisionInput!){ approvePurchaseOrder(id:$id,input:$i){ ${DETAIL} } }`;
const CANCEL = `mutation($id: ID!, $i: OrderDecisionInput!){ cancelPurchaseOrder(id:$id,input:$i){ ${DETAIL} } }`;
const RECEIVE = `mutation($i: ReceiveGoodsInput!){ receiveGoods(input:$i){ ${DETAIL} } }`;
const GET_ORDER = `query($id: ID!){ purchaseOrder(id:$id){ ${DETAIL} } }`;
const LIST_ORDERS = `query($i: ListOrdersInput){ purchaseOrders(input:$i){ total items { ${ORDER} } } }`;

const CREATE_ITEM = `mutation($i: CreateItemInput!){ createItem(input:$i){ id sku version } }`;
const WAREHOUSES = `{ warehouses { id code } }`;
const CREATE_WH = `mutation($i: CreateWarehouseInput!){ createWarehouse(input:$i){ id code version } }`;
const UPDATE_WH = `mutation($id: ID!, $i: UpdateWarehouseInput!){ updateWarehouse(id:$id,input:$i){ id } }`;
const LEVELS = `query($i: StockLevelsInput){ stockLevels(input:$i){ items { id onHand byWarehouse { quantity warehouse { code } } } } }`;
const MOVES = `query($i: MovementsInput){ stockMovements(input:$i){ total items { kind quantity reference reason balanceAfter warehouse { code } } } }`;

const BUYER = [
  'purchase.supplier.view',
  'purchase.supplier.create',
  'purchase.supplier.update',
  'purchase.order.view',
  'purchase.order.create',
  'purchase.order.cancel',
  'purchase.receipt.view',
  'purchase.receipt.create',
  'store.item.view',
  'store.warehouse.view',
  'store.stock.view',
];
const APPROVER = [
  'purchase.supplier.view',
  'purchase.order.view',
  'purchase.order.approve',
  'purchase.receipt.view',
];
const VIEW_ONLY = ['purchase.supplier.view', 'purchase.order.view'];

let org: Org;
let company: Awaited<ReturnType<typeof buildCompany>>;
let buyer: Person; // branch HO
let buyer2: Person; // branch BR2
let approver: Person; // organisation scope
let viewer: Person;
let plain: Person;
let supplierId: string;
let main: string;
let wh2: string;
let other: Awaited<ReturnType<typeof buildCompany>>;

const owner = () => company.owner;
const today = '2026-11-12';
let n = 0;

const line = (itemId: string, extra: Record<string, unknown> = {}) => ({
  itemId,
  quantity: '10',
  unitPrice: '100',
  gstRate: 18,
  ...extra,
});

async function newItem(unit = 'pcs') {
  const res = await q(owner(), CREATE_ITEM, {
    i: { sku: `PO${String(++n).padStart(3, '0')}`, unit, name: `Purchase item ${n}` },
  });
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  return res.body.data.createItem as { id: string; sku: string; version: number };
}

async function newOrder(
  lines: Record<string, unknown>[],
  as: Agent = buyer.agent,
  extra: Record<string, unknown> = {},
) {
  const res = await q(as, CREATE_ORDER, {
    i: { supplierId, branchId: company.ho, orderDate: today, lines, ...extra },
  });
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  return res.body.data.createPurchaseOrder as {
    id: string;
    number: string;
    version: number;
    status: string;
    lines: { id: string; item: { id: string } }[];
  };
}

async function approvedOrder(lines: Record<string, unknown>[]) {
  const o = await newOrder(lines);
  const res = await q(approver.agent, APPROVE, { id: o.id, i: { version: o.version } });
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  return res.body.data.approvePurchaseOrder as typeof o;
}

const receive = (
  as: Agent,
  orderId: string,
  lines: { orderLineId: string; quantity: string }[],
  extra: Record<string, unknown> = {},
) => q(as, RECEIVE, { i: { orderId, warehouseId: main, lines, ...extra } });

const onHand = async (itemId: string, warehouseId?: string) => {
  const res = await q(owner(), LEVELS, { i: { warehouseId, limit: 100 } });
  return res.body.data.stockLevels.items.find((x: { id: string }) => x.id === itemId)
    ?.onHand as string;
};

beforeAll(async () => {
  org = await registerOrg(app);
  company = await buildCompany(app, org);
  const mkRole = async (name: string, dataScope: string, permissions: string[]) => {
    const res = await q(owner(), CREATE_ROLE, { i: { name, dataScope, permissions } });
    expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
    return res.body.data.createRole.id as string;
  };
  company.roleId.buyer = await mkRole('Buyer', 'branch', BUYER);
  company.roleId.approver = await mkRole('Approver', 'organisation', APPROVER);
  company.roleId.viewer = await mkRole('Purchase viewer', 'organisation', VIEW_ONLY);
  buyer = await company.person({ role: 'buyer', branch: company.ho, name: 'Bala Buyer' });
  buyer2 = await company.person({ role: 'buyer', branch: company.br2, name: 'Bina Buyer' });
  approver = await company.person({ role: 'approver', branch: company.ho, name: 'Anand Approver' });
  viewer = await company.person({ role: 'viewer', branch: company.ho, name: 'Vimal Viewer' });
  plain = await company.person({ role: 'employee', branch: company.ho, name: 'Plain Person' });

  const sup = await q(owner(), CREATE_SUPPLIER, {
    i: { code: 'SUP-1', name: 'Sri Murugan Traders', gstin: '33ABCDE1234F1Z5' },
  });
  expect(sup.body.errors, JSON.stringify(sup.body.errors)).toBeUndefined();
  supplierId = sup.body.data.createSupplier.id;
  main = (await q(owner(), WAREHOUSES)).body.data.warehouses[0].id;
  const made = await q(owner(), CREATE_WH, {
    i: { code: 'BR2-STORE', name: 'Branch 2 store', branchId: company.br2 },
  });
  wh2 = made.body.data.createWarehouse.id;
  other = await buildCompany(app, await registerOrg(app));
});

describe('purchase: permissions', () => {
  it('rejects anonymous callers', async () => {
    for (const query of [LIST_SUPPLIERS, LIST_ORDERS]) {
      expect(code(await gql(app, query))).toBe('UNAUTHENTICATED');
    }
  });

  it('keeps a plain employee out', async () => {
    for (const query of [LIST_SUPPLIERS, LIST_ORDERS]) {
      expect(code(await q(plain.agent, query))).toBe('FORBIDDEN');
    }
    const item = await newItem();
    const res = await q(plain.agent, CREATE_ORDER, {
      i: { supplierId, branchId: company.ho, orderDate: today, lines: [line(item.id)] },
    });
    expect(code(res)).toBe('FORBIDDEN');
  });

  it('lets a viewer read but not change anything', async () => {
    const item = await newItem();
    const o = await newOrder([line(item.id)]);
    expect((await q(viewer.agent, LIST_ORDERS)).body.errors).toBeUndefined();
    expect((await q(viewer.agent, GET_ORDER, { id: o.id })).body.errors).toBeUndefined();
    // No receipt permission: the receipts list comes back empty instead of leaking.
    expect(
      (await q(viewer.agent, GET_ORDER, { id: o.id })).body.data.purchaseOrder.receipts,
    ).toEqual([]);
    const attempts = [
      q(viewer.agent, CREATE_SUPPLIER, { i: { code: 'NOPE', name: 'Nope supplier' } }),
      q(viewer.agent, CREATE_ORDER, {
        i: { supplierId, branchId: company.ho, orderDate: today, lines: [line(item.id)] },
      }),
      q(viewer.agent, APPROVE, { id: o.id, i: { version: o.version } }),
      q(viewer.agent, CANCEL, { id: o.id, i: { version: o.version } }),
      receive(viewer.agent, o.id, [{ orderLineId: o.lines[0]!.id, quantity: '1' }]),
    ];
    for (const res of await Promise.all(attempts)) expect(code(res)).toBe('FORBIDDEN');
  });

  it('separates buying from approving', async () => {
    const item = await newItem();
    const o = await newOrder([line(item.id)]);
    expect(code(await q(buyer.agent, APPROVE, { id: o.id, i: { version: o.version } }))).toBe(
      'FORBIDDEN',
    );
    expect(
      code(
        await q(approver.agent, CREATE_ORDER, {
          i: { supplierId, branchId: company.ho, orderDate: today, lines: [line(item.id)] },
        }),
      ),
    ).toBe('FORBIDDEN');
  });
});

describe('purchase: suppliers', () => {
  it('creates with a normalised code and GSTIN, and refuses duplicates', async () => {
    const made = await q(buyer.agent, CREATE_SUPPLIER, {
      i: {
        code: ' kvr-2 ',
        name: '  KVR   Agencies ',
        email: 'Sales@KVR.example',
        phone: '+91 98765 43210',
        gstin: '33aabcu9603r1zx',
        contactName: 'Ravi',
        address: '12 Market Road, Chennai',
      },
    });
    expect(made.body.errors, JSON.stringify(made.body.errors)).toBeUndefined();
    expect(made.body.data.createSupplier).toMatchObject({
      code: 'KVR-2',
      name: 'KVR Agencies',
      email: 'sales@kvr.example',
      gstin: '33AABCU9603R1ZX',
      status: 'active',
      version: 1,
    });
    const dup = await q(buyer.agent, CREATE_SUPPLIER, {
      i: { code: 'KVR-2', name: 'Another one' },
    });
    expect(code(dup)).toBe('CONFLICT');
    expect(dup.body.errors[0].extensions.fieldErrors.code).toBeDefined();
  });

  it('rejects bad input', async () => {
    const good = { code: 'OK-1', name: 'Good supplier' };
    for (const bad of [
      { ...good, code: 'x' },
      { ...good, code: 'has space' },
      { ...good, name: '<b>x</b>' },
      { ...good, email: 'not-an-email' },
      { ...good, phone: 'call me' },
      { ...good, gstin: '33ABCDE1234F1Z' },
      { ...good, gstin: '99ABCDE1234F1Q5' },
      { ...good, address: 'x'.repeat(301) },
    ]) {
      expect(code(await q(buyer.agent, CREATE_SUPPLIER, { i: bad })), JSON.stringify(bad)).toBe(
        'VALIDATION_ERROR',
      );
    }
  });

  it('edits with optimistic locking; the code is fixed', async () => {
    const made = (await q(buyer.agent, CREATE_SUPPLIER, { i: { code: 'EDIT-1', name: 'Edit me' } }))
      .body.data.createSupplier;
    const edit = await q(buyer.agent, UPDATE_SUPPLIER, {
      id: made.id,
      i: { name: 'Edited', status: 'inactive', version: 1, email: null },
    });
    expect(edit.body.data.updateSupplier).toMatchObject({
      name: 'Edited',
      status: 'inactive',
      version: 2,
    });
    expect(
      code(
        await q(buyer.agent, UPDATE_SUPPLIER, {
          id: made.id,
          i: { name: 'Again', status: 'active', version: 1 },
        }),
      ),
    ).toBe('CONFLICT');
    expect(
      code(
        await q(buyer.agent, UPDATE_SUPPLIER, {
          id: made.id,
          i: { name: 'Again', status: 'active', version: 2, code: 'NEW' },
        }),
      ),
    ).toBe('BAD_REQUEST');
  });

  it('searches and pages, treating wildcards as plain text', async () => {
    const found = await q(buyer.agent, LIST_SUPPLIERS, { i: { search: 'murugan' } });
    expect(found.body.data.suppliers.total).toBe(1);
    expect(
      (await q(buyer.agent, LIST_SUPPLIERS, { i: { search: '%' } })).body.data.suppliers.total,
    ).toBe(0);
    expect(
      (await q(buyer.agent, LIST_SUPPLIERS, { i: { search: 'a\u0000b' } })).body.errors,
    ).toBeUndefined();
    expect(
      (await q(buyer.agent, LIST_SUPPLIERS, { i: { limit: 1 } })).body.data.suppliers.items,
    ).toHaveLength(1);
  });
});

describe('purchase: orders and totals', () => {
  it('works out every amount on the server, to the paisa', async () => {
    const a = await newItem();
    const b = await newItem();
    const o = await q(buyer.agent, CREATE_ORDER, {
      i: {
        supplierId,
        branchId: company.ho,
        orderDate: today,
        expectedDate: '2026-11-20',
        notes: ' Urgent ',
        lines: [
          { itemId: a.id, quantity: '3', unitPrice: '100.50', gstRate: 18 },
          { itemId: b.id, quantity: '0.333', unitPrice: '10.01', gstRate: 5 },
        ],
      },
    });
    expect(o.body.errors, JSON.stringify(o.body.errors)).toBeUndefined();
    const order = o.body.data.createPurchaseOrder;
    expect(order).toMatchObject({
      status: 'draft',
      notes: 'Urgent',
      subtotal: '304.83',
      taxTotal: '54.44',
      grandTotal: '359.27',
      createdByName: 'Bala Buyer',
      approvedByName: null,
    });
    expect(order.number).toMatch(/^PO-\d{6}$/);
    const byItem = Object.fromEntries(
      order.lines.map((l: { item: { id: string } }) => [l.item.id, l]),
    );
    expect(byItem[a.id]).toMatchObject({
      subtotal: '301.50',
      taxAmount: '54.27',
      total: '355.77',
      receivedQuantity: '0.000',
    });
    // 0.333 x 10.01 = 3.33333 -> 3.33; 5% of 3.33 = 0.1665 -> 0.17
    expect(byItem[b.id]).toMatchObject({ subtotal: '3.33', taxAmount: '0.17', total: '3.50' });
  });

  it('never accepts totals or other fields from the client', async () => {
    const item = await newItem();
    for (const extra of [
      { grandTotal: '1.00' },
      { status: 'approved' },
      { tenantId: 'x' },
      { number: 'PO-000001' },
    ]) {
      const res = await q(buyer.agent, CREATE_ORDER, {
        i: { supplierId, branchId: company.ho, orderDate: today, lines: [line(item.id)], ...extra },
      });
      expect(code(res), JSON.stringify(extra)).toBe('BAD_REQUEST');
    }
    const res = await q(buyer.agent, CREATE_ORDER, {
      i: {
        supplierId,
        branchId: company.ho,
        orderDate: today,
        lines: [{ ...line(item.id), total: '1' }],
      },
    });
    expect(code(res)).toBe('BAD_REQUEST');
  });

  it('validates lines and dates', async () => {
    const item = await newItem();
    const other2 = await newItem();
    const base = { supplierId, branchId: company.ho, orderDate: today };
    const cases: Record<string, unknown>[] = [
      { lines: [] },
      { lines: [line(item.id), line(item.id)] },
      { lines: [line(item.id, { quantity: '0' })] },
      { lines: [line(item.id, { quantity: '1.2345' })] },
      { lines: [line(item.id, { unitPrice: '0' })] },
      { lines: [line(item.id, { unitPrice: '-5' })] },
      { lines: [line(item.id, { unitPrice: '1.999' })] },
      { lines: [line(item.id, { unitPrice: '1e3' })] },
      { lines: [line(item.id, { gstRate: 7 })] },
      { lines: [line(item.id, { quantity: '99999999999.999', unitPrice: '999999999999.99' })] },
      { lines: [line(other2.id)], orderDate: '2026-13-45' },
      { lines: [line(other2.id)], expectedDate: '2026-11-01' },
      { lines: [line(other2.id)], notes: '<script>' },
      { lines: Array.from({ length: 101 }, () => line(item.id)) },
    ];
    for (const extra of cases) {
      const res = await q(buyer.agent, CREATE_ORDER, { i: { ...base, ...extra } });
      expect(code(res), JSON.stringify(extra).slice(0, 80) + JSON.stringify(res.body.errors)).toBe(
        'VALIDATION_ERROR',
      );
    }
  });

  it('refuses unknown, inactive or foreign suppliers and items', async () => {
    const item = await newItem();
    const ghost = '00000000-0000-4000-8000-000000000000';
    const make = (i: Record<string, unknown>) =>
      q(buyer.agent, CREATE_ORDER, {
        i: { supplierId, branchId: company.ho, orderDate: today, lines: [line(item.id)], ...i },
      });
    expect(code(await make({ supplierId: ghost }))).toBe('VALIDATION_ERROR');
    expect(code(await make({ lines: [line(ghost)] }))).toBe('VALIDATION_ERROR');

    const theirSupplier = (
      await q(other.owner, CREATE_SUPPLIER, { i: { code: 'THEIRS', name: 'Their supplier' } })
    ).body.data.createSupplier.id;
    const theirItem = (
      await q(other.owner, CREATE_ITEM, { i: { sku: 'THEIRS', unit: 'pcs', name: 'Their item' } })
    ).body.data.createItem.id;
    expect(code(await make({ supplierId: theirSupplier }))).toBe('VALIDATION_ERROR');
    expect(code(await make({ lines: [line(theirItem)] }))).toBe('VALIDATION_ERROR');

    const inactive = (
      await q(owner(), CREATE_SUPPLIER, { i: { code: 'OLD-S', name: 'Old supplier' } })
    ).body.data.createSupplier;
    await q(owner(), UPDATE_SUPPLIER, {
      id: inactive.id,
      i: { name: 'Old supplier', status: 'inactive', version: 1 },
    });
    expect(code(await make({ supplierId: inactive.id }))).toBe('VALIDATION_ERROR');
  });

  it('numbers orders one after another without repeats, even when created in parallel', async () => {
    const item = await newItem();
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        q(buyer.agent, CREATE_ORDER, {
          i: { supplierId, branchId: company.ho, orderDate: today, lines: [line(item.id)] },
        }),
      ),
    );
    expect(results.every((r) => !r.body.errors)).toBe(true);
    const numbers = results.map((r) => r.body.data.createPurchaseOrder.number as string);
    expect(new Set(numbers).size).toBe(12);
    const values = numbers.map((x) => Number(x.slice(3))).sort((a, b) => a - b);
    expect(values[11]! - values[0]!).toBe(11); // consecutive
  });

  it('edits a draft (lines replaced, totals recomputed) with version checking', async () => {
    const a = await newItem();
    const b = await newItem();
    const o = await newOrder([line(a.id)]);
    const res = await q(buyer.agent, UPDATE_ORDER, {
      id: o.id,
      i: {
        supplierId,
        orderDate: today,
        lines: [line(b.id, { quantity: '2', unitPrice: '50', gstRate: 0 })],
        version: o.version,
      },
    });
    expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
    const updated = res.body.data.updatePurchaseOrder;
    expect(updated).toMatchObject({
      subtotal: '100.00',
      taxTotal: '0.00',
      grandTotal: '100.00',
      version: 2,
    });
    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0].item.id).toBe(b.id);
    const stale = await q(buyer.agent, UPDATE_ORDER, {
      id: o.id,
      i: { supplierId, orderDate: today, lines: [line(a.id)], version: 1 },
    });
    expect(code(stale)).toBe('CONFLICT');
    expect(
      (await q(buyer.agent, GET_ORDER, { id: o.id })).body.data.purchaseOrder.lines,
    ).toHaveLength(1);
  });

  it('lists with filters and paging', async () => {
    const item = await newItem();
    const o = await newOrder([line(item.id)]);
    const byNumber = await q(buyer.agent, LIST_ORDERS, { i: { search: o.number } });
    expect(byNumber.body.data.purchaseOrders.total).toBe(1);
    const bySupplier = await q(buyer.agent, LIST_ORDERS, {
      i: { search: 'murugan', status: 'draft', limit: 2 },
    });
    expect(bySupplier.body.data.purchaseOrders.items).toHaveLength(2);
    expect(
      (
        await q(buyer.agent, LIST_ORDERS, { i: { status: 'received' } })
      ).body.data.purchaseOrders.items.every((x: { status: string }) => x.status === 'received'),
    ).toBe(true);
    expect(code(await q(buyer.agent, LIST_ORDERS, { i: { limit: 500 } }))).toBe('VALIDATION_ERROR');
    expect(code(await q(buyer.agent, GET_ORDER, { id: 'nope' }))).toBe('VALIDATION_ERROR');
  });
});

describe('purchase: approval and cancelling', () => {
  it('needs someone other than the author to approve, and locks the order afterwards', async () => {
    const item = await newItem();
    const o = await newOrder([line(item.id)], owner());
    const own = await q(owner(), APPROVE, { id: o.id, i: { version: o.version } });
    expect(code(own)).toBe('BUSINESS_RULE');
    expect(own.body.errors[0].message).toMatch(/cannot approve an order you created/);

    const stale = await q(approver.agent, APPROVE, { id: o.id, i: { version: 99 } });
    expect(code(stale)).toBe('CONFLICT');
    const ok = await q(approver.agent, APPROVE, { id: o.id, i: { version: o.version } });
    expect(ok.body.data.approvePurchaseOrder).toMatchObject({
      status: 'approved',
      approvedByName: 'Anand Approver',
      version: 2,
    });
    expect(ok.body.data.approvePurchaseOrder.approvedAt).toBeTruthy();
    // Approved: no more edits, no second approval.
    expect(
      code(
        await q(buyer.agent, UPDATE_ORDER, {
          id: o.id,
          i: { supplierId, orderDate: today, lines: [line(item.id)], version: 2 },
        }),
      ),
    ).toBe('BUSINESS_RULE');
    expect(code(await q(approver.agent, APPROVE, { id: o.id, i: { version: 2 } }))).toBe(
      'BUSINESS_RULE',
    );
  });

  it('refuses to approve when the supplier or an item has gone inactive meanwhile', async () => {
    const sup = (
      await q(owner(), CREATE_SUPPLIER, { i: { code: 'GONE-1', name: 'Going supplier' } })
    ).body.data.createSupplier;
    const item = await newItem();
    const o = (
      await q(buyer.agent, CREATE_ORDER, {
        i: { supplierId: sup.id, branchId: company.ho, orderDate: today, lines: [line(item.id)] },
      })
    ).body.data.createPurchaseOrder;
    await q(owner(), UPDATE_SUPPLIER, {
      id: sup.id,
      i: { name: 'Going supplier', status: 'inactive', version: 1 },
    });
    expect(code(await q(approver.agent, APPROVE, { id: o.id, i: { version: o.version } }))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('cancels a draft or approved order, but nothing that has been received', async () => {
    const item = await newItem();
    const draft = await newOrder([line(item.id)]);
    const cancelled = await q(buyer.agent, CANCEL, { id: draft.id, i: { version: draft.version } });
    expect(cancelled.body.data.cancelPurchaseOrder.status).toBe('cancelled');
    expect(code(await q(buyer.agent, CANCEL, { id: draft.id, i: { version: 2 } }))).toBe(
      'BUSINESS_RULE',
    );
    expect(code(await q(approver.agent, APPROVE, { id: draft.id, i: { version: 2 } }))).toBe(
      'BUSINESS_RULE',
    );

    const approved = await approvedOrder([line(item.id)]);
    expect(
      (await q(buyer.agent, CANCEL, { id: approved.id, i: { version: approved.version } })).body
        .errors,
    ).toBeUndefined();

    const partly = await approvedOrder([line(item.id)]);
    await receive(buyer.agent, partly.id, [{ orderLineId: partly.lines[0]!.id, quantity: '1' }]);
    const refused = await q(buyer.agent, CANCEL, {
      id: partly.id,
      i: { version: partly.version + 1 },
    });
    expect(code(refused)).toBe('BUSINESS_RULE');
    // A cancelled order cannot receive goods.
    expect(
      code(
        await receive(buyer.agent, draft.id, [{ orderLineId: draft.lines[0]!.id, quantity: '1' }]),
      ),
    ).toBe('BUSINESS_RULE');
  });
});

describe('purchase: receiving goods', () => {
  it('adds stock to the ledger, in as many deliveries as it takes', async () => {
    const a = await newItem();
    const b = await newItem();
    const o = await approvedOrder([
      line(a.id, { quantity: '10' }),
      line(b.id, { quantity: '5.5', unitPrice: '20', gstRate: 5 }),
    ]);
    const la = o.lines.find((l) => l.item.id === a.id)!.id;
    const lb = o.lines.find((l) => l.item.id === b.id)!.id;

    const first = await receive(
      buyer.agent,
      o.id,
      [
        { orderLineId: la, quantity: '4' },
        { orderLineId: lb, quantity: '5.5' },
      ],
      { supplierInvoiceNo: 'INV-77', notes: 'First lorry' },
    );
    expect(first.body.errors, JSON.stringify(first.body.errors)).toBeUndefined();
    const afterFirst = first.body.data.receiveGoods;
    expect(afterFirst.status).toBe('partly_received');
    expect(afterFirst.receipts).toHaveLength(1);
    expect(afterFirst.receipts[0]).toMatchObject({
      supplierInvoiceNo: 'INV-77',
      notes: 'First lorry',
      receivedByName: 'Bala Buyer',
      warehouse: { code: 'MAIN' },
    });
    expect(afterFirst.receipts[0].number).toMatch(/^GRN-\d{6}$/);
    expect(await onHand(a.id)).toBe('4.000');
    expect(await onHand(b.id)).toBe('5.500');

    const ledger = (await q(owner(), MOVES, { i: { itemId: a.id } })).body.data.stockMovements
      .items[0];
    expect(ledger).toMatchObject({
      kind: 'receipt',
      quantity: '4.000',
      reference: afterFirst.receipts[0].number,
      reason: 'Supplier invoice INV-77',
      warehouse: { code: 'MAIN' },
    });

    const second = await receive(buyer.agent, o.id, [{ orderLineId: la, quantity: '6' }]);
    const done = second.body.data.receiveGoods;
    expect(done.status).toBe('received');
    expect(done.receipts).toHaveLength(2);
    expect(
      done.lines.find((l: { item: { id: string } }) => l.item.id === a.id).receivedQuantity,
    ).toBe('10.000');
    expect(await onHand(a.id)).toBe('10.000');
    // Nothing left to receive.
    expect(code(await receive(buyer.agent, o.id, [{ orderLineId: la, quantity: '1' }]))).toBe(
      'BUSINESS_RULE',
    );
  });

  it('refuses to receive more than was ordered, and leaves no trace', async () => {
    const item = await newItem();
    const o = await approvedOrder([line(item.id, { quantity: '5' })]);
    const l = o.lines[0]!.id;
    await receive(buyer.agent, o.id, [{ orderLineId: l, quantity: '3' }]);
    const over = await receive(buyer.agent, o.id, [{ orderLineId: l, quantity: '2.001' }]);
    expect(code(over)).toBe('BUSINESS_RULE');
    expect(over.body.errors[0].extensions.fieldErrors['lines.0.quantity'][0]).toMatch(
      /Only 2 left to receive/,
    );
    expect(await onHand(item.id)).toBe('3.000');
    expect(
      (await q(owner(), MOVES, { i: { itemId: item.id } })).body.data.stockMovements.total,
    ).toBe(1);
    expect(
      (await q(buyer.agent, GET_ORDER, { id: o.id })).body.data.purchaseOrder.receipts,
    ).toHaveLength(1);
  });

  it('is all-or-nothing across lines', async () => {
    const a = await newItem();
    const b = await newItem();
    const o = await approvedOrder([line(a.id, { quantity: '5' }), line(b.id, { quantity: '5' })]);
    const la = o.lines.find((x) => x.item.id === a.id)!.id;
    const lb = o.lines.find((x) => x.item.id === b.id)!.id;
    const res = await receive(buyer.agent, o.id, [
      { orderLineId: la, quantity: '5' },
      { orderLineId: lb, quantity: '6' },
    ]);
    expect(code(res)).toBe('BUSINESS_RULE');
    expect(await onHand(a.id)).toBe('0.000');
    expect((await q(buyer.agent, GET_ORDER, { id: o.id })).body.data.purchaseOrder.status).toBe(
      'approved',
    );
  });

  it('refuses draft orders, bad lines, bad quantities and unusable warehouses', async () => {
    const item = await newItem();
    const draft = await newOrder([line(item.id)]);
    expect(
      code(
        await receive(buyer.agent, draft.id, [{ orderLineId: draft.lines[0]!.id, quantity: '1' }]),
      ),
    ).toBe('BUSINESS_RULE');

    const o = await approvedOrder([line(item.id)]);
    const l = o.lines[0]!.id;
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect(code(await receive(buyer.agent, o.id, [{ orderLineId: ghost, quantity: '1' }]))).toBe(
      'VALIDATION_ERROR',
    );
    expect(
      code(await receive(buyer.agent, o.id, [{ orderLineId: draft.lines[0]!.id, quantity: '1' }])),
    ).toBe('VALIDATION_ERROR');
    expect(
      code(
        await receive(buyer.agent, o.id, [
          { orderLineId: l, quantity: '1' },
          { orderLineId: l, quantity: '1' },
        ]),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(code(await receive(buyer.agent, o.id, []))).toBe('VALIDATION_ERROR');
    for (const quantity of ['0', '-1', '1e1', '1.2345', 'x', '']) {
      expect(code(await receive(buyer.agent, o.id, [{ orderLineId: l, quantity }])), quantity).toBe(
        'VALIDATION_ERROR',
      );
    }
    expect(
      code(
        await q(buyer.agent, RECEIVE, {
          i: { orderId: o.id, warehouseId: ghost, lines: [{ orderLineId: l, quantity: '1' }] },
        }),
      ),
    ).toBe('NOT_FOUND');
    // Another branch's warehouse looks like it does not exist.
    expect(
      code(
        await q(buyer.agent, RECEIVE, {
          i: { orderId: o.id, warehouseId: wh2, lines: [{ orderLineId: l, quantity: '1' }] },
        }),
      ),
    ).toBe('NOT_FOUND');
    const wh = (
      await q(owner(), CREATE_WH, { i: { code: 'OLD-W', name: 'Old store', branchId: company.ho } })
    ).body.data.createWarehouse;
    await q(owner(), UPDATE_WH, {
      id: wh.id,
      i: { name: 'Old store', status: 'inactive', version: 1 },
    });
    expect(
      code(
        await q(buyer.agent, RECEIVE, {
          i: { orderId: o.id, warehouseId: wh.id, lines: [{ orderLineId: l, quantity: '1' }] },
        }),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(await onHand(item.id)).toBe('0.000');
  });

  it('stops a warehouse being filled past its maximum', async () => {
    const item = await newItem();
    await q(owner(), `mutation($i: ReceiveStockInput!){ receiveStock(input:$i){ balance } }`, {
      i: { itemId: item.id, warehouseId: main, quantity: '99999999999.999' },
    });
    const o = await approvedOrder([line(item.id, { quantity: '1' })]);
    const res = await receive(buyer.agent, o.id, [{ orderLineId: o.lines[0]!.id, quantity: '1' }]);
    expect(code(res)).toBe('BUSINESS_RULE');
    expect(res.body.errors[0].message).toMatch(/Too much stock/);
    expect((await q(buyer.agent, GET_ORDER, { id: o.id })).body.data.purchaseOrder.status).toBe(
      'approved',
    );
  });
});

describe('purchase: branch scope and isolation', () => {
  it('keeps branch-scoped buyers inside their own branch', async () => {
    const item = await newItem();
    const ho = await newOrder([line(item.id)]);
    const br2 = await newOrder([line(item.id)], buyer2.agent, { branchId: company.br2 });

    const mine = (await q(buyer.agent, LIST_ORDERS, { i: { limit: 100 } })).body.data.purchaseOrders
      .items;
    expect(mine.every((x: { branch: { id: string } }) => x.branch.id === company.ho)).toBe(true);
    expect(mine.map((x: { id: string }) => x.id)).not.toContain(br2.id);
    expect(code(await q(buyer.agent, GET_ORDER, { id: br2.id }))).toBe('NOT_FOUND');
    expect(code(await q(buyer2.agent, GET_ORDER, { id: ho.id }))).toBe('NOT_FOUND');
    expect(code(await q(buyer.agent, CANCEL, { id: br2.id, i: { version: br2.version } }))).toBe(
      'NOT_FOUND',
    );
    expect(
      code(
        await q(buyer.agent, UPDATE_ORDER, {
          id: br2.id,
          i: { supplierId, orderDate: today, lines: [line(item.id)], version: 1 },
        }),
      ),
    ).toBe('NOT_FOUND');
    // Creating an order for another branch is forbidden, and so is receiving it.
    expect(
      code(
        await q(buyer.agent, CREATE_ORDER, {
          i: { supplierId, branchId: company.br2, orderDate: today, lines: [line(item.id)] },
        }),
      ),
    ).toBe('FORBIDDEN');
    // An organisation-wide approver sees both.
    expect((await q(approver.agent, GET_ORDER, { id: br2.id })).body.errors).toBeUndefined();
  });

  it('never shows or touches another organisation’s purchasing', async () => {
    const theirItem = (
      await q(other.owner, CREATE_ITEM, {
        i: { sku: 'ISOLATED', unit: 'pcs', name: 'Isolated item' },
      })
    ).body.data.createItem.id;
    const theirSupplier = (
      await q(other.owner, CREATE_SUPPLIER, { i: { code: 'ISO-S', name: 'Isolated supplier' } })
    ).body.data.createSupplier.id;
    const theirOrder = (
      await q(other.owner, CREATE_ORDER, {
        i: {
          supplierId: theirSupplier,
          branchId: other.ho,
          orderDate: today,
          lines: [line(theirItem)],
        },
      })
    ).body.data.createPurchaseOrder;
    const visibleIds = (
      await q(owner(), LIST_ORDERS, { i: { search: theirOrder.number, limit: 100 } })
    ).body.data.purchaseOrders.items.map((x: { id: string }) => x.id);
    expect(visibleIds).not.toContain(theirOrder.id);
    expect(code(await q(owner(), GET_ORDER, { id: theirOrder.id }))).toBe('NOT_FOUND');
    expect(code(await q(approver.agent, APPROVE, { id: theirOrder.id, i: { version: 1 } }))).toBe(
      'NOT_FOUND',
    );
    expect(code(await q(owner(), CANCEL, { id: theirOrder.id, i: { version: 1 } }))).toBe(
      'NOT_FOUND',
    );
    expect(
      code(
        await receive(owner(), theirOrder.id, [
          { orderLineId: theirOrder.lines[0].id, quantity: '1' },
        ]),
      ),
    ).toBe('NOT_FOUND');
    expect(
      (await q(owner(), LIST_SUPPLIERS, { i: { search: 'Isolated' } })).body.data.suppliers.total,
    ).toBe(0);
    expect(
      code(
        await q(owner(), UPDATE_SUPPLIER, {
          id: theirSupplier,
          i: { name: 'Hijack', status: 'active', version: 1 },
        }),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('purchase: concurrency', () => {
  it('lets only one of several simultaneous approvals through', async () => {
    const item = await newItem();
    const o = await newOrder([line(item.id)]);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        q(approver.agent, APPROVE, { id: o.id, i: { version: o.version } }),
      ),
    );
    expect(results.filter((r) => !r.body.errors)).toHaveLength(1);
    expect(
      results
        .filter((r) => r.body.errors)
        .every((r) => ['CONFLICT', 'BUSINESS_RULE'].includes(code(r))),
    ).toBe(true);
  });

  it('never lets simultaneous receipts exceed the ordered quantity', async () => {
    const item = await newItem();
    const o = await approvedOrder([line(item.id, { quantity: '5' })]);
    const l = o.lines[0]!.id;
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        receive(buyer.agent, o.id, [{ orderLineId: l, quantity: '1' }]),
      ),
    );
    expect(results.filter((r) => !r.body.errors)).toHaveLength(5);
    expect(await onHand(item.id)).toBe('5.000');
    const detail = (await q(buyer.agent, GET_ORDER, { id: o.id })).body.data.purchaseOrder;
    expect(detail.status).toBe('received');
    expect(detail.receipts).toHaveLength(5);
    expect(detail.lines[0].receivedQuantity).toBe('5.000');
  });

  it('keeps a cancel and a receipt from both succeeding', async () => {
    const item = await newItem();
    const o = await approvedOrder([line(item.id, { quantity: '5' })]);
    const [cancel, rec] = await Promise.all([
      q(buyer.agent, CANCEL, { id: o.id, i: { version: o.version } }),
      receive(buyer.agent, o.id, [{ orderLineId: o.lines[0]!.id, quantity: '2' }]),
    ]);
    const stock = await onHand(item.id);
    if (!cancel.body.errors) {
      expect(rec.body.errors).toBeDefined();
      expect(stock).toBe('0.000');
    } else {
      expect(rec.body.errors).toBeUndefined();
      expect(stock).toBe('2.000');
    }
  });
});

describe('purchase: database guarantees', () => {
  it('cannot edit or delete receipts, or receive past the ordered quantity, even with direct SQL', async () => {
    const item = await newItem();
    const o = await approvedOrder([line(item.id, { quantity: '5' })]);
    await receive(buyer.agent, o.id, [{ orderLineId: o.lines[0]!.id, quantity: '2' }]);
    const [row] = await database.db.execute<{ tenant_id: string }>(
      sql`select tenant_id from purchase_orders where id = ${o.id}`,
    );
    const tid = row!.tenant_id;
    const attempt = (statement: ReturnType<typeof sql>) =>
      withTenant(database.db, tid, (tx) => tx.execute(statement));
    await expect(
      attempt(sql`update goods_receipts set notes = 'x' where order_id = ${o.id}`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`delete from goods_receipts where order_id = ${o.id}`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`update goods_receipt_lines set quantity = 99 where item_id = ${item.id}`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`delete from goods_receipt_lines where item_id = ${item.id}`),
    ).rejects.toThrow();
    await expect(
      attempt(sql`update purchase_order_lines set received_quantity = 6 where order_id = ${o.id}`),
    ).rejects.toThrow();
    // The approver can never be the author, even if the application were bypassed.
    await expect(
      attempt(sql`update purchase_orders set approved_by = created_by where id = ${o.id}`),
    ).rejects.toThrow();
    expect(await onHand(item.id)).toBe('2.000');
  });

  it('limits how fast one user can receive goods', async () => {
    const strict = testApp({ limits: { stockWritesPerUser: { limit: 2, windowMs: 60_000 } } });
    const c = await buildCompany(strict, await registerOrg(strict));
    const item = (
      await q(c.owner, CREATE_ITEM, { i: { sku: 'RATE-P', unit: 'pcs', name: 'Rate item' } })
    ).body.data.createItem.id;
    const sup = (
      await q(c.owner, CREATE_SUPPLIER, { i: { code: 'RATE-S', name: 'Rate supplier' } })
    ).body.data.createSupplier.id;
    const roleId = (
      await q(c.owner, CREATE_ROLE, {
        i: {
          name: 'Approver',
          dataScope: 'organisation',
          permissions: ['purchase.order.view', 'purchase.order.approve'],
        },
      })
    ).body.data.createRole.id;
    c.roleId.approver = roleId;
    const boss = await c.person({ role: 'approver', branch: c.ho, name: 'Boss Person' });
    const order = (
      await q(c.owner, CREATE_ORDER, {
        i: {
          supplierId: sup,
          branchId: c.ho,
          orderDate: today,
          lines: [line(item, { quantity: '10' })],
        },
      })
    ).body.data.createPurchaseOrder;
    await q(boss.agent, APPROVE, { id: order.id, i: { version: 1 } });
    const wh = (await q(c.owner, WAREHOUSES)).body.data.warehouses[0].id;
    const codes = [];
    for (let i = 0; i < 4; i++) {
      const res = await q(c.owner, RECEIVE, {
        i: {
          orderId: order.id,
          warehouseId: wh,
          lines: [{ orderLineId: order.lines[0].id, quantity: '1' }],
        },
      });
      codes.push(code(res) ?? 'ok');
    }
    expect(codes).toEqual(['ok', 'ok', 'RATE_LIMITED', 'RATE_LIMITED']);
  });
});
