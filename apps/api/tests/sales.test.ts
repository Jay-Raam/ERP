import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, registerOrg, testApp } from './helpers';
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

const CUSTOMER = `id code name contactName email phone gstin address status version`;
const LINE = `id quantity deliveredQuantity unitPrice gstRate subtotal taxAmount total item { id sku name unit }`;
const ORDER = `id number status orderDate expectedDate notes subtotal taxTotal grandTotal version createdByName confirmedByName customer { id code name } branch { id code }`;
const DETAIL = `${ORDER} lines { ${LINE} } deliveries { id number reference notes deliveredByName warehouse { code } lines { quantity item { sku } } }`;

const CREATE_CUSTOMER = `mutation($i: CreateCustomerInput!){ createCustomer(input:$i){ ${CUSTOMER} } }`;
const UPDATE_CUSTOMER = `mutation($id: ID!, $i: UpdateCustomerInput!){ updateCustomer(id:$id,input:$i){ ${CUSTOMER} } }`;
const LIST_CUSTOMERS = `query($i: ListCustomersInput){ customers(input:$i){ total items { ${CUSTOMER} } } }`;
const CREATE_ORDER = `mutation($i: CreateSalesOrderInput!){ createSalesOrder(input:$i){ ${DETAIL} } }`;
const UPDATE_ORDER = `mutation($id: ID!, $i: UpdateSalesOrderInput!){ updateSalesOrder(id:$id,input:$i){ ${DETAIL} } }`;
const CONFIRM = `mutation($id: ID!, $i: SalesDecisionInput!){ confirmSalesOrder(id:$id,input:$i){ ${DETAIL} } }`;
const CANCEL = `mutation($id: ID!, $i: SalesDecisionInput!){ cancelSalesOrder(id:$id,input:$i){ ${DETAIL} } }`;
const DELIVER = `mutation($i: DeliverGoodsInput!){ deliverGoods(input:$i){ ${DETAIL} } }`;
const GET_ORDER = `query($id: ID!){ salesOrder(id:$id){ ${DETAIL} } }`;
const LIST_ORDERS = `query($i: ListSalesOrdersInput){ salesOrders(input:$i){ total items { ${ORDER} } } }`;

const CREATE_ITEM = `mutation($i: CreateItemInput!){ createItem(input:$i){ id sku version } }`;
const RECEIVE_STOCK = `mutation($i: ReceiveStockInput!){ receiveStock(input:$i){ balance } }`;
const WAREHOUSES = `{ warehouses { id code } }`;
const CREATE_WH = `mutation($i: CreateWarehouseInput!){ createWarehouse(input:$i){ id code version } }`;
const LEVELS = `query($i: StockLevelsInput){ stockLevels(input:$i){ items { id onHand } } }`;
const MOVES = `query($i: MovementsInput){ stockMovements(input:$i){ items { kind quantity reference balanceAfter } } }`;

const SELLER = [
  'sale.customer.view',
  'sale.customer.create',
  'sale.customer.update',
  'sale.order.view',
  'sale.order.create',
  'sale.order.cancel',
  'sale.delivery.view',
  'sale.delivery.create',
];
const CONFIRMER = [
  'sale.customer.view',
  'sale.order.view',
  'sale.order.approve',
  'sale.delivery.view',
];
const VIEW_ONLY = ['sale.customer.view', 'sale.order.view'];

let company: Awaited<ReturnType<typeof buildCompany>>;
let seller: Person;
let seller2: Person;
let confirmer: Person;
let viewer: Person;
let plain: Person;
let customerId: string;
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

async function newItem(stock?: string, warehouse?: string) {
  const res = await q(owner(), CREATE_ITEM, {
    i: { sku: `SO${String(++n).padStart(3, '0')}`, unit: 'pcs', name: `Sales item ${n}` },
  });
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  const item = res.body.data.createItem as { id: string; sku: string };
  if (stock) {
    const r = await q(owner(), RECEIVE_STOCK, {
      i: { itemId: item.id, warehouseId: warehouse ?? main, quantity: stock },
    });
    expect(r.body.errors, JSON.stringify(r.body.errors)).toBeUndefined();
  }
  return item;
}

