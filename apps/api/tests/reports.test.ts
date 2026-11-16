import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database, registerOrg, testApp } from './helpers';
import {
  CREATE_HOLIDAY,
  CREATE_ROLE,
  MANUAL,
  buildCompany,
  code,
  q,
  type Org,
  type Person,
} from './hr-support';

const app = testApp();
afterAll(() => database.close());

const today = new Date().toISOString().slice(0, 10);

const PNL = `query($i: ReportRangeInput){ profitAndLoss(input:$i){ from to totalIncome totalExpenses netProfit income { code name amount } expenses { code amount } } }`;
const BS = `query($i: BalanceSheetInput){ balanceSheet(input:$i){ asOf totalAssets totalLiabilities totalEquity earnings balanced assets { code amount } liabilities { code amount } equity { code amount } } }`;
const SUMMARY = `query($i: InvoiceSummaryInput!){ invoiceSummary(input:$i){ kind from to count subtotal taxTotal grandTotal paid outstanding byMonth { month count grandTotal } byParty { name count grandTotal } byItem { sku name quantity subtotal } } }`;
const STOCK = `query($i: StockReportInput){ stockReport(input:$i){ total totalValue lowCount unpriced items { sku quantity reorderLevel averageCost value low } } }`;
const ATTENDANCE = `query($i: AttendanceSummaryInput){ attendanceSummary(input:$i){ month label total items { employeeId employeeCode branch { code } presentDays halfDays offDays holidayDays absentDays paidHalfDays } } }`;
const PAYROLL = `query($i: PayrollSummaryInput){ payrollSummary(input:$i){ fromMonth toMonth gross deductions net runs { label status employeeCount gross net } byBranch { code employees gross deductions net } } }`;

const ACCOUNTS = `{ accounts { id code } }`;
const CREATE_ENTRY = `mutation($i: CreateJournalEntryInput!){ createJournalEntry(input:$i){ id } }`;
const CREATE_INVOICE = `mutation($i: CreateInvoiceInput!){ createInvoice(input:$i){ id version } }`;
const POST = `mutation($id: ID!, $i: PostInvoiceInput!){ postInvoice(id:$id,input:$i){ id version } }`;
const PAY_IN = `mutation($i: RecordPaymentInput!){ recordPayment(input:$i){ id } }`;
const CREATE_CUSTOMER = `mutation($i: CreateCustomerInput!){ createCustomer(input:$i){ id } }`;
const CREATE_SUPPLIER = `mutation($i: CreateSupplierInput!){ createSupplier(input:$i){ id } }`;
const CREATE_ITEM = `mutation($i: CreateItemInput!){ createItem(input:$i){ id } }`;
const RECEIVE_STOCK = `mutation($i: ReceiveStockInput!){ receiveStock(input:$i){ balance } }`;
const WAREHOUSES = `{ warehouses { id } }`;
const CREATE_SO = `mutation($i: CreateSalesOrderInput!){ createSalesOrder(input:$i){ id version lines { id } } }`;
const CONFIRM_SO = `mutation($id: ID!, $i: SalesDecisionInput!){ confirmSalesOrder(id:$id,input:$i){ id } }`;
const DELIVER = `mutation($i: DeliverGoodsInput!){ deliverGoods(input:$i){ deliveries { id } } }`;
const CREATE_PO = `mutation($i: CreateOrderInput!){ createPurchaseOrder(input:$i){ id version lines { id } } }`;
const APPROVE_PO = `mutation($id: ID!, $i: OrderDecisionInput!){ approvePurchaseOrder(id:$id,input:$i){ id } }`;
const RECEIVE = `mutation($i: ReceiveGoodsInput!){ receiveGoods(input:$i){ receipts { id } } }`;
const SAVE = `mutation($i: SaveSalaryStructureInput!){ saveSalaryStructure(input:$i){ employeeId } }`;
const CREATE_RUN = `mutation($i: CreatePayrollRunInput!){ createPayrollRun(input:$i){ run { id version } } }`;
const APPROVE_RUN = `mutation($id: ID!, $i: PayrollVersionInput!){ approvePayrollRun(id:$id,input:$i){ id } }`;
const CANCEL_RUN = `mutation($id: ID!, $i: CancelPayrollRunInput!){ cancelPayrollRun(id:$id,input:$i){ id } }`;

async function must<T>(res: { body: { errors?: unknown; data: T } }) {
  expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
  return res.body.data;
}

