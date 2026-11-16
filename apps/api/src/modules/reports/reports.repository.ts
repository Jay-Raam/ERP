import { sql, type SQL } from 'drizzle-orm';
import type { AccountType } from '@erp/shared';
import type { TenantTx } from '../../db/client';
import { likePattern } from '../hr/employees.repository';
import type { Scope } from '../hr/scope';

/** Money columns come back as text so they never pass through a float. */
const MONEY = (expr: SQL) => sql`coalesce(${expr}, 0)::numeric(18,2)::text`;

/** Which rows of a table with a branch and a creator a viewer may see. */
function scopeSql(scope: Scope, alias: string): SQL {
  const col = (name: string) => sql.raw(`${alias}.${name}`);
  switch (scope.kind) {
    case 'organisation':
      return sql`true`;
    case 'branch':
      return scope.branchIds.length > 0
        ? sql`${col('branch_id')} in (${sql.join(
            scope.branchIds.map((b) => sql`${b}`),
            sql`, `,
          )})`
        : sql`false`;
    case 'own':
      return sql`${col('created_by')} = ${scope.userId}`;
  }
}

// ------------------------------------------------------------------- ledger

export type MovementRow = {
  code: string;
  name: string;
  type: AccountType;
  debit: string;
  credit: string;
};

/** What each account of the given types moved between two dates (or up to one), from posted entries. */
export async function accountMovement(
  tx: TenantTx,
  f: { types: AccountType[]; from?: string; to: string },
): Promise<MovementRow[]> {
  const types = sql.join(
    f.types.map((t) => sql`${t}`),
    sql`, `,
  );
  const rows = await tx.execute<MovementRow>(sql`
    select a.code, a.name, a.type,
           ${MONEY(sql`sum(l.debit)`)} as debit,
           ${MONEY(sql`sum(l.credit)`)} as credit
    from accounts a
    join journal_lines l on l.account_id = a.id
    join journal_entries e on e.id = l.entry_id
    where a.type in (${types})
      and e.entry_date <= ${f.to}::date
      ${f.from ? sql`and e.entry_date >= ${f.from}::date` : sql``}
    group by a.id
    order by a.code`);
  return [...rows];
}

// ----------------------------------------------------------------- invoices

export type InvoiceFilter = {
  kind: 'sales' | 'purchase';
  from: string;
  to: string;
  branchId?: string;
  scope: Scope;
};

const invoiceWhere = (f: InvoiceFilter): SQL => sql`
  i.kind = ${f.kind} and i.status = 'posted'
  and i.invoice_date >= ${f.from}::date and i.invoice_date <= ${f.to}::date
  ${f.branchId ? sql`and i.branch_id = ${f.branchId}` : sql``}
  and ${scopeSql(f.scope, 'i')}`;

export type InvoiceTotals = {
  count: number;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  paid: string;
};

export async function invoiceTotals(tx: TenantTx, f: InvoiceFilter): Promise<InvoiceTotals> {
  const rows = await tx.execute<InvoiceTotals>(sql`
    select count(*)::int as count,
           ${MONEY(sql`sum(i.subtotal)`)} as "subtotal",
           ${MONEY(sql`sum(i.tax_total)`)} as "taxTotal",
           ${MONEY(sql`sum(i.grand_total)`)} as "grandTotal",
           ${MONEY(sql`sum(i.paid_amount)`)} as "paid"
    from invoices i where ${invoiceWhere(f)}`);
  return [...rows][0]!;
}

export type MonthRow = {
  month: string;
  count: number;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
};

export async function invoicesByMonth(tx: TenantTx, f: InvoiceFilter): Promise<MonthRow[]> {
  const rows = await tx.execute<MonthRow>(sql`
    select to_char(i.invoice_date, 'YYYY-MM') as month, count(*)::int as count,
           ${MONEY(sql`sum(i.subtotal)`)} as "subtotal",
           ${MONEY(sql`sum(i.tax_total)`)} as "taxTotal",
           ${MONEY(sql`sum(i.grand_total)`)} as "grandTotal"
    from invoices i where ${invoiceWhere(f)}
    group by 1 order by 1`);
  return [...rows];
}

export type PartyRow = { id: string; name: string; count: number; grandTotal: string };

export async function invoicesByParty(tx: TenantTx, f: InvoiceFilter): Promise<PartyRow[]> {
  const rows = await tx.execute<PartyRow>(sql`
    select p.id, p.name, count(*)::int as count,
           ${MONEY(sql`sum(i.grand_total)`)} as "grandTotal"
    from invoices i
    join ${f.kind === 'sales' ? sql`customers` : sql`suppliers`} p
      on p.id = ${f.kind === 'sales' ? sql`i.customer_id` : sql`i.supplier_id`}
    where ${invoiceWhere(f)}
    group by p.id, p.name
    order by sum(i.grand_total) desc, p.name
    limit 10`);
  return [...rows];
}

export type ItemSalesRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  subtotal: string;
};