async function newOrder(lines: Record<string, unknown>[], as: Agent = seller.agent) {
  const res = await q(as, CREATE_ORDER, {
    i: { customerId, branchId: company.ho, orderDate: today, lines },
  });
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  return res.body.data.createSalesOrder as {
    id: string;
    number: string;
    version: number;
    status: string;
    lines: { id: string; item: { id: string } }[];
  };
}

async function confirmedOrder(lines: Record<string, unknown>[]) {
  const o = await newOrder(lines);
  const res = await q(confirmer.agent, CONFIRM, { id: o.id, i: { version: o.version } });
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  return res.body.data.confirmSalesOrder as typeof o;
}

const deliver = (
  as: Agent,
  orderId: string,
  lines: { orderLineId: string; quantity: string }[],
  extra: Record<string, unknown> = {},
) => q(as, DELIVER, { i: { orderId, warehouseId: main, lines, ...extra } });

const onHand = async (itemId: string) => {
  const res = await q(owner(), LEVELS, { i: { limit: 100 } });
  return res.body.data.stockLevels.items.find((x: { id: string }) => x.id === itemId)
    ?.onHand as string;
};

beforeAll(async () => {
  const org: Org = await registerOrg(app);
  company = await buildCompany(app, org);
  const mkRole = async (name: string, dataScope: string, permissions: string[]) => {
    const res = await q(owner(), CREATE_ROLE, { i: { name, dataScope, permissions } });
    expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
    return res.body.data.createRole.id as string;
  };
  company.roleId.seller = await mkRole('Seller', 'branch', SELLER);
  company.roleId.confirmer = await mkRole('Confirmer', 'organisation', CONFIRMER);
  company.roleId.viewer = await mkRole('Sales viewer', 'organisation', VIEW_ONLY);
  seller = await company.person({ role: 'seller', branch: company.ho, name: 'Sela Seller' });
  seller2 = await company.person({ role: 'seller', branch: company.br2, name: 'Sita Seller' });
  confirmer = await company.person({ role: 'confirmer', branch: company.ho, name: 'Con Firmer' });
  viewer = await company.person({ role: 'viewer', branch: company.ho, name: 'Vimal Viewer' });
  plain = await company.person({ role: 'employee', branch: company.ho, name: 'Plain Person' });
  const cust = await q(owner(), CREATE_CUSTOMER, {
    i: { code: 'CUS-1', name: 'Anand Stores', gstin: '33ABCDE1234F1Z5' },
  });
  expect(cust.body.errors, JSON.stringify(cust.body.errors)).toBeUndefined();
  customerId = cust.body.data.createCustomer.id;
  main = (await q(owner(), WAREHOUSES)).body.data.warehouses[0].id;
  const made = await q(owner(), CREATE_WH, {
    i: { code: 'BR2-STORE', name: 'Branch 2 store', branchId: company.br2 },
  });
  wh2 = made.body.data.createWarehouse.id;
  other = await buildCompany(app, await registerOrg(app));
});

describe('sales: permissions', () => {
  it('keeps a plain employee out and a viewer read-only', async () => {
    for (const query of [LIST_CUSTOMERS, LIST_ORDERS]) {
      expect(code(await q(plain.agent, query))).toBe('FORBIDDEN');
    }
    const item = await newItem('50');
    const o = await newOrder([line(item.id)]);
    expect((await q(viewer.agent, GET_ORDER, { id: o.id })).body.errors).toBeUndefined();
    expect(
      (await q(viewer.agent, GET_ORDER, { id: o.id })).body.data.salesOrder.deliveries,
    ).toEqual([]);
    const attempts = [
      q(viewer.agent, CREATE_CUSTOMER, { i: { code: 'NOPE', name: 'Nope customer' } }),
      q(viewer.agent, CONFIRM, { id: o.id, i: { version: o.version } }),
      q(viewer.agent, CANCEL, { id: o.id, i: { version: o.version } }),
      deliver(viewer.agent, o.id, [{ orderLineId: o.lines[0]!.id, quantity: '1' }]),
    ];
    for (const res of await Promise.all(attempts)) expect(code(res)).toBe('FORBIDDEN');
  });

  it('separates selling from confirming', async () => {
    const item = await newItem('5');
    const o = await newOrder([line(item.id)]);
    expect(code(await q(seller.agent, CONFIRM, { id: o.id, i: { version: o.version } }))).toBe(
      'FORBIDDEN',
    );
    expect(
      code(
        await q(confirmer.agent, CREATE_ORDER, {
          i: { customerId, branchId: company.ho, orderDate: today, lines: [line(item.id)] },
        }),
      ),
    ).toBe('FORBIDDEN');
  });
});