let company: Awaited<ReturnType<typeof buildCompany>>;
let other: Awaited<ReturnType<typeof buildCompany>>;
let finance: Person; // report.financial.view, whole organisation
let ops: Person; // report.operational.view, whole organisation
let sales: Person; // report.sales.view, HO branch
let sales2: Person; // report.sales.view, BR2 branch
let ownOnly: Person; // report.sales.view, own records
let plain: Person;
let ann: Person;
let bob: Person;
let main = '';
let octRun = { id: '', version: 0 };
let customerId = '';
const owner = () => company.owner;

async function newItem(sku: string, extra: Record<string, unknown> = {}) {
  const d = (await must(
    await q(owner(), CREATE_ITEM, { i: { sku, unit: 'pcs', name: `Item ${sku}`, ...extra } }),
  )) as { createItem: { id: string } };
  return d.createItem.id;
}

beforeAll(async () => {
  const org: Org = await registerOrg(app);
  company = await buildCompany(app, org);
  other = await buildCompany(app, await registerOrg(app));
  const mkRole = async (name: string, dataScope: string, permissions: string[]) => {
    const res = await q(owner(), CREATE_ROLE, { i: { name, dataScope, permissions } });
    expect(res.body.errors, JSON.stringify(res.body.errors)).toBeUndefined();
    return res.body.data.createRole.id as string;
  };
  company.roleId.finance = await mkRole('Finance reader', 'organisation', [
    'report.financial.view',
  ]);
  company.roleId.ops = await mkRole('Operations reader', 'organisation', [
    'report.operational.view',
  ]);
  company.roleId.sales = await mkRole('Sales reader', 'branch', ['report.sales.view']);
  company.roleId.ownOnly = await mkRole('Own sales reader', 'own', ['report.sales.view']);
  company.roleId.confirmer = await mkRole('Confirmer', 'organisation', [
    'sale.order.view',
    'sale.order.approve',
    'purchase.order.view',
    'purchase.order.approve',
  ]);
  company.roleId.payroll = await mkRole('Payroll all-rounder', 'organisation', [
    'payroll.structure.view',
    'payroll.structure.manage',
    'payroll.run.view',
    'payroll.run.prepare',
    'payroll.run.approve',
  ]);
  finance = await company.person({ role: 'finance', branch: company.ho, name: 'Fin Reader' });
  ops = await company.person({ role: 'ops', branch: company.ho, name: 'Ops Reader' });
  sales = await company.person({ role: 'sales', branch: company.ho, name: 'Sales Reader' });
  sales2 = await company.person({ role: 'sales', branch: company.br2, name: 'Sales Reader Two' });
  ownOnly = await company.person({ role: 'ownOnly', branch: company.ho, name: 'Own Reader' });
  plain = await company.person({ role: 'employee', branch: company.ho, name: 'Plain Person' });
  ann = await company.person({ role: 'employee', branch: company.ho, name: 'Ann Employee' });
  bob = await company.person({ role: 'employee', branch: company.br2, name: 'Bob Employee' });
  const confirmer = await company.person({
    role: 'confirmer',
    branch: company.ho,
    name: 'Con Firmer',
  });
  const payroll = await company.person({ role: 'payroll', branch: company.ho, name: 'Pay Roll' });

  customerId = (
    (await must(
      await q(owner(), CREATE_CUSTOMER, { i: { code: 'CUS-1', name: 'Anand Stores' } }),
    )) as {
      createCustomer: { id: string };
    }
  ).createCustomer.id;
  const supplierId = (
    (await must(
      await q(owner(), CREATE_SUPPLIER, { i: { code: 'SUP-1', name: 'Murugan Traders' } }),
    )) as {
      createSupplier: { id: string };
    }
  ).createSupplier.id;
  main = ((await q(owner(), WAREHOUSES)).body.data.warehouses[0] as { id: string }).id;

  // --- a sale: 100 x Rs100 at 18% = 10,000 + 1,800 tax, posted, with Rs 5,000 received by bank.
  const sold = await newItem('SOLD-1');
  await must(
    await q(owner(), RECEIVE_STOCK, { i: { itemId: sold, warehouseId: main, quantity: '1000' } }),
  );
  const so = (
    (await must(
      await q(owner(), CREATE_SO, {
        i: {
          customerId,
          branchId: company.ho,
          orderDate: today,
          lines: [{ itemId: sold, quantity: '100', unitPrice: '100', gstRate: 18 }],
        },
      }),
    )) as { createSalesOrder: { id: string; version: number; lines: { id: string }[] } }
  ).createSalesOrder;
  await must(await q(confirmer.agent, CONFIRM_SO, { id: so.id, i: { version: so.version } }));
  const delivery = (
    (await must(
      await q(owner(), DELIVER, {
        i: {
          orderId: so.id,
          warehouseId: main,
          lines: [{ orderLineId: so.lines[0]!.id, quantity: '100' }],
        },
      }),
    )) as { deliverGoods: { deliveries: { id: string }[] } }
  ).deliverGoods.deliveries[0]!.id;
  const inv = (
    (await must(
      await q(owner(), CREATE_INVOICE, {
        i: { kind: 'sales', sourceId: delivery, invoiceDate: today, dueDate: today },
      }),
    )) as { createInvoice: { id: string; version: number } }
  ).createInvoice;
  await must(await q(owner(), POST, { id: inv.id, i: { version: inv.version } }));
  await must(
    await q(owner(), PAY_IN, {
      i: { invoiceId: inv.id, amount: '5000', method: 'bank', paidOn: today },
    }),
  );

  // --- a draft sale that must not count anywhere.
  const draftItem = await newItem('DRAFT-1');
  await must(
    await q(owner(), RECEIVE_STOCK, {
      i: { itemId: draftItem, warehouseId: main, quantity: '50' },
    }),
  );
  const so2 = (
    (await must(
      await q(owner(), CREATE_SO, {
        i: {
          customerId,
          branchId: company.ho,
          orderDate: today,
          lines: [{ itemId: draftItem, quantity: '10', unitPrice: '999', gstRate: 5 }],
        },
      }),
    )) as { createSalesOrder: { id: string; version: number; lines: { id: string }[] } }
  ).createSalesOrder;
  await must(await q(confirmer.agent, CONFIRM_SO, { id: so2.id, i: { version: so2.version } }));
  const d2 = (
    (await must(
      await q(owner(), DELIVER, {
        i: {
          orderId: so2.id,
          warehouseId: main,
          lines: [{ orderLineId: so2.lines[0]!.id, quantity: '10' }],
        },
      }),
    )) as { deliverGoods: { deliveries: { id: string }[] } }
  ).deliverGoods.deliveries[0]!.id;
  await must(
    await q(owner(), CREATE_INVOICE, {
      i: { kind: 'sales', sourceId: d2, invoiceDate: today, dueDate: today },
    }),
  );

  // --- a purchase: 10 x Rs50 at 5% = 500 + 25 tax, received into stock and billed.
  const bought = await newItem('BOUGHT-1');
  const po = (
    (await must(
      await q(owner(), CREATE_PO, {
        i: {
          supplierId,
          branchId: company.ho,
          orderDate: today,
          lines: [{ itemId: bought, quantity: '10', unitPrice: '50', gstRate: 5 }],
        },
      }),
    )) as { createPurchaseOrder: { id: string; version: number; lines: { id: string }[] } }
  ).createPurchaseOrder;
  await must(await q(confirmer.agent, APPROVE_PO, { id: po.id, i: { version: po.version } }));
  const receipt = (
    (await must(
      await q(owner(), RECEIVE, {
        i: {
          orderId: po.id,
          warehouseId: main,
          supplierInvoiceNo: 'SUP-9',
          lines: [{ orderLineId: po.lines[0]!.id, quantity: '10' }],
        },
      }),
    )) as { receiveGoods: { receipts: { id: string }[] } }
  ).receiveGoods.receipts[0]!.id;
  const bill = (
    (await must(
      await q(owner(), CREATE_INVOICE, {
        i: { kind: 'purchase', sourceId: receipt, invoiceDate: today, dueDate: today },
      }),
    )) as { createInvoice: { id: string; version: number } }
  ).createInvoice;
  await must(await q(owner(), POST, { id: bill.id, i: { version: bill.version } }));

  // --- stock that is low: reorder level 20, only 5 on hand, never bought.
  const low = await newItem('LOW-1', { reorderLevel: '20' });
  await must(
    await q(owner(), RECEIVE_STOCK, { i: { itemId: low, warehouseId: main, quantity: '5' } }),
  );

  // --- an old expense (Rs 1,000 cash, January 2020), outside the financial year.
  const ids = Object.fromEntries(
    (
      (await must(await q(owner(), ACCOUNTS))) as { accounts: { id: string; code: string }[] }
    ).accounts.map((a) => [a.code, a.id]),
  );
  await must(
    await q(owner(), CREATE_ENTRY, {
      i: {
        entryDate: '2020-01-15',
        memo: 'Old rent',
        lines: [
          { accountId: ids['5100'], debit: '1000', credit: '0' },
          { accountId: ids['1000'], debit: '0', credit: '1000' },
        ],
      },
    }),
  );

  // --- attendance and payroll for October 2026.
  await must(
    await q(owner(), CREATE_HOLIDAY, { i: { holidayDate: '2026-10-02', name: 'Gandhi Jayanti' } }),
  );
  for (const day of ['01', '05', '06', '07', '08']) {
    await must(
      await q(owner(), MANUAL, {
        i: {
          employeeId: ann.employeeId,
          inAt: `2026-10-${day}T09:00:00+05:30`,
          outAt: `2026-10-${day}T18:00:00+05:30`,
          reason: 'Test data',
        },
      }),
    );
  }
  await must(
    await q(payroll.agent, SAVE, {
      i: { employeeId: ann.employeeId, basic: '30000', hra: '10000', deductions: '500' },
    }),
  );
  await must(
    await q(payroll.agent, SAVE, {
      i: { employeeId: bob.employeeId, basic: '15000', deductions: '3000' },
    }),
  );
  const oct = (
    (await must(await q(payroll.agent, CREATE_RUN, { i: { month: '2026-10' } }))) as {
      createPayrollRun: { run: { id: string; version: number } };
    }
  ).createPayrollRun.run;
  // A cancelled run must not be counted.
  const sep = (
    (await must(await q(payroll.agent, CREATE_RUN, { i: { month: '2026-09' } }))) as {
      createPayrollRun: { run: { id: string; version: number } };
    }
  ).createPayrollRun.run;
  await must(
    await q(payroll.agent, CANCEL_RUN, {
      id: sep.id,
      i: { version: sep.version, reason: 'Test cancel' },
    }),
  );
  octRun = oct;
});

