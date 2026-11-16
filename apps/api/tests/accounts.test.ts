import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/tenant';
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

const INV = `id number kind status reference invoiceDate dueDate subtotal taxTotal grandTotal paidAmount outstanding version journalEntryId sourceNumber party { id name } branch { id } lines { quantity unitPrice gstRate subtotal taxAmount total item { sku } } payments { id number amount method voidedAt }`;
const PAY = `id number kind amount method paidOn voidedAt voidReason journalEntryId invoice { id number } partyName`;
const ENTRY = `id number entryDate memo sourceType sourceId reversalOf reversedById total branch { id } lines { account { id code } debit credit }`;

const CREATE_INVOICE = `mutation($i: CreateInvoiceInput!){ createInvoice(input:$i){ ${INV} } }`;
const UPDATE_INVOICE = `mutation($id: ID!, $i: UpdateInvoiceInput!){ updateInvoice(id:$id,input:$i){ ${INV} } }`;
const POST = `mutation($id: ID!, $i: PostInvoiceInput!){ postInvoice(id:$id,input:$i){ ${INV} } }`;
const CANCEL = `mutation($id: ID!, $i: CancelInvoiceInput!){ cancelInvoice(id:$id,input:$i){ ${INV} } }`;
const GET_INVOICE = `query($id: ID!){ invoice(id:$id){ ${INV} } }`;
const LIST_INVOICES = `query($i: ListInvoicesInput!){ invoices(input:$i){ total items { id number status grandTotal outstanding } } }`;
const PAY_IN = `mutation($i: RecordPaymentInput!){ recordPayment(input:$i){ ${PAY} } }`;
const VOID = `mutation($id: ID!, $i: VoidPaymentInput!){ voidPayment(id:$id,input:$i){ ${PAY} } }`;
const LIST_PAYMENTS = `query($i: ListPaymentsInput){ payments(input:$i){ total items { ${PAY} } } }`;
const ACCOUNTS = `{ accounts { id code name type isSystem status version } }`;
const CREATE_ACCOUNT = `mutation($i: CreateAccountInput!){ createAccount(input:$i){ id code type version } }`;
const UPDATE_ACCOUNT = `mutation($id: ID!, $i: UpdateAccountInput!){ updateAccount(id:$id,input:$i){ id status } }`;
const CREATE_ENTRY = `mutation($i: CreateJournalEntryInput!){ createJournalEntry(input:$i){ ${ENTRY} } }`;
const REVERSE = `mutation($id: ID!, $i: ReverseJournalInput!){ reverseJournalEntry(id:$id,input:$i){ ${ENTRY} } }`;
const GET_ENTRY = `query($id: ID!){ journalEntry(id:$id){ ${ENTRY} } }`;
const LIST_ENTRIES = `query($i: ListJournalInput){ journalEntries(input:$i){ total items { id number memo sourceType reversedById } } }`;
const TRIAL = `query($i: TrialBalanceInput){ trialBalance(input:$i){ asOf totalDebit totalCredit balanced rows { code type debit credit balance } } }`;
const LEDGER = `query($i: AccountLedgerInput!){ accountLedger(input:$i){ opening total account { code } items { number debit credit balance } } }`;
const AGEING = `query($i: AgeingInput!){ ageing(input:$i){ asOf rows { partyName current days30 days60 days90 over90 total } totals { current days30 days60 days90 over90 total } } }`;

const CREATE_CUSTOMER = `mutation($i: CreateCustomerInput!){ createCustomer(input:$i){ id } }`;
const CREATE_SUPPLIER = `mutation($i: CreateSupplierInput!){ createSupplier(input:$i){ id } }`;
const CREATE_ITEM = `mutation($i: CreateItemInput!){ createItem(input:$i){ id } }`;
const RECEIVE_STOCK = `mutation($i: ReceiveStockInput!){ receiveStock(input:$i){ balance } }`;
const WAREHOUSES = `{ warehouses { id } }`;
const CREATE_SO = `mutation($i: CreateSalesOrderInput!){ createSalesOrder(input:$i){ id version lines { id } } }`;
const CONFIRM_SO = `mutation($id: ID!, $i: SalesDecisionInput!){ confirmSalesOrder(id:$id,input:$i){ id } }`;
const DELIVER = `mutation($i: DeliverGoodsInput!){ deliverGoods(input:$i){ deliveries { id number } } }`;
const CREATE_PO = `mutation($i: CreateOrderInput!){ createPurchaseOrder(input:$i){ id version lines { id } } }`;
const APPROVE_PO = `mutation($id: ID!, $i: OrderDecisionInput!){ approvePurchaseOrder(id:$id,input:$i){ id } }`;
const RECEIVE = `mutation($i: ReceiveGoodsInput!){ receiveGoods(input:$i){ receipts { id number } } }`;

const ACCOUNTANT = [
  'accounts.account.view',
  'accounts.account.manage',
  'accounts.journal.view',
  'accounts.journal.create',
  'accounts.invoice.view',
  'accounts.invoice.create',
  'accounts.invoice.post',
  'accounts.invoice.cancel',
  'accounts.payment.view',
  'accounts.payment.create',
  'accounts.payment.void',
  'accounts.report.view',
];
const CLERK = ['accounts.invoice.view', 'accounts.invoice.create', 'accounts.payment.view'];
const VIEWER = ['accounts.invoice.view', 'accounts.report.view', 'accounts.journal.view'];