describe('sales: customers', () => {
  it('creates, normalises, refuses duplicates and bad input', async () => {
    const made = await q(seller.agent, CREATE_CUSTOMER, {
      i: { code: ' kv-2 ', name: '  KV   Mart ', gstin: '33aabcu9603r1zx', email: 'A@KV.example' },
    });
    expect(made.body.data.createCustomer).toMatchObject({
      code: 'KV-2',
      name: 'KV Mart',
      gstin: '33AABCU9603R1ZX',
      email: 'a@kv.example',
    });
    expect(code(await q(seller.agent, CREATE_CUSTOMER, { i: { code: 'KV-2', name: 'Dup' } }))).toBe(
      'CONFLICT',
    );
    for (const bad of [
      { code: 'x', name: 'Bad one' },
      { code: 'OK-2', name: '<b>x</b>' },
      { code: 'OK-3', name: 'Fine', gstin: '33ABCDE1234F1Z' },
    ]) {
      expect(code(await q(seller.agent, CREATE_CUSTOMER, { i: bad }))).toBe('VALIDATION_ERROR');
    }
  });

  it('edits with optimistic locking and fixed code; search treats % as text', async () => {
    const c = (await q(seller.agent, CREATE_CUSTOMER, { i: { code: 'ED-1', name: 'Edit me' } }))
      .body.data.createCustomer;
    const ok = await q(seller.agent, UPDATE_CUSTOMER, {
      id: c.id,
      i: { name: 'Edited', status: 'inactive', version: 1 },
    });
    expect(ok.body.data.updateCustomer).toMatchObject({ name: 'Edited', version: 2 });
    expect(
      code(
        await q(seller.agent, UPDATE_CUSTOMER, {
          id: c.id,
          i: { name: 'x2', status: 'active', version: 1 },
        }),
      ),
    ).toBe('CONFLICT');
    expect(
      code(
        await q(seller.agent, UPDATE_CUSTOMER, {
          id: c.id,
          i: { name: 'x2', status: 'active', version: 2, code: 'NEW' },
        }),
      ),
    ).toBe('BAD_REQUEST');
    expect(
      (await q(seller.agent, LIST_CUSTOMERS, { i: { search: '%' } })).body.data.customers.total,
    ).toBe(0);
  });
});