describe('reports: permissions', () => {
  it('rejects a plain employee on every report', async () => {
    for (const [query, i] of [
      [PNL, {}],
      [BS, {}],
      [SUMMARY, { kind: 'sales' }],
      [SUMMARY, { kind: 'purchase' }],
      [STOCK, {}],
      [ATTENDANCE, {}],
      [PAYROLL, {}],
    ] as const) {
      expect(code(await q(plain.agent, query, { i })), query.slice(0, 40)).toBe('FORBIDDEN');
    }
  });

  it('keeps financial, sales and operational reports apart', async () => {
    expect(await must(await q(finance.agent, PNL))).toBeTruthy();
    expect(await must(await q(finance.agent, BS))).toBeTruthy();
    expect(await must(await q(finance.agent, PAYROLL))).toBeTruthy();
    expect(code(await q(finance.agent, STOCK))).toBe('FORBIDDEN');
    expect(code(await q(finance.agent, SUMMARY, { i: { kind: 'sales' } }))).toBe('FORBIDDEN');

    expect(await must(await q(ops.agent, STOCK))).toBeTruthy();
    expect(await must(await q(ops.agent, ATTENDANCE))).toBeTruthy();
    expect(await must(await q(ops.agent, SUMMARY, { i: { kind: 'purchase' } }))).toBeTruthy();
    expect(code(await q(ops.agent, PNL))).toBe('FORBIDDEN');
    expect(code(await q(ops.agent, PAYROLL))).toBe('FORBIDDEN');
    expect(code(await q(ops.agent, SUMMARY, { i: { kind: 'sales' } }))).toBe('FORBIDDEN');

    expect(await must(await q(sales.agent, SUMMARY, { i: { kind: 'sales' } }))).toBeTruthy();
    expect(code(await q(sales.agent, SUMMARY, { i: { kind: 'purchase' } }))).toBe('FORBIDDEN');
    expect(code(await q(sales.agent, STOCK))).toBe('FORBIDDEN');
  });

  it('needs organisation-wide access for company-wide reports', async () => {
    // A branch-scoped role that holds the financial permissions still may not see company-wide figures.
    const res = await q(owner(), CREATE_ROLE, {
      i: {
        name: 'Branch finance',
        dataScope: 'branch',
        permissions: ['report.financial.view', 'report.operational.view'],
      },
    });
    company.roleId.branchFinance = res.body.data.createRole.id;
    const person = await company.person({ role: 'branchFinance', branch: company.ho, name: 'Bf' });
    for (const query of [PNL, BS, STOCK, ATTENDANCE, PAYROLL]) {
      const r = await q(person.agent, query);
      expect(code(r), query.slice(0, 30)).toBe('FORBIDDEN');
      expect(r.body.errors[0].message).toMatch(/organisation-wide/);
    }
  });
});