export async function invoicesByItem(tx: TenantTx, f: InvoiceFilter): Promise<ItemSalesRow[]> {
  const rows = await tx.execute<ItemSalesRow>(sql`
    select it.id, it.sku, it.name, it.unit,
           sum(l.quantity)::text as quantity,
           ${MONEY(sql`sum(l.subtotal)`)} as "subtotal"
    from invoices i
    join invoice_lines l on l.invoice_id = i.id
    join items it on it.id = l.item_id
    where ${invoiceWhere(f)}
    group by it.id
    order by sum(l.subtotal) desc, it.sku
    limit 10`);
  return [...rows];
}

// -------------------------------------------------------------------- stock

/**
 * One row per active item with its stock across all warehouses, and the weighted average of
 * what was paid for it on purchase orders. Items never bought have no cost.
 */
const stockBase = sql`
  select i.id, i.sku, i.name, i.unit,
         coalesce(o.qty, 0) as qty,
         i.reorder_level as reorder,
         c.avg_cost,
         round(coalesce(o.qty, 0) * c.avg_cost, 2) as value,
         (i.reorder_level > 0 and coalesce(o.qty, 0) <= i.reorder_level) as low
  from items i
  left join (select item_id, sum(quantity) as qty from stock_balances group by item_id) o
    on o.item_id = i.id
  left join (
    select item_id, sum(received_quantity * unit_price) / nullif(sum(received_quantity), 0) as avg_cost
    from purchase_order_lines where received_quantity > 0 group by item_id
  ) c on c.item_id = i.id
  where i.status = 'active'`;

const stockWhere = (f: { search?: string; lowOnly: boolean }): SQL => sql`
  where (s.qty > 0 or s.low)
  ${f.lowOnly ? sql`and s.low` : sql``}
  ${
    f.search
      ? sql`and (s.name ilike ${likePattern(f.search)} or s.sku ilike ${likePattern(f.search)})`
      : sql``
  }`;

export type StockRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  reorderLevel: string;
  averageCost: string | null;
  value: string | null;
  low: boolean;
};

export async function stockRows(
  tx: TenantTx,
  f: { search?: string; lowOnly: boolean; limit: number; offset: number },
): Promise<StockRow[]> {
  const rows = await tx.execute<StockRow>(sql`
    select s.id, s.sku, s.name, s.unit, s.qty::text as quantity, s.reorder::text as "reorderLevel",
           s.avg_cost::numeric(18,2)::text as "averageCost", s.value::numeric(18,2)::text as value, s.low
    from (${stockBase}) s ${stockWhere(f)}
    order by s.low desc, s.sku
    limit ${f.limit} offset ${f.offset}`);
  return [...rows];
}

export type StockTotals = { total: number; value: string; lowCount: number; unpriced: number };

export async function stockTotals(
  tx: TenantTx,
  f: { search?: string; lowOnly: boolean },
): Promise<StockTotals> {
  const rows = await tx.execute<StockTotals>(sql`
    select count(*)::int as total,
           ${MONEY(sql`sum(s.value)`)} as value,
           (count(*) filter (where s.low))::int as "lowCount",
           (count(*) filter (where s.qty > 0 and s.avg_cost is null))::int as unpriced
    from (${stockBase}) s ${stockWhere(f)}`);
  return [...rows][0]!;
}

// ------------------------------------------------------------------ payroll

export type PayrollMonthRow = {
  id: string;
  periodStart: string;
  status: 'draft' | 'approved' | 'paid';
  employeeCount: number;
  gross: string;
  deductions: string;
  net: string;
};

/** Runs that are not cancelled, whose month starts within [from, to] (both first-of-month dates). */
export async function payrollRunsBetween(
  tx: TenantTx,
  from: string,
  to: string,
): Promise<PayrollMonthRow[]> {
  const rows = await tx.execute<PayrollMonthRow>(sql`
    select id, period_start::text as "periodStart", status, employee_count as "employeeCount",
           ${MONEY(sql`gross_total`)} as gross,
           ${MONEY(sql`deductions_total`)} as deductions,
           ${MONEY(sql`net_total`)} as net
    from payroll_runs
    where status <> 'cancelled' and period_start >= ${from}::date and period_start <= ${to}::date
    order by period_start`);
  return [...rows];
}

export type PayrollBranchRow = {
  id: string;
  code: string;
  name: string;
  employees: number;
  gross: string;
  deductions: string;
  net: string;
};

export async function payrollByBranch(
  tx: TenantTx,
  from: string,
  to: string,
): Promise<PayrollBranchRow[]> {
  const rows = await tx.execute<PayrollBranchRow>(sql`
    select b.id, b.code, b.name,
           count(distinct s.employee_id)::int as employees,
           ${MONEY(sql`sum(s.earned + s.bonus)`)} as gross,
           ${MONEY(sql`sum(s.deductions + s.other_deductions)`)} as deductions,
           ${MONEY(sql`sum(s.net_pay)`)} as net
    from payslips s
    join payroll_runs r on r.id = s.run_id
    join branches b on b.id = s.branch_id
    where r.status <> 'cancelled' and r.period_start >= ${from}::date and r.period_start <= ${to}::date
    group by b.id
    order by b.code`);
  return [...rows];
}