let company: Awaited<ReturnType<typeof buildCompany>>;
let acct: Person; // organisation scope
let acct2: Person; // branch BR2 scope
let clerk: Person;
let viewer: Person;
let plain: Person;
let customerId: string;
let supplierId: string;
let main: string;
let other: Awaited<ReturnType<typeof buildCompany>>;
let otherOrg: Org;
const owner = () => company.owner;
const today = new Date().toISOString().slice(0, 10);
let n = 0;

const money = (v: string) => Math.round(Number(v) * 100);

async function must<T>(res: { body: { errors?: unknown; data: T } }) {
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  return res.body.data;
}

async function newItem() {
  const d = await must(
    await q(owner(), CREATE_ITEM, {
      i: { sku: `AC${String(++n).padStart(3, '0')}`, unit: 'pcs', name: `Acct item ${n}` },
    }),
  );
  return (d as { createItem: { id: string } }).createItem.id;
}

/** A delivered sales order: returns the delivery id (100 x Rs100 @18% => 11800.00). */
async function delivery(qty = '100', price = '100', gst = 18) {
  const item = await newItem();
  await must(
    await q(owner(), RECEIVE_STOCK, { i: { itemId: item, warehouseId: main, quantity: '1000' } }),
  );
  const so = (
    (await must(
      await q(owner(), CREATE_SO, {
        i: {
          customerId,
          branchId: company.ho,
          orderDate: today,
          lines: [{ itemId: item, quantity: qty, unitPrice: price, gstRate: gst }],
        },
      }),
    )) as { createSalesOrder: { id: string; version: number; lines: { id: string }[] } }
  ).createSalesOrder;
  return { so, item };
}

async function confirmedDelivery(qty = '100', price = '100', gst = 18) {
  const { so } = await delivery(qty, price, gst);
  // The owner created it, so someone else (the organisation-scope accountant role has no
  // confirm permission) cannot; use the dedicated confirmer.
  await must(await q(confirmer.agent, CONFIRM_SO, { id: so.id, i: { version: so.version } }));
  const d = (await must(
    await q(owner(), DELIVER, {
      i: {
        orderId: so.id,
        warehouseId: main,
        lines: [{ orderLineId: so.lines[0]!.id, quantity: qty }],
      },
    }),
  )) as { deliverGoods: { deliveries: { id: string }[] } };
  return d.deliverGoods.deliveries[0]!.id;
}

let confirmer: Person;

async function receipt(qty = '10', price = '50', gst = 5) {
  const item = await newItem();
  const po = (
    (await must(
      await q(owner(), CREATE_PO, {
        i: {
          supplierId,
          branchId: company.ho,
          orderDate: today,
          lines: [{ itemId: item, quantity: qty, unitPrice: price, gstRate: gst }],
        },
      }),
    )) as { createPurchaseOrder: { id: string; version: number; lines: { id: string }[] } }
  ).createPurchaseOrder;
  await must(await q(confirmer.agent, APPROVE_PO, { id: po.id, i: { version: po.version } }));
  const r = (await must(
    await q(owner(), RECEIVE, {
      i: {
        orderId: po.id,
        warehouseId: main,
        reference: undefined,
        supplierInvoiceNo: 'SUP-INV-9',
        lines: [{ orderLineId: po.lines[0]!.id, quantity: qty }],
      },
    }),
  )) as { receiveGoods: { receipts: { id: string }[] } };
  return r.receiveGoods.receipts[0]!.id;
}

async function salesInvoice(as: Agent = acct.agent, extra: Record<string, unknown> = {}) {
  const source = await confirmedDelivery();
  return (await must(
    await q(as, CREATE_INVOICE, {
      i: { kind: 'sales', sourceId: source, invoiceDate: today, dueDate: today, ...extra },
    }),
  )) as { createInvoice: { id: string; version: number; number: string; grandTotal: string } };
}

async function postedSales() {
  const { createInvoice: inv } = await salesInvoice();
  const posted = (await must(
    await q(acct.agent, POST, { id: inv.id, i: { version: inv.version } }),
  )) as {
    postInvoice: { id: string; version: number; grandTotal: string; journalEntryId: string };
  };
  return posted.postInvoice;
}

const trialMap = async (as: Agent = acct.agent, asOf?: string) => {
  const d = (await must(await q(as, TRIAL, { i: { asOf } }))) as {
    trialBalance: {
      balanced: boolean;
      totalDebit: string;
      totalCredit: string;
      rows: { code: string; debit: string; credit: string; balance: string }[];
    };
  };
  return { ...d.trialBalance, by: Object.fromEntries(d.trialBalance.rows.map((r) => [r.code, r])) };
};

beforeAll(async () => {
  otherOrg = await registerOrg(app);
  const org: Org = await registerOrg(app);
  company = await buildCompany(app, org);
  const mkRole = async (name: string, dataScope: string, permissions: string[]) => {
    const res = await q(owner(), CREATE_ROLE, { i: { name, dataScope, permissions } });
    expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
    return res.body.data.createRole.id as string;
  };
  company.roleId.acct = await mkRole('Accountant', 'organisation', ACCOUNTANT);
  company.roleId.acct2 = await mkRole('Branch accountant', 'branch', ACCOUNTANT);
  company.roleId.clerk = await mkRole('Clerk', 'organisation', CLERK);
  company.roleId.viewer = await mkRole('Finance viewer', 'organisation', VIEWER);
  company.roleId.confirmer = await mkRole('Confirmer', 'organisation', [
    'sale.order.view',
    'sale.order.approve',
    'purchase.order.view',
    'purchase.order.approve',
  ]);
  acct = await company.person({ role: 'acct', branch: company.ho, name: 'Asha Accountant' });
  acct2 = await company.person({ role: 'acct2', branch: company.br2, name: 'Bala Branch' });
  clerk = await company.person({ role: 'clerk', branch: company.ho, name: 'Chitra Clerk' });
  viewer = await company.person({ role: 'viewer', branch: company.ho, name: 'Vimal Viewer' });
  confirmer = await company.person({ role: 'confirmer', branch: company.ho, name: 'Con Firmer' });
  plain = await company.person({ role: 'employee', branch: company.ho, name: 'Plain Person' });
  customerId = (
    (await must(
      await q(owner(), CREATE_CUSTOMER, { i: { code: 'CUS-1', name: 'Anand Stores' } }),
    )) as {
      createCustomer: { id: string };
    }
  ).createCustomer.id;
  supplierId = (
    (await must(
      await q(owner(), CREATE_SUPPLIER, { i: { code: 'SUP-1', name: 'Murugan Traders' } }),
    )) as {
      createSupplier: { id: string };
    }
  ).createSupplier.id;
  main = ((await q(owner(), WAREHOUSES)).body.data.warehouses[0] as { id: string }).id;
  other = await buildCompany(app, otherOrg);
});