describe('sales: orders, confirming and totals', () => {
  it('works out every amount on the server, ignoring anything the client claims', async () => {
    const a = await newItem();
    const b = await newItem();
    const res = await q(seller.agent, CREATE_ORDER, {
      i: {
        customerId,
        branchId: company.ho,
        orderDate: today,
        lines: [
          { itemId: a.id, quantity: '3', unitPrice: '99.50', gstRate: 18 },
          { itemId: b.id, quantity: '10', unitPrice: '50', gstRate: 18 },
        ],
      },
    });
    const o = res.body.data.createSalesOrder;
    expect(o).toMatchObject({
      status: 'draft',
      subtotal: '798.50',
      taxTotal: '143.73',
      grandTotal: '942.23',
    });
    expect(o.number).toMatch(/^SO-\d{6}$/);
    const forged = await q(seller.agent, CREATE_ORDER, {
      i: {
        customerId,
        branchId: company.ho,
        orderDate: today,
        lines: [line(a.id)],
        grandTotal: '1.00',
      },
    });
    expect(code(forged)).toBe('BAD_REQUEST');
  });

  it('edits only drafts, with a version check, and replaces the lines', async () => {
    const a = await newItem();
    const b = await newItem();
    const o = await newOrder([line(a.id)]);
    const edited = await q(seller.agent, UPDATE_ORDER, {
      id: o.id,
      i: {
        customerId,
        orderDate: today,
        lines: [line(b.id, { quantity: '2' })],
        version: o.version,
      },
    });
    expect(edited.body.data.updateSalesOrder).toMatchObject({ version: 2, grandTotal: '236.00' });
    expect(
      code(
        await q(seller.agent, UPDATE_ORDER, {
          id: o.id,
          i: { customerId, orderDate: today, lines: [line(b.id)], version: 1 },
        }),
      ),
    ).toBe('CONFLICT');
  });

  it('confirms only by someone else, once, and only drafts', async () => {
    const item = await newItem();
    const o = await newOrder([line(item.id)]);
    const ok = await q(confirmer.agent, CONFIRM, { id: o.id, i: { version: o.version } });
    expect(ok.body.data.confirmSalesOrder).toMatchObject({
      status: 'confirmed',
      confirmedByName: 'Con Firmer',
    });
    expect(
      code(await q(confirmer.agent, CONFIRM, { id: o.id, i: { version: o.version + 1 } })),
    ).toBe('BUSINESS_RULE');
    // The author cannot confirm their own order even when holding the permission.
    const mine = await q(owner(), CREATE_ORDER, {
      i: { customerId, branchId: company.ho, orderDate: today, lines: [line(item.id)] },
    });
    const own = mine.body.data.createSalesOrder;
    const self = await q(owner(), CONFIRM, { id: own.id, i: { version: own.version } });
    expect(code(self)).toBe('BUSINESS_RULE');
  });

  it('cancels drafts and confirmed orders, but not a delivered one', async () => {
    const item = await newItem('20');
    const d = await newOrder([line(item.id)]);
    expect(
      (await q(seller.agent, CANCEL, { id: d.id, i: { version: d.version } })).body.data
        .cancelSalesOrder.status,
    ).toBe('cancelled');
    const c = await confirmedOrder([line(item.id, { quantity: '4' })]);
    expect(
      (await deliver(seller.agent, c.id, [{ orderLineId: c.lines[0]!.id, quantity: '1' }])).body
        .errors,
    ).toBeUndefined();
    const got = (await q(seller.agent, GET_ORDER, { id: c.id })).body.data.salesOrder;
    expect(code(await q(seller.agent, CANCEL, { id: c.id, i: { version: got.version } }))).toBe(
      'BUSINESS_RULE',
    );
  });
});