describe('profit and loss', () => {
  it('adds up this financial year from the books', async () => {
    const d = (await must(await q(finance.agent, PNL))) as {
      profitAndLoss: {
        totalIncome: string;
        totalExpenses: string;
        netProfit: string;
        income: { code: string; amount: string }[];
        expenses: { code: string; amount: string }[];
      };
    };
    expect(d.profitAndLoss.income).toEqual([{ code: '4000', name: 'Sales', amount: '10000.00' }]);
    // The January 2020 rent is outside the year; the purchase is in.
    expect(d.profitAndLoss.expenses).toEqual([{ code: '5000', amount: '500.00' }]);
    expect(d.profitAndLoss).toMatchObject({
      totalIncome: '10000.00',
      totalExpenses: '500.00',
      netProfit: '9500.00',
    });
  });

  it('honours the dates it is given', async () => {
    const all = (await must(
      await q(finance.agent, PNL, { i: { from: '2020-01-01', to: today } }),
    )) as {
      profitAndLoss: { totalExpenses: string; netProfit: string; expenses: { code: string }[] };
    };
    expect(all.profitAndLoss.expenses.map((e) => e.code)).toEqual(['5000', '5100']);
    expect(all.profitAndLoss).toMatchObject({ totalExpenses: '1500.00', netProfit: '8500.00' });

    const rent = (await must(
      await q(finance.agent, PNL, { i: { from: '2020-01-01', to: '2020-12-31' } }),
    )) as { profitAndLoss: { totalIncome: string; netProfit: string } };
    expect(rent.profitAndLoss).toMatchObject({ totalIncome: '0.00', netProfit: '-1000.00' });

    const none = (await must(
      await q(finance.agent, PNL, { i: { from: '2019-01-01', to: '2019-12-31' } }),
    )) as { profitAndLoss: { income: unknown[]; netProfit: string } };
    expect(none.profitAndLoss).toMatchObject({ income: [], netProfit: '0.00' });
  });

  it('rejects bad ranges', async () => {
    for (const i of [
      { from: '2026-05-01', to: '2026-04-01' },
      { from: '2000-01-01', to: '2026-01-01' },
      { from: 'yesterday' },
      { to: '2026-02-30' },
      { extra: 1 },
    ]) {
      expect(code(await q(finance.agent, PNL, { i })), JSON.stringify(i)).toMatch(
        /VALIDATION_ERROR|BAD_REQUEST/,
      );
    }
  });
});