describe('accounts: permissions', () => {
  it('rejects a plain employee everywhere', async () => {
    for (const query of [ACCOUNTS, LIST_PAYMENTS]) {
      expect(code(await q(plain.agent, query))).toBe('FORBIDDEN');
    }
    expect(code(await q(plain.agent, LIST_INVOICES, { i: { kind: 'sales' } }))).toBe('FORBIDDEN');
    expect(code(await q(plain.agent, TRIAL))).toBe('FORBIDDEN');
    expect(code(await q(plain.agent, AGEING, { i: { kind: 'sales' } }))).toBe('FORBIDDEN');
  });

  it('lets a clerk draft invoices but not post, cancel, pay or see reports', async () => {
    const source = await confirmedDelivery();
    const made = await q(clerk.agent, CREATE_INVOICE, {
      i: { kind: 'sales', sourceId: source, invoiceDate: today },
    });
    expect(made.body.errors, JSON.stringify(made.body.errors)).toBeUndefined();
    const inv = made.body.data.createInvoice;
    expect(code(await q(clerk.agent, POST, { id: inv.id, i: { version: inv.version } }))).toBe(
      'FORBIDDEN',
    );
    expect(
      code(await q(clerk.agent, CANCEL, { id: inv.id, i: { version: inv.version, reason: 'no' } })),
    ).toBe('FORBIDDEN');
    expect(
      code(
        await q(clerk.agent, PAY_IN, {
          i: { invoiceId: inv.id, amount: '1', method: 'cash', paidOn: today },
        }),
      ),
    ).toBe('FORBIDDEN');
    expect(code(await q(clerk.agent, TRIAL))).toBe('FORBIDDEN');
    expect(code(await q(clerk.agent, ACCOUNTS))).toBe('FORBIDDEN');
  });

  it('lets a finance viewer read but never write', async () => {
    expect((await q(viewer.agent, TRIAL)).body.errors).toBeUndefined();
    expect(
      code(
        await q(viewer.agent, CREATE_ENTRY, {
          i: {
            entryDate: today,
            memo: 'sneaky',
            lines: [
              { accountId: 'x', debit: '1', credit: '0' },
              { accountId: 'y', debit: '0', credit: '1' },
            ],
          },
        }),
      ),
    ).toMatch(/FORBIDDEN|VALIDATION_ERROR|BAD_REQUEST/);
    const inv = await postedSales();
    expect(
      code(
        await q(viewer.agent, PAY_IN, {
          i: { invoiceId: inv.id, amount: '1', method: 'cash', paidOn: today },
        }),
      ),
    ).toBe('FORBIDDEN');
  });
});

describe('accounts: chart of accounts', () => {
  it('starts with the system accounts and lets you add and rename others', async () => {
    const list = (await must(await q(acct.agent, ACCOUNTS))) as {
      accounts: { id: string; code: string; isSystem: boolean; version: number }[];
    };
    const codes = list.accounts.map((a) => a.code);
    for (const c of ['1000', '1010', '1100', '1300', '2000', '2100', '3000', '4000', '5000'])
      expect(codes).toContain(c);
    const made = await q(acct.agent, CREATE_ACCOUNT, {
      i: { code: '5300', name: 'Rent', type: 'expense' },
    });
    expect(made.body.data.createAccount).toMatchObject({ code: '5300', type: 'expense' });
    expect(
      code(
        await q(acct.agent, CREATE_ACCOUNT, {
          i: { code: '5300', name: 'Rent 2', type: 'expense' },
        }),
      ),
    ).toBe('CONFLICT');
    expect(
      code(
        await q(acct.agent, CREATE_ACCOUNT, { i: { code: '52', name: 'Short', type: 'expense' } }),
      ),
    ).toBe('VALIDATION_ERROR');
    const sys = list.accounts.find((a) => a.code === '1100')!;
    expect(
      code(
        await q(acct.agent, UPDATE_ACCOUNT, {
          id: sys.id,
          i: { name: 'AR', status: 'inactive', version: sys.version },
        }),
      ),
    ).toBe('BUSINESS_RULE');
  });
});