describe('sales: deliveries issue stock', () => {
  it('delivers in parts, reduces stock, writes the ledger and finishes the order', async () => {
    const item = await newItem('100');
    const o = await confirmedOrder([line(item.id, { quantity: '10' })]);
    const lineId = o.lines[0]!.id;
    const first = await deliver(seller.agent, o.id, [{ orderLineId: lineId, quantity: '4' }], {
      reference: 'PO-77',
    });
    expect(first.body.errors, JSON.stringify(first.body.errors)).toBeUndefined();
    const part = first.body.data.deliverGoods;
    expect(part.status).toBe('partly_delivered');
    expect(part.lines[0].deliveredQuantity).toBe('4.000');
    expect(part.deliveries[0].number).toMatch(/^DN-\d{6}$/);
    expect(await onHand(item.id)).toBe('96.000');
    const rest = await deliver(seller.agent, o.id, [{ orderLineId: lineId, quantity: '6' }]);
    expect(rest.body.data.deliverGoods.status).toBe('delivered');
    expect(await onHand(item.id)).toBe('90.000');
    const moves = await q(owner(), MOVES, { i: { itemId: item.id } });
    expect(moves.body.data.stockMovements.items.map((m: { kind: string }) => m.kind)).toEqual([
      'issue',
      'issue',
      'receipt',
    ]);
    expect(code(await deliver(seller.agent, o.id, [{ orderLineId: lineId, quantity: '1' }]))).toBe(
      'BUSINESS_RULE',
    );
  });

  it('refuses more than ordered, more than in stock, and a draft order', async () => {
    const item = await newItem('3');
    const draft = await newOrder([line(item.id, { quantity: '2' })]);
    expect(
      code(
        await deliver(seller.agent, draft.id, [{ orderLineId: draft.lines[0]!.id, quantity: '1' }]),
      ),
    ).toBe('BUSINESS_RULE');
    const o = await confirmedOrder([line(item.id, { quantity: '5' })]);
    const lineId = o.lines[0]!.id;
    const tooMany = await deliver(seller.agent, o.id, [{ orderLineId: lineId, quantity: '6' }]);
    expect(code(tooMany)).toBe('BUSINESS_RULE');
    const short = await deliver(seller.agent, o.id, [{ orderLineId: lineId, quantity: '4' }]);
    expect(code(short)).toBe('BUSINESS_RULE');
    expect(short.body.errors[0].message).toMatch(/only 3\.?0* on hand/);
    expect(await onHand(item.id)).toBe('3.000');
  });

  it('is all or nothing across lines', async () => {
    const a = await newItem('10');
    const b = await newItem('1');
    const o = await confirmedOrder([line(a.id), line(b.id, { quantity: '5' })]);
    const [la, lb] = [
      o.lines.find((l) => l.item.id === a.id)!,
      o.lines.find((l) => l.item.id === b.id)!,
    ];
    const res = await deliver(seller.agent, o.id, [
      { orderLineId: la.id, quantity: '2' },
      { orderLineId: lb.id, quantity: '5' },
    ]);
    expect(code(res)).toBe('BUSINESS_RULE');
    expect(await onHand(a.id)).toBe('10.000');
    const got = (await q(seller.agent, GET_ORDER, { id: o.id })).body.data.salesOrder;
    expect(got.status).toBe('confirmed');
    expect(got.deliveries).toEqual([]);
  });

  it('never oversells under parallel deliveries', async () => {
    const item = await newItem('10');
    const orders = await Promise.all(
      [0, 1, 2, 3].map(() => confirmedOrder([line(item.id, { quantity: '4' })])),
    );
    const results = await Promise.all(
      orders.map((o) =>
        deliver(seller.agent, o.id, [{ orderLineId: o.lines[0]!.id, quantity: '4' }]),
      ),
    );
    const done = results.filter((r) => !r.body.errors).length;
    expect(done).toBe(2);
    expect(await onHand(item.id)).toBe('2.000');
  });

  it('respects branch scope for warehouse and order', async () => {
    const item = await newItem('10');
    await q(owner(), RECEIVE_STOCK, { i: { itemId: item.id, warehouseId: wh2, quantity: '10' } });
    const o = await confirmedOrder([line(item.id, { quantity: '2' })]);
    const wrong = await q(seller.agent, DELIVER, {
      i: {
        orderId: o.id,
        warehouseId: wh2,
        lines: [{ orderLineId: o.lines[0]!.id, quantity: '1' }],
      },
    });
    expect(code(wrong)).toBe('NOT_FOUND');
    expect(code(await q(seller2.agent, GET_ORDER, { id: o.id }))).toBe('NOT_FOUND');
    expect(
      (await q(seller2.agent, LIST_ORDERS, { i: { search: o.number } })).body.data.salesOrders
        .total,
    ).toBe(0);
  });

  it('isolates tenants', async () => {
    const item = await newItem();
    const o = await newOrder([line(item.id)]);
    expect(code(await q(other.owner, GET_ORDER, { id: o.id }))).toBe('NOT_FOUND');
    expect(
      code(
        await q(other.owner, CREATE_ORDER, {
          i: { customerId, branchId: other.ho, orderDate: today, lines: [line(item.id)] },
        }),
      ),
    ).toBe('VALIDATION_ERROR');
  });
});