describe('balance sheet', () => {
  it('balances, with the profit shown as earnings', async () => {
    const d = (await must(await q(finance.agent, BS))) as {
      balanceSheet: {
        balanced: boolean;
        earnings: string;
        totalAssets: string;
        totalLiabilities: string;
        totalEquity: string;
        assets: { code: string; amount: string }[];
        liabilities: { code: string; amount: string }[];
      };
    };
    const by = (rows: { code: string; amount: string }[]) =>
      Object.fromEntries(rows.map((r) => [r.code, r.amount]));
    // Receivable 6,800 (11,800 less 5,000 received), bank 5,000, cash -1,000, GST input 25.
    expect(by(d.balanceSheet.assets)).toEqual({
      '1000': '-1000.00',
      '1010': '5000.00',
      '1100': '6800.00',
      '1300': '25.00',
    });
    expect(by(d.balanceSheet.liabilities)).toEqual({ '2000': '525.00', '2100': '1800.00' });
    expect(d.balanceSheet).toMatchObject({
      earnings: '8500.00',
      totalAssets: '10825.00',
      totalLiabilities: '2325.00',
      totalEquity: '8500.00',
      balanced: true,
    });
  });

  it('can be run for an earlier date', async () => {
    const early = (await must(await q(finance.agent, BS, { i: { asOf: '2020-12-31' } }))) as {
      balanceSheet: {
        balanced: boolean;
        totalAssets: string;
        assets: { code: string }[];
        earnings: string;
      };
    };
    // Only the January 2020 rent existed then.
    expect(early.balanceSheet).toMatchObject({
      balanced: true,
      totalAssets: '-1000.00',
      earnings: '-1000.00',
    });
    const before = (await must(await q(finance.agent, BS, { i: { asOf: '2019-12-31' } }))) as {
      balanceSheet: { assets: unknown[]; totalAssets: string; balanced: boolean };
    };
    expect(before.balanceSheet).toMatchObject({ assets: [], totalAssets: '0.00', balanced: true });
    expect(code(await q(finance.agent, BS, { i: { asOf: 'soon' } }))).toMatch(
      /VALIDATION_ERROR|BAD_REQUEST/,
    );
  });
});

