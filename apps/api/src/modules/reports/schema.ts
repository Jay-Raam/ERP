import type { GraphQLContext } from '../../graphql/context';
import type { ReportsService } from './reports.service';

export const reportsTypeDefs = /* GraphQL */ `
  enum ReportKind {
    sales
    purchase
  }

  type ReportAccountLine {
    code: String!
    name: String!
    amount: String!
  }

  input ReportRangeInput {
    "Defaults to the start of the financial year (1 April)."
    from: String
    "Defaults to today."
    to: String
  }

  type ProfitAndLoss {
    from: String!
    to: String!
    income: [ReportAccountLine!]!
    expenses: [ReportAccountLine!]!
    totalIncome: String!
    totalExpenses: String!
    netProfit: String!
  }

  input BalanceSheetInput {
    asOf: String
  }

  type BalanceSheet {
    asOf: String!
    assets: [ReportAccountLine!]!
    liabilities: [ReportAccountLine!]!
    equity: [ReportAccountLine!]!
    "Profit not yet moved into equity, so the sheet balances without a year-end close."
    earnings: String!
    totalAssets: String!
    totalLiabilities: String!
    totalEquity: String!
    balanced: Boolean!
  }

  input InvoiceSummaryInput {
    kind: ReportKind!
    from: String
    to: String
    branchId: ID
  }

  type SummaryMonth {
    month: String!
    count: Int!
    subtotal: String!
    taxTotal: String!
    grandTotal: String!
  }

  type SummaryParty {
    id: ID!
    name: String!
    count: Int!
    grandTotal: String!
  }

  type SummaryItem {
    id: ID!
    sku: String!
    name: String!
    unit: String!
    quantity: String!
    subtotal: String!
  }

  type InvoiceSummary {
    kind: ReportKind!
    from: String!
    to: String!
    count: Int!
    subtotal: String!
    taxTotal: String!
    grandTotal: String!
    paid: String!
    outstanding: String!
    byMonth: [SummaryMonth!]!
    "The ten biggest, by total."
    byParty: [SummaryParty!]!
    byItem: [SummaryItem!]!
  }

  input StockReportInput {
    search: String
    lowOnly: Boolean
    limit: Int
    offset: Int
  }

  type StockReportRow {
    id: ID!
    sku: String!
    name: String!
    unit: String!
    quantity: String!
    reorderLevel: String!
    "Weighted average of what was paid on purchase orders. Null when the item was never bought."
    averageCost: String
    value: String
    low: Boolean!
  }

  type StockReport {
    asOf: String!
    total: Int!
    totalValue: String!
    lowCount: Int!
    "Items in stock that were never bought, so they have no value here."
    unpriced: Int!
    items: [StockReportRow!]!
  }

  input AttendanceSummaryInput {
    month: String
    branchId: ID
    search: String
    limit: Int
    offset: Int
  }

  type AttendanceSummaryBranch {
    id: ID!
    code: String!
    name: String!
  }

  type AttendanceSummaryRow {
    employeeId: ID!
    employeeCode: String!
    employeeName: String!
    branch: AttendanceSummaryBranch!
    presentDays: Int!
    halfDays: Int!
    leaveDays: Int!
    offDays: Int!
    holidayDays: Int!
    absentDays: Int!
    shortDays: Int!
    incompleteDays: Int!
    "Paid days counted in halves."
    paidHalfDays: Int!
  }

  type AttendanceSummary {
    month: String!
    label: String!
    total: Int!
    items: [AttendanceSummaryRow!]!
  }

  input PayrollSummaryInput {
    fromMonth: String
    toMonth: String
  }

  type PayrollSummaryRun {
    id: ID!
    periodStart: String!
    label: String!
    status: PayrollStatus!
    employeeCount: Int!
    gross: String!
    deductions: String!
    net: String!
  }

  type PayrollSummaryBranch {
    id: ID!
    code: String!
    name: String!
    employees: Int!
    gross: String!
    deductions: String!
    net: String!
  }

  type PayrollSummary {
    fromMonth: String!
    toMonth: String!
    gross: String!
    deductions: String!
    net: String!
    runs: [PayrollSummaryRun!]!
    byBranch: [PayrollSummaryBranch!]!
  }

  extend type Query {
    profitAndLoss(input: ReportRangeInput): ProfitAndLoss!
    balanceSheet(input: BalanceSheetInput): BalanceSheet!
    invoiceSummary(input: InvoiceSummaryInput!): InvoiceSummary!
    stockReport(input: StockReportInput): StockReport!
    attendanceSummary(input: AttendanceSummaryInput): AttendanceSummary!
    payrollSummary(input: PayrollSummaryInput): PayrollSummary!
  }
`;

type Args<T> = { input?: T };

export function reportsResolvers(reports: ReportsService) {
  return {
    Query: {
      profitAndLoss: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        reports.profitAndLoss(await ctx.viewer(), a.input),
      balanceSheet: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        reports.balanceSheet(await ctx.viewer(), a.input),
      invoiceSummary: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        reports.invoiceSummary(await ctx.viewer(), a.input),
      stockReport: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        reports.stockReport(await ctx.viewer(), a.input),
      attendanceSummary: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        reports.attendanceSummary(await ctx.viewer(), a.input),
      payrollSummary: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        reports.payrollSummary(await ctx.viewer(), a.input),
    },
  };
}