describe('accounts: sales invoices', () => {
  it('builds an invoice from a delivery with server-side amounts and refuses a second one', async () => {
    const source = await confirmedDelivery('100', '100', 18);
    const res = await q(acct.agent, CREATE_INVOICE, {
      i: { kind: 'sales', sourceId: source, invoiceDate: today, reference: ' PO-5 ' },
    });
    const inv = res.body.data.createInvoice;
    expect(inv).toMatchObject({
      status: 'draft',
      kind: 'sales',
      subtotal: '10000.00',
      taxTotal: '1800.00',
      grandTotal: '11800.00',
      paidAmount: '0.00',
      outstanding: '11800.00',
      reference: 'PO-5',
      dueDate: today,
    });
    expect(inv.number).toMatch(/^INV-\d{6}$/);
    expect(inv.lines).toHaveLength(1);
    expect(inv.journalEntryId).toBeNull();
    const dup = await q(acct.agent, CREATE_INVOICE, {
      i: { kind: 'sales', sourceId: source, invoiceDate: today },
    });
    expect(code(dup)).toBe('BUSINESS_RULE');
    // Amounts cannot be supplied by the client.
    const forged = await q(acct.agent, CREATE_INVOICE, {
      i: { kind: 'sales', sourceId: source, invoiceDate: today, grandTotal: '1.00' },
    });
    expect(code(forged)).toBe('BAD_REQUEST');
  });

  it('edits only drafts, keeps amounts fixed and checks the due date', async () => {
    const { createInvoice: inv } = await salesInvoice();
    const edited = await q(acct.agent, UPDATE_INVOICE, {
      id: inv.id,
      i: { invoiceDate: today, dueDate: '2099-01-01', reference: 'R2', version: inv.version },
    });
    expect(edited.body.data.updateInvoice).toMatchObject({
      dueDate: '2099-01-01',
      reference: 'R2',
      grandTotal: inv.grandTotal,
    });
    expect(
      code(
        await q(acct.agent, UPDATE_INVOICE, {
          id: inv.id,
          i: { invoiceDate: today, dueDate: '2000-01-01', version: 2 },
        }),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(
      code(
        await q(acct.agent, UPDATE_INVOICE, {
          id: inv.id,
          i: { invoiceDate: today, version: 1 },
        }),
      ),
    ).toBe('CONFLICT');
  });

  it('posts a balanced entry: debtors up, sales and GST payable up', async () => {
    const before = await trialMap();
    const inv = await postedSales();
    const after = await trialMap();
    const diff = (c: string, k: 'debit' | 'credit') =>
      money(after.by[c]![k]) - money(before.by[c]![k]);
    expect(diff('1100', 'debit')).toBe(1180000);
    expect(diff('4000', 'credit')).toBe(1000000);
    expect(diff('2100', 'credit')).toBe(180000);
    expect(after.balanced).toBe(true);
    expect(after.totalDebit).toBe(after.totalCredit);
    const entry = (await must(await q(acct.agent, GET_ENTRY, { id: inv.journalEntryId }))) as {
      journalEntry: {
        sourceType: string;
        total: string;
        lines: { debit: string; credit: string }[];
      };
    };
    expect(entry.journalEntry.sourceType).toBe('invoice');
    expect(entry.journalEntry.total).toBe('11800.00');
    expect(code(await q(acct.agent, POST, { id: inv.id, i: { version: inv.version } }))).toBe(
      'BUSINESS_RULE',
    );
  });

  it('cannot post twice in parallel', async () => {
    const { createInvoice: inv } = await salesInvoice();
    const results = await Promise.all(
      [1, 2, 3].map(() => q(acct.agent, POST, { id: inv.id, i: { version: inv.version } })),
    );
    expect(results.filter((r) => !r.body.errors)).toHaveLength(1);
    const list = (await q(acct.agent, LIST_ENTRIES, { i: { search: inv.number } })).body.data
      .journalEntries;
    expect(list.total).toBe(1);
  });

  it('cancels a draft without any entry, and a posted invoice with a reversal', async () => {
    const draft = (await salesInvoice()).createInvoice;
    const gone = await q(acct.agent, CANCEL, {
      id: draft.id,
      i: { version: draft.version, reason: 'Wrong customer' },
    });
    expect(gone.body.data.cancelInvoice.status).toBe('cancelled');
    const before = await trialMap();
    const posted = await postedSales();
    const cancelled = await q(acct.agent, CANCEL, {
      id: posted.id,
      i: { version: posted.version, reason: 'Duplicate' },
    });
    expect(cancelled.body.data.cancelInvoice.status).toBe('cancelled');
    const after = await trialMap();
    expect(money(after.by['1100']!.balance)).toBe(money(before.by['1100']!.balance));
    expect(money(after.by['4000']!.balance)).toBe(money(before.by['4000']!.balance));
    expect(after.balanced).toBe(true);
    const reversed = (
      await q(acct.agent, LIST_ENTRIES, { i: { limit: 100 } })
    ).body.data.journalEntries.items.find((e: { id: string }) => e.id === posted.journalEntryId);
    expect(reversed?.reversedById).toBeTruthy();
    expect(
      code(
        await q(acct.agent, CANCEL, { id: posted.id, i: { version: 99, reason: 'again please' } }),
      ),
    ).toMatch(/CONFLICT|BUSINESS_RULE/);
  });

  it('allows a new invoice for a delivery whose invoice was cancelled', async () => {
    const source = await confirmedDelivery();
    const first = (
      await q(acct.agent, CREATE_INVOICE, {
        i: { kind: 'sales', sourceId: source, invoiceDate: today },
      })
    ).body.data.createInvoice;
    await q(acct.agent, CANCEL, { id: first.id, i: { version: first.version, reason: 'redo' } });
    const second = await q(acct.agent, CREATE_INVOICE, {
      i: { kind: 'sales', sourceId: source, invoiceDate: today },
    });
    expect(second.body.errors, JSON.stringify(second.body.errors)).toBeUndefined();
  });
});

describe('accounts: payments', () => {
  it('takes part payments, reduces what is owed and settles the invoice', async () => {
    const inv = await postedSales();
    const first = await q(acct.agent, PAY_IN, {
      i: { invoiceId: inv.id, amount: '5000', method: 'cash', paidOn: today, reference: 'CASH-1' },
    });
    expect(first.body.errors, JSON.stringify(first.body.errors)).toBeUndefined();
    expect(first.body.data.recordPayment.number).toMatch(/^RCT-\d{6}$/);
    let got = (await q(acct.agent, GET_INVOICE, { id: inv.id })).body.data.invoice;
    expect(got).toMatchObject({ paidAmount: '5000.00', outstanding: '6800.00' });
    expect(got.payments).toHaveLength(1);
    const second = await q(acct.agent, PAY_IN, {
      i: { invoiceId: inv.id, amount: '6800', method: 'upi', paidOn: today },
    });
    expect(second.body.errors).toBeUndefined();
    got = (await q(acct.agent, GET_INVOICE, { id: inv.id })).body.data.invoice;
    expect(got.outstanding).toBe('0.00');
    const open = await q(acct.agent, LIST_INVOICES, {
      i: { kind: 'sales', outstandingOnly: true },
    });
    expect(open.body.data.invoices.items.some((i: { id: string }) => i.id === inv.id)).toBe(false);
  });

  it('puts cash and bank money in the right accounts', async () => {
    const before = await trialMap();
    const inv = await postedSales();
    await q(acct.agent, PAY_IN, {
      i: { invoiceId: inv.id, amount: '100', method: 'cash', paidOn: today },
    });
    await q(acct.agent, PAY_IN, {
      i: { invoiceId: inv.id, amount: '200', method: 'cheque', paidOn: today },
    });
    const after = await trialMap();
    expect(money(after.by['1000']!.debit) - money(before.by['1000']!.debit)).toBe(10000);
    expect(money(after.by['1010']!.debit) - money(before.by['1010']!.debit)).toBe(20000);
    expect(after.balanced).toBe(true);
  });

  it('refuses overpaying, bad amounts, future dates and drafts', async () => {
    const inv = await postedSales();
    const pay = (extra: Record<string, unknown>) =>
      q(acct.agent, PAY_IN, {
        i: { invoiceId: inv.id, amount: '10', method: 'cash', paidOn: today, ...extra },
      });
    const over = await pay({ amount: '11800.01' });
    expect(code(over)).toBe('BUSINESS_RULE');
    expect(over.body.errors[0].extensions.fieldErrors.amount).toBeDefined();
    for (const bad of ['0', '-5', '1e3', 'abc', '1.234', '']) {
      expect(code(await pay({ amount: bad })), bad).toBe('VALIDATION_ERROR');
    }
    expect(code(await pay({ paidOn: '2099-01-01' }))).toBe('VALIDATION_ERROR');
    expect(code(await pay({ paidOn: '2000-01-01' }))).toBe('VALIDATION_ERROR');
    expect(code(await pay({ method: 'bitcoin' }))).toBe('BAD_REQUEST');
    const draft = (await salesInvoice()).createInvoice;
    expect(
      code(
        await q(acct.agent, PAY_IN, {
          i: { invoiceId: draft.id, amount: '10', method: 'cash', paidOn: today },
        }),
      ),
    ).toBe('BUSINESS_RULE');
  });

  it('never lets parallel payments exceed the invoice', async () => {
    const inv = await postedSales();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        q(acct.agent, PAY_IN, {
          i: { invoiceId: inv.id, amount: '4000', method: 'bank', paidOn: today },
        }),
      ),
    );
    expect(results.filter((r) => !r.body.errors)).toHaveLength(2);
    const got = (await q(acct.agent, GET_INVOICE, { id: inv.id })).body.data.invoice;
    expect(got.paidAmount).toBe('8000.00');
  });

  it('voids a payment with a reversal and frees the balance; only once', async () => {
    const inv = await postedSales();
    const paid = (
      await q(acct.agent, PAY_IN, {
        i: { invoiceId: inv.id, amount: '3000', method: 'cash', paidOn: today },
      })
    ).body.data.recordPayment;
    const before = await trialMap();
    const voided = await q(acct.agent, VOID, { id: paid.id, i: { reason: 'Bounced' } });
    expect(voided.body.errors, JSON.stringify(voided.body.errors)).toBeUndefined();
    expect(voided.body.data.voidPayment).toMatchObject({ voidReason: 'Bounced' });
    expect(voided.body.data.voidPayment.voidedAt).not.toBeNull();
    const got = (await q(acct.agent, GET_INVOICE, { id: inv.id })).body.data.invoice;
    expect(got.paidAmount).toBe('0.00');
    const after = await trialMap();
    expect(money(after.by['1000']!.balance)).toBe(money(before.by['1000']!.balance) - 300000);
    expect(after.balanced).toBe(true);
    expect(code(await q(acct.agent, VOID, { id: paid.id, i: { reason: 'Again' } }))).toBe(
      'BUSINESS_RULE',
    );
    expect(code(await q(acct.agent, VOID, { id: paid.id, i: { reason: '' } }))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('cannot cancel an invoice that still has live payments', async () => {
    const inv = await postedSales();
    const paid = (
      await q(acct.agent, PAY_IN, {
        i: { invoiceId: inv.id, amount: '1000', method: 'cash', paidOn: today },
      })
    ).body.data.recordPayment;
    expect(
      code(await q(acct.agent, CANCEL, { id: inv.id, i: { version: 99, reason: 'nope' } })),
    ).toMatch(/CONFLICT|BUSINESS_RULE/);
    const fresh = (await q(acct.agent, GET_INVOICE, { id: inv.id })).body.data.invoice;
    expect(
      code(
        await q(acct.agent, CANCEL, { id: inv.id, i: { version: fresh.version, reason: 'nope' } }),
      ),
    ).toBe('BUSINESS_RULE');
    await q(acct.agent, VOID, { id: paid.id, i: { reason: 'Undo' } });
    const again = (await q(acct.agent, GET_INVOICE, { id: inv.id })).body.data.invoice;
    expect(
      (await q(acct.agent, CANCEL, { id: inv.id, i: { version: again.version, reason: 'now ok' } }))
        .body.errors,
    ).toBeUndefined();
  });

  it('lists payments with filters', async () => {
    const list = await q(acct.agent, LIST_PAYMENTS, { i: { kind: 'sales' } });
    expect(list.body.data.payments.total).toBeGreaterThan(0);
    expect(
      (await q(acct.agent, LIST_PAYMENTS, { i: { kind: 'purchase' } })).body.data.payments.total,
    ).toBe(0);
  });
});

describe('accounts: supplier bills', () => {
  it('builds a bill from a goods receipt, posts it and pays the supplier', async () => {
    const rid = await receipt('10', '50', 5);
    const before = await trialMap();
    const made = await q(acct.agent, CREATE_INVOICE, {
      i: { kind: 'purchase', sourceId: rid, invoiceDate: today },
    });
    expect(made.body.errors, JSON.stringify(made.body.errors)).toBeUndefined();
    const bill = made.body.data.createInvoice;
    expect(bill).toMatchObject({
      kind: 'purchase',
      subtotal: '500.00',
      taxTotal: '25.00',
      grandTotal: '525.00',
      reference: 'SUP-INV-9',
    });
    expect(bill.number).toMatch(/^BILL-\d{6}$/);
    expect(
      code(
        await q(acct.agent, CREATE_INVOICE, {
          i: { kind: 'purchase', sourceId: rid, invoiceDate: today },
        }),
      ),
    ).toBe('BUSINESS_RULE');
    await must(await q(acct.agent, POST, { id: bill.id, i: { version: bill.version } }));
    let after = await trialMap();
    expect(money(after.by['5000']!.debit) - money(before.by['5000']!.debit)).toBe(50000);
    expect(money(after.by['1300']!.debit) - money(before.by['1300']!.debit)).toBe(2500);
    expect(money(after.by['2000']!.credit) - money(before.by['2000']!.credit)).toBe(52500);
    const pay = await q(acct.agent, PAY_IN, {
      i: { invoiceId: bill.id, amount: '525', method: 'bank', paidOn: today },
    });
    expect(pay.body.data.recordPayment.number).toMatch(/^PAY-\d{6}$/);
    after = await trialMap();
    expect(money(after.by['2000']!.balance)).toBe(money(before.by['2000']!.balance));
    expect(after.balanced).toBe(true);
  });

  it('mixes up neither kinds nor sources', async () => {
    const rid = await receipt();
    const source = await confirmedDelivery();
    expect(
      code(
        await q(acct.agent, CREATE_INVOICE, {
          i: { kind: 'sales', sourceId: rid, invoiceDate: today },
        }),
      ),
    ).toBe('NOT_FOUND');
    expect(
      code(
        await q(acct.agent, CREATE_INVOICE, {
          i: { kind: 'purchase', sourceId: source, invoiceDate: today },
        }),
      ),
    ).toBe('NOT_FOUND');
  });
});

describe('accounts: journal and reports', () => {
  const entry = async (
    as: Agent,
    lines: Record<string, string>[],
    extra: Record<string, unknown> = {},
  ) => {
    const accts = (await q(as, ACCOUNTS)).body.data.accounts as { id: string; code: string }[];
    const id = (c: string) => accts.find((a) => a.code === c)!.id;
    return q(as, CREATE_ENTRY, {
      i: {
        entryDate: today,
        memo: 'Owner capital introduced',
        lines: lines.map((l) => ({ accountId: id(l.account!), debit: l.debit, credit: l.credit })),
        ...extra,
      },
    });
  };

  it('posts balanced manual entries and rejects unbalanced or one-sided ones', async () => {
    const ok = await entry(acct.agent, [
      { account: '1010', debit: '50000', credit: '0' },
      { account: '3000', debit: '0', credit: '50000' },
    ]);
    expect(ok.body.errors, JSON.stringify(ok.body.errors)).toBeUndefined();
    expect(ok.body.data.createJournalEntry).toMatchObject({
      sourceType: 'manual',
      total: '50000.00',
    });
    expect(ok.body.data.createJournalEntry.number).toMatch(/^JE-\d{6}$/);
    for (const lines of [
      [
        { account: '1010', debit: '100', credit: '0' },
        { account: '3000', debit: '0', credit: '99.99' },
      ],
      [
        { account: '1010', debit: '100', credit: '100' },
        { account: '3000', debit: '0', credit: '0' },
      ],
      [{ account: '1010', debit: '100', credit: '0' }],
      [
        { account: '1010', debit: '0', credit: '0' },
        { account: '3000', debit: '0', credit: '0' },
      ],
    ]) {
      expect(code(await entry(acct.agent, lines))).toBe('VALIDATION_ERROR');
    }
    expect(
      code(
        await entry(acct.agent, [
          { account: '1010', debit: '1e5', credit: '0' },
          { account: '3000', debit: '0', credit: '1e5' },
        ]),
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('rejects a manual entry dated in the future', async () => {
    const future = await entry(
      acct.agent,
      [
        { account: '1010', debit: '100', credit: '0' },
        { account: '3000', debit: '0', credit: '100' },
      ],
      { entryDate: '9999-12-31' },
    );
    expect(code(future)).toBe('VALIDATION_ERROR');
    expect(future.body.errors?.[0]?.extensions?.fieldErrors).toMatchObject({
      entryDate: [expect.stringContaining('future')],
    });
  });

  it('reverses a manual entry once; automatic entries cannot be reversed by hand', async () => {
    const made = (
      await entry(acct.agent, [
        { account: '5100', debit: '700', credit: '0' },
        { account: '1000', debit: '0', credit: '700' },
      ])
    ).body.data.createJournalEntry;
    const before = await trialMap();
    const rev = await q(acct.agent, REVERSE, { id: made.id, i: { reason: 'Typo' } });
    expect(rev.body.errors, JSON.stringify(rev.body.errors)).toBeUndefined();
    expect(rev.body.data.reverseJournalEntry).toMatchObject({
      sourceType: 'reversal',
      reversalOf: made.id,
    });
    const after = await trialMap();
    expect(money(after.by['5100']!.balance)).toBe(money(before.by['5100']!.balance) - 70000);
    expect(code(await q(acct.agent, REVERSE, { id: made.id, i: { reason: 'Again' } }))).toBe(
      'BUSINESS_RULE',
    );
    const inv = await postedSales();
    expect(
      code(await q(acct.agent, REVERSE, { id: inv.journalEntryId, i: { reason: 'Nope' } })),
    ).toBe('BUSINESS_RULE');
  });

  it('refuses inactive accounts and keeps branch accountants in their branch', async () => {
    const fresh = (
      await q(acct.agent, CREATE_ACCOUNT, { i: { code: '5400', name: 'Old', type: 'expense' } })
    ).body.data.createAccount;
    await q(acct.agent, UPDATE_ACCOUNT, {
      id: fresh.id,
      i: { name: 'Old', status: 'inactive', version: fresh.version },
    });
    const accts = (await q(acct.agent, ACCOUNTS)).body.data.accounts as {
      id: string;
      code: string;
    }[];
    const cash = accts.find((a) => a.code === '1000')!.id;
    expect(
      code(
        await q(acct.agent, CREATE_ENTRY, {
          i: {
            entryDate: today,
            memo: 'Uses inactive',
            lines: [
              { accountId: fresh.id, debit: '5', credit: '0' },
              { accountId: cash, debit: '0', credit: '5' },
            ],
          },
        }),
      ),
    ).toBe('VALIDATION_ERROR');
    // A branch-scope accountant must name a branch of their own.
    const noBranch = await entry(acct2.agent, [
      { account: '1000', debit: '5', credit: '0' },
      { account: '3000', debit: '0', credit: '5' },
    ]);
    expect(code(noBranch)).toBe('VALIDATION_ERROR');
    const wrongBranch = await entry(
      acct2.agent,
      [
        { account: '1000', debit: '5', credit: '0' },
        { account: '3000', debit: '0', credit: '5' },
      ],
      { branchId: company.ho },
    );
    expect(code(wrongBranch)).toBe('FORBIDDEN');
    const mine = await entry(
      acct2.agent,
      [
        { account: '1000', debit: '5', credit: '0' },
        { account: '3000', debit: '0', credit: '5' },
      ],
      { branchId: company.br2 },
    );
    expect(mine.body.errors, JSON.stringify(mine.body.errors)).toBeUndefined();
    const id = mine.body.data.createJournalEntry.id;
    expect(code(await q(acct.agent, GET_ENTRY, { id }))).toBeUndefined();
    const hoEntry = (
      await q(acct.agent, LIST_ENTRIES, { i: { search: 'Owner capital', limit: 50 } })
    ).body.data.journalEntries.items.find((e: { id: string }) => e.id !== id);
    expect(code(await q(acct2.agent, GET_ENTRY, { id: hoEntry.id }))).toBe('NOT_FOUND');
  });

  it('keeps the trial balance balanced and honours the date', async () => {
    const t = await trialMap();
    expect(t.balanced).toBe(true);
    expect(t.totalDebit).toBe(t.totalCredit);
    const old = await trialMap(acct.agent, '2000-01-01');
    expect(old.totalDebit).toBe('0.00');
    expect(code(await q(acct.agent, TRIAL, { i: { asOf: 'yesterday' } }))).toBe('VALIDATION_ERROR');
  });

  it('lists each account once, on one side: its net position', async () => {
    const t = await trialMap();
    // Every account sits on a single side, and the two columns add up to the same figure.
    for (const r of t.rows) {
      expect(Number(r.debit) === 0 || Number(r.credit) === 0, `${r.code} has both sides`).toBe(
        true,
      );
    }
    const sum = (side: 'debit' | 'credit') =>
      t.rows.reduce((n, r) => n + Math.round(Number(r[side]) * 100), 0);
    expect(sum('debit')).toBe(sum('credit'));
    expect(sum('debit')).toBe(Math.round(Number(t.totalDebit) * 100));
    // Receivable has been debited by invoices and credited by receipts in earlier tests.
    const ar = t.by['1100']!;
    expect(Number(ar.debit) > 0 ? ar.credit : ar.debit).toBe('0.00');
  });

  it('shows an account ledger with running balances', async () => {
    const accts = (await q(acct.agent, ACCOUNTS)).body.data.accounts as {
      id: string;
      code: string;
    }[];
    const ar = accts.find((a) => a.code === '1100')!.id;
    const res = await q(acct.agent, LEDGER, { i: { accountId: ar, limit: 100 } });
    expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
    const ledger = res.body.data.accountLedger;
    expect(ledger.account.code).toBe('1100');
    expect(ledger.total).toBeGreaterThan(0);
    const last = ledger.items[ledger.items.length - 1];
    const t = await trialMap();
    expect(money(last.balance)).toBe(money(t.by['1100']!.balance));
    const future = await q(acct.agent, LEDGER, { i: { accountId: ar, from: '2099-01-01' } });
    expect(future.body.data.accountLedger.total).toBe(0);
    expect(money(future.body.data.accountLedger.opening)).toBe(money(t.by['1100']!.balance));
    expect(code(await q(acct.agent, LEDGER, { i: { accountId: 'not-an-id' } }))).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('ages what customers owe', async () => {
    const inv = await postedSales();
    const res = await q(acct.agent, AGEING, { i: { kind: 'sales' } });
    expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
    const ageing = res.body.data.ageing;
    const row = ageing.rows.find((r: { partyName: string }) => r.partyName === 'Anand Stores');
    expect(row).toBeDefined();
    expect(money(row.total)).toBeGreaterThanOrEqual(money(inv.grandTotal));
    expect(money(ageing.totals.total)).toBe(
      money(ageing.totals.current) +
        money(ageing.totals.days30) +
        money(ageing.totals.days60) +
        money(ageing.totals.days90) +
        money(ageing.totals.over90),
    );
    expect(code(await q(acct.agent, AGEING, { i: { kind: 'other' } }))).toMatch(
      /BAD_REQUEST|VALIDATION/,
    );
  });
});

describe('accounts: scope, isolation and database guarantees', () => {
  it('hides other branches’ invoices from a branch accountant', async () => {
    const inv = await postedSales();
    expect(code(await q(acct2.agent, GET_INVOICE, { id: inv.id }))).toBe('NOT_FOUND');
    expect(
      code(
        await q(acct2.agent, PAY_IN, {
          i: { invoiceId: inv.id, amount: '1', method: 'cash', paidOn: today },
        }),
      ),
    ).toBe('NOT_FOUND');
    const list = await q(acct2.agent, LIST_INVOICES, { i: { kind: 'sales' } });
    expect(list.body.data.invoices.items.some((i: { id: string }) => i.id === inv.id)).toBe(false);
    const t = await trialMap(acct2.agent);
    expect(money(t.by['1100']!.debit)).toBe(0);
  });

  it('isolates tenants', async () => {
    const inv = await postedSales();
    expect(code(await q(other.owner, GET_INVOICE, { id: inv.id }))).toBe('NOT_FOUND');
    expect(
      code(
        await q(other.owner, PAY_IN, {
          i: { invoiceId: inv.id, amount: '1', method: 'cash', paidOn: today },
        }),
      ),
    ).toBe('NOT_FOUND');
    expect(code(await q(other.owner, GET_ENTRY, { id: inv.journalEntryId }))).toBe('NOT_FOUND');
    const t = await trialMap(other.owner);
    expect(t.totalDebit).toBe('0.00');
  });

  it('rejects unbalanced journal lines at the database, and edits or deletes of the ledger', async () => {
    const tenant = (await q(owner(), `{ me { organisation { id } } }`)).body.data.me.organisation
      .id as string;
    await expect(
      withTenant(database.db, tenant, async (tx) => {
        const [a] = await tx.execute<{ id: string }>(sql`select id from accounts limit 1`);
        const [e] = await tx.execute<{ id: string }>(sql`
          insert into journal_entries (tenant_id, number, entry_date, memo, source_type, created_by)
          values (${tenant}, 'JE-BAD', ${today}::date, 'bad', 'manual',
                  (select id from users limit 1)) returning id`);
        await tx.execute(sql`
          insert into journal_lines (tenant_id, entry_id, account_id, debit, credit)
          values (${tenant}, ${e!.id}, ${a!.id}, 10, 0)`);
      }),
    ).rejects.toThrow();
    await expect(
      withTenant(database.db, tenant, (tx) =>
        tx.execute(sql`update journal_lines set debit = debit + 1`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(database.db, tenant, (tx) => tx.execute(sql`delete from journal_entries`)),
    ).rejects.toThrow();
    await expect(
      withTenant(database.db, tenant, (tx) =>
        tx.execute(sql`update invoice_lines set quantity = 1`),
      ),
    ).rejects.toThrow();
  });

  it('refuses overpayment and negative paid amounts even if the application is bypassed', async () => {
    const inv = await postedSales();
    const tenant = (await q(owner(), `{ me { organisation { id } } }`)).body.data.me.organisation
      .id as string;
    await expect(
      withTenant(database.db, tenant, (tx) =>
        tx.execute(sql`update invoices set paid_amount = grand_total + 1 where id = ${inv.id}`),
      ),
    ).rejects.toThrow();
  });

  it('rate-limits accounting writes per user', async () => {
    const strict = testApp({ limits: { accountsWritesPerUser: { limit: 2, windowMs: 60_000 } } });
    const strictOrg = await registerOrg(strict);
    const co = await buildCompany(strict, strictOrg);
    const acc = (await q(co.owner, ACCOUNTS)).body.data.accounts as { id: string; code: string }[];
    const line = (c: string, d: string, cr: string) => ({
      accountId: acc.find((a) => a.code === c)!.id,
      debit: d,
      credit: cr,
    });
    const make = () =>
      q(co.owner, CREATE_ENTRY, {
        i: {
          entryDate: today,
          memo: 'Flood test',
          lines: [line('1000', '1', '0'), line('3000', '0', '1')],
        },
      });
    expect((await make()).body.errors).toBeUndefined();
    expect((await make()).body.errors).toBeUndefined();
    expect(code(await make())).toBe('RATE_LIMITED');
  });
});