describe('sales and purchase summaries', () => {
  it('summarises posted sales only', async () => {
    const d = (await must(await q(sales.agent, SUMMARY, { i: { kind: 'sales' } }))) as {
      invoiceSummary: {
        count: number;
        subtotal: string;
        taxTotal: string;
        grandTotal: string;
        paid: string;
        outstanding: string;
        byMonth: { month: string; count: number; grandTotal: string }[];
        byParty: { name: string; count: number; grandTotal: string }[];
        byItem: { sku: string; quantity: string; subtotal: string }[];
      };
    };
    const s = d.invoiceSummary;
    expect(s).toMatchObject({
      count: 1,
      subtotal: '10000.00',
      taxTotal: '1800.00',
      grandTotal: '11800.00',
      paid: '5000.00',
      outstanding: '6800.00',
    });
    expect(s.byMonth).toEqual([{ month: today.slice(0, 7), count: 1, grandTotal: '11800.00' }]);
    expect(s.byParty).toEqual([{ name: 'Anand Stores', count: 1, grandTotal: '11800.00' }]);
    expect(s.byItem).toHaveLength(1);
    expect(s.byItem[0]).toMatchObject({ sku: 'SOLD-1', quantity: '100.000', subtotal: '10000.00' });
  });

  it('summarises purchases for those who may see them', async () => {
    const d = (await must(await q(ops.agent, SUMMARY, { i: { kind: 'purchase' } }))) as {
      invoiceSummary: {
        count: number;
        grandTotal: string;
        byParty: { name: string }[];
        byItem: { sku: string }[];
      };
    };
    expect(d.invoiceSummary).toMatchObject({ count: 1, grandTotal: '525.00' });
    expect(d.invoiceSummary.byParty[0]!.name).toBe('Murugan Traders');
    expect(d.invoiceSummary.byItem[0]!.sku).toBe('BOUGHT-1');
  });

  it('respects the period', async () => {
    const past = (await must(
      await q(sales.agent, SUMMARY, { i: { kind: 'sales', from: '2020-01-01', to: '2020-12-31' } }),
    )) as { invoiceSummary: { count: number; grandTotal: string; byMonth: unknown[] } };
    expect(past.invoiceSummary).toMatchObject({ count: 0, grandTotal: '0.00', byMonth: [] });
    expect(
      code(
        await q(sales.agent, SUMMARY, {
          i: { kind: 'sales', from: '2026-12-01', to: '2026-01-01' },
        }),
      ),
    ).toMatch(/VALIDATION_ERROR|BAD_REQUEST/);
    expect(code(await q(sales.agent, SUMMARY, { i: { kind: 'refunds' } }))).toBe('BAD_REQUEST');
  });

  it('shows a branch role only its own branch, and an own-scope role only what they made', async () => {
    const mine = (await must(await q(sales.agent, SUMMARY, { i: { kind: 'sales' } }))) as {
      invoiceSummary: { count: number };
    };
    expect(mine.invoiceSummary.count).toBe(1);
    const elsewhere = (await must(await q(sales2.agent, SUMMARY, { i: { kind: 'sales' } }))) as {
      invoiceSummary: { count: number; grandTotal: string };
    };
    expect(elsewhere.invoiceSummary).toMatchObject({ count: 0, grandTotal: '0.00' });
    // The owner made the invoice, not this person.
    const own = (await must(await q(ownOnly.agent, SUMMARY, { i: { kind: 'sales' } }))) as {
      invoiceSummary: { count: number };
    };
    expect(own.invoiceSummary.count).toBe(0);
    // A branch filter outside the viewer's branches is refused rather than quietly empty.
    expect(
      code(await q(sales2.agent, SUMMARY, { i: { kind: 'sales', branchId: company.ho } })),
    ).toBe('FORBIDDEN');
  });

  it('can be limited to one branch by someone who sees them all', async () => {
    const ho = (await must(
      await q(owner(), SUMMARY, { i: { kind: 'sales', branchId: company.ho } }),
    )) as { invoiceSummary: { count: number } };
    expect(ho.invoiceSummary.count).toBe(1);
    const br2 = (await must(
      await q(owner(), SUMMARY, { i: { kind: 'sales', branchId: company.br2 } }),
    )) as { invoiceSummary: { count: number } };
    expect(br2.invoiceSummary.count).toBe(0);
  });
});

