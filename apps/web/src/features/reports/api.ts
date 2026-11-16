'use client';

import { useQuery } from '@tanstack/react-query';
import { gqlRequest } from '@/lib/api-client';

export const PAGE_SIZE = 20;

export interface AccountLine {
  code: string;
  name: string;
  amount: string;
}

export interface ProfitAndLoss {
  from: string;
  to: string;
  income: AccountLine[];
  expenses: AccountLine[];
  totalIncome: string;
  totalExpenses: string;
  netProfit: string;
}

export interface BalanceSheet {
  asOf: string;
  assets: AccountLine[];
  liabilities: AccountLine[];
  equity: AccountLine[];
  earnings: string;
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  balanced: boolean;
}

export interface InvoiceSummary {
  kind: 'sales' | 'purchase';
  from: string;
  to: string;
  count: number;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  paid: string;
  outstanding: string;
  byMonth: {
    month: string;
    count: number;
    subtotal: string;
    taxTotal: string;
    grandTotal: string;
  }[];
  byParty: { id: string; name: string; count: number; grandTotal: string }[];
  byItem: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    quantity: string;
    subtotal: string;
  }[];
}

export interface StockReport {
  asOf: string;
  total: number;
  totalValue: string;
  lowCount: number;
  unpriced: number;
  items: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    quantity: string;
    reorderLevel: string;
    averageCost: string | null;
    value: string | null;
    low: boolean;
  }[];
}

export interface AttendanceSummary {
  month: string;
  label: string;
  total: number;
  items: {
    employeeId: string;
    employeeCode: string;
    employeeName: string;
    branch: { id: string; code: string; name: string };
    presentDays: number;
    halfDays: number;
    leaveDays: number;
    offDays: number;
    holidayDays: number;
    absentDays: number;
    shortDays: number;
    incompleteDays: number;
    paidHalfDays: number;
  }[];
}

export interface PayrollSummary {
  fromMonth: string;
  toMonth: string;
  gross: string;
  deductions: string;
  net: string;
  runs: {
    id: string;
    periodStart: string;
    label: string;
    status: 'draft' | 'approved' | 'paid';
    employeeCount: number;
    gross: string;
    deductions: string;
    net: string;
  }[];
  byBranch: {
    id: string;
    code: string;
    name: string;
    employees: number;
    gross: string;
    deductions: string;
    net: string;
  }[];
}

const LINES = `code name amount`;

export const useProfitAndLoss = (range: { from: string; to: string }) =>
  useQuery({
    queryKey: ['reports', 'pnl', range],
    queryFn: async () =>
      (
        await gqlRequest<{ profitAndLoss: ProfitAndLoss }>(
          `query($input: ReportRangeInput){ profitAndLoss(input:$input){ from to totalIncome totalExpenses netProfit income { ${LINES} } expenses { ${LINES} } } }`,
          { input: { from: range.from || null, to: range.to || null } },
        )
      ).profitAndLoss,
  });

export const useBalanceSheet = (asOf: string) =>
  useQuery({
    queryKey: ['reports', 'balance-sheet', asOf],
    queryFn: async () =>
      (
        await gqlRequest<{ balanceSheet: BalanceSheet }>(
          `query($input: BalanceSheetInput){ balanceSheet(input:$input){ asOf earnings totalAssets totalLiabilities totalEquity balanced assets { ${LINES} } liabilities { ${LINES} } equity { ${LINES} } } }`,
          { input: { asOf: asOf || null } },
        )
      ).balanceSheet,
  });

export const useInvoiceSummary = (
  kind: 'sales' | 'purchase',
  range: { from: string; to: string },
) =>
  useQuery({
    queryKey: ['reports', 'invoice-summary', kind, range],
    queryFn: async () =>
      (
        await gqlRequest<{ invoiceSummary: InvoiceSummary }>(
          `query($input: InvoiceSummaryInput!){ invoiceSummary(input:$input){ kind from to count subtotal taxTotal grandTotal paid outstanding byMonth { month count subtotal taxTotal grandTotal } byParty { id name count grandTotal } byItem { id sku name unit quantity subtotal } } }`,
          { input: { kind, from: range.from || null, to: range.to || null } },
        )
      ).invoiceSummary,
  });

export interface StockFilter {
  search: string;
  lowOnly: boolean;
  page: number;
}

export const useStockReport = (filter: StockFilter) =>
  useQuery({
    queryKey: ['reports', 'stock', filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ stockReport: StockReport }>(
          `query($input: StockReportInput){ stockReport(input:$input){ asOf total totalValue lowCount unpriced items { id sku name unit quantity reorderLevel averageCost value low } } }`,
          {
            input: {
              search: filter.search || null,
              lowOnly: filter.lowOnly,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).stockReport,
  });

export interface AttendanceFilter {
  month: string;
  search: string;
  page: number;
}

export const useAttendanceSummary = (filter: AttendanceFilter) =>
  useQuery({
    queryKey: ['reports', 'attendance', filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ attendanceSummary: AttendanceSummary }>(
          `query($input: AttendanceSummaryInput){ attendanceSummary(input:$input){ month label total items { employeeId employeeCode employeeName branch { id code name } presentDays halfDays leaveDays offDays holidayDays absentDays shortDays incompleteDays paidHalfDays } } }`,
          {
            input: {
              month: filter.month || null,
              search: filter.search || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).attendanceSummary,
  });

export const usePayrollSummary = (range: { fromMonth: string; toMonth: string }) =>
  useQuery({
    queryKey: ['reports', 'payroll', range],
    queryFn: async () =>
      (
        await gqlRequest<{ payrollSummary: PayrollSummary }>(
          `query($input: PayrollSummaryInput){ payrollSummary(input:$input){ fromMonth toMonth gross deductions net runs { id periodStart label status employeeCount gross deductions net } byBranch { id code name employees gross deductions net } } }`,
          { input: { fromMonth: range.fromMonth || null, toMonth: range.toMonth || null } },
        )
      ).payrollSummary,
  });