describe('stock report', () => {
  type Row = {
    sku: string;
    quantity: string;
    reorderLevel: string;
    averageCost: string | null;
    value: string | null;
    low: boolean;
  };
  const stock = async (i: Record<string, unknown> = {}) =>
    (
      (await must(await q(ops.agent, STOCK, { i }))) as {
        stockReport: {
          total: number;
          totalValue: string;
          lowCount: number;
          unpriced: number;
          items: Row[];
        };
      }
    ).stockReport;

  it('values bought stock at the average purchase price and flags the rest', async () => {
    const r = await stock({ limit: 100 });
    const by = Object.fromEntries(r.items.map((i) => [i.sku, i]));
    expect(by['BOUGHT-1']).toMatchObject({
      quantity: '10.000',
      averageCost: '50.00',
      value: '500.00',
      low: false,
    });
    // Never bought: on hand but worth nothing here.
    expect(by['SOLD-1']).toMatchObject({ quantity: '900.000', averageCost: null, value: null });
    expect(by['LOW-1']).toMatchObject({ quantity: '5.000', reorderLevel: '20.000', low: true });
    expect(r.totalValue).toBe('500.00');
    expect(r.lowCount).toBe(1);
    expect(r.unpriced).toBeGreaterThanOrEqual(2);
    // Low stock comes first.
    expect(r.items[0]!.sku).toBe('LOW-1');
  });

  it('can show only what is low, search, and page', async () => {
    const low = await stock({ lowOnly: true });
    expect(low.items.map((i) => i.sku)).toEqual(['LOW-1']);
    expect(low.total).toBe(1);
    const found = await stock({ search: 'bought' });
    expect(found.items.map((i) => i.sku)).toEqual(['BOUGHT-1']);
    const page = await stock({ limit: 1, offset: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBeGreaterThanOrEqual(4);
    // Search text is data, not a pattern.
    expect((await stock({ search: '%' })).items).toHaveLength(0);
  });

  it('never shows another organisation its stock', async () => {
    const theirs = (await must(await q(other.owner, STOCK, { i: { limit: 100 } }))) as {
      stockReport: { total: number; items: { sku: string }[] };
    };
    expect(theirs.stockReport.total).toBe(0);
  });
});

describe('attendance summary', () => {
  it("counts each person's month the way payroll pays it", async () => {
    const d = (await must(
      await q(ops.agent, ATTENDANCE, { i: { month: '2026-10', limit: 100 } }),
    )) as {
      attendanceSummary: {
        month: string;
        label: string;
        items: {
          employeeId: string;
          branch: { code: string };
          presentDays: number;
          offDays: number;
          holidayDays: number;
          absentDays: number;
          paidHalfDays: number;
        }[];
      };
    };
    expect(d.attendanceSummary).toMatchObject({ month: '2026-10', label: 'October 2026' });
    const by = Object.fromEntries(d.attendanceSummary.items.map((i) => [i.employeeId, i]));
    // Four Sundays and a holiday are paid, plus five days worked.
    expect(by[ann.employeeId]).toMatchObject({
      presentDays: 5,
      offDays: 4,
      holidayDays: 1,
      absentDays: 21,
      paidHalfDays: 20,
    });
    expect(by[bob.employeeId]).toMatchObject({
      presentDays: 0,
      absentDays: 26,
      paidHalfDays: 10,
      branch: { code: 'BR2' },
    });
  });

  it('filters by branch and search, and checks the month', async () => {
    const br2 = (await must(
      await q(ops.agent, ATTENDANCE, {
        i: { month: '2026-10', branchId: company.br2, limit: 100 },
      }),
    )) as { attendanceSummary: { items: { employeeId: string; branch: { code: string } }[] } };
    expect(br2.attendanceSummary.items.every((i) => i.branch.code === 'BR2')).toBe(true);
    expect(br2.attendanceSummary.items.map((i) => i.employeeId)).toContain(bob.employeeId);
    const found = (await must(
      await q(ops.agent, ATTENDANCE, { i: { month: '2026-10', search: 'Ann Emp' } }),
    )) as { attendanceSummary: { total: number } };
    expect(found.attendanceSummary.total).toBe(1);
    for (const month of ['2026-13', 'October', '2026-1']) {
      expect(code(await q(ops.agent, ATTENDANCE, { i: { month } })), month).toMatch(
        /VALIDATION_ERROR|BAD_REQUEST/,
      );
    }
  });

  it('defaults to the current month', async () => {
    const d = (await must(await q(ops.agent, ATTENDANCE))) as {
      attendanceSummary: { month: string };
    };
    expect(d.attendanceSummary.month).toBe(today.slice(0, 7));
  });
});

describe('payroll summary', () => {
  beforeAll(async () => {
    // The preparer cannot approve, so the owner does.
    await must(await q(owner(), APPROVE_RUN, { id: octRun.id, i: { version: octRun.version } }));
  });

  it('adds up the runs that were not cancelled, by month and branch', async () => {
    const d = (await must(
      await q(finance.agent, PAYROLL, { i: { fromMonth: '2026-09', toMonth: '2026-10' } }),
    )) as {
      payrollSummary: {
        gross: string;
        deductions: string;
        net: string;
        runs: {
          label: string;
          status: string;
          employeeCount: number;
          gross: string;
          net: string;
        }[];
        byBranch: {
          code: string;
          employees: number;
          gross: string;
          deductions: string;
          net: string;
        }[];
      };
    };
    const p = d.payrollSummary;
    // September was cancelled, so only October is counted.
    expect(p.runs).toEqual([
      {
        label: 'October 2026',
        status: 'approved',
        employeeCount: 2,
        gross: '15322.58',
        net: '12403.23',
      },
    ]);
    expect(p).toMatchObject({ gross: '15322.58', deductions: '2919.35', net: '12403.23' });
    expect(p.byBranch).toEqual([
      { code: 'BR2', employees: 1, gross: '2419.35', deductions: '2419.35', net: '0.00' },
      { code: 'HO', employees: 1, gross: '12903.23', deductions: '500.00', net: '12403.23' },
    ]);
  });

  it('is empty for a period with no payroll, and checks the months', async () => {
    const d = (await must(
      await q(finance.agent, PAYROLL, { i: { fromMonth: '2020-01', toMonth: '2020-03' } }),
    )) as { payrollSummary: { runs: unknown[]; gross: string; byBranch: unknown[] } };
    expect(d.payrollSummary).toMatchObject({ runs: [], gross: '0.00', byBranch: [] });
    expect(
      code(await q(finance.agent, PAYROLL, { i: { fromMonth: '2026-10', toMonth: '2026-01' } })),
    ).toMatch(/VALIDATION_ERROR|BAD_REQUEST/);
    expect(code(await q(finance.agent, PAYROLL, { i: { fromMonth: 'x' } }))).toMatch(
      /VALIDATION_ERROR|BAD_REQUEST/,
    );
  });
});

describe('reports: tenant isolation', () => {
  it('shows another organisation nothing of this one', async () => {
    const pnl = (await must(
      await q(other.owner, PNL, { i: { from: '2019-01-01', to: today } }),
    )) as {
      profitAndLoss: { totalIncome: string; totalExpenses: string };
    };
    expect(pnl.profitAndLoss).toMatchObject({ totalIncome: '0.00', totalExpenses: '0.00' });
    const s = (await must(await q(other.owner, SUMMARY, { i: { kind: 'sales' } }))) as {
      invoiceSummary: { count: number };
    };
    expect(s.invoiceSummary.count).toBe(0);
    const pay = (await must(
      await q(other.owner, PAYROLL, { i: { fromMonth: '2026-01', toMonth: '2026-12' } }),
    )) as { payrollSummary: { runs: unknown[] } };
    expect(pay.payrollSummary.runs).toEqual([]);
  });
});
