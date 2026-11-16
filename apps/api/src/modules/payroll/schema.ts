import type { GraphQLContext } from '../../graphql/context';
import { monthLabel } from './payroll.logic';
import type { PayrollService } from './payroll.service';

export const payrollTypeDefs = /* GraphQL */ `
  enum PayrollStatus {
    draft
    approved
    paid
    cancelled
  }

  type SalaryBranch {
    id: ID!
    code: String!
    name: String!
  }

  "One employee's monthly pay. The amounts are null until a structure is set."
  type SalaryStructure {
    employeeId: ID!
    employeeCode: String!
    employeeName: String!
    designation: String
    joiningDate: String!
    branch: SalaryBranch!
    basic: String
    hra: String
    allowance: String
    deductions: String
    version: Int
  }

  type SalaryStructurePage {
    total: Int!
    items: [SalaryStructure!]!
  }

  input ListSalaryStructuresInput {
    search: String
    branchId: ID
    missingOnly: Boolean
    limit: Int
    offset: Int
  }

  input SaveSalaryStructureInput {
    employeeId: ID!
    basic: String!
    hra: String
    allowance: String
    deductions: String
    "Empty when setting the salary for the first time."
    version: Int
  }

  type PayrollRun {
    id: ID!
    periodStart: String!
    periodEnd: String!
    label: String!
    status: PayrollStatus!
    notes: String
    employeeCount: Int!
    grossTotal: String!
    deductionsTotal: String!
    netTotal: String!
    version: Int!
    createdAt: String!
    preparedByName: String!
    approvedByName: String
    approvedAt: String
    paidByName: String
    paidAt: String
    paidOn: String
    payMethod: String
    payReference: String
    cancelledAt: String
    cancelReason: String
    approveEntryId: ID
    payEntryId: ID
    cancelEntryId: ID
    "Payslips with attendance that was never closed. Only filled in on a single run."
    incompleteCount: Int
    "Payslips where the deductions were more than the pay available."
    cappedCount: Int
  }

  type PayrollRunPage {
    total: Int!
    items: [PayrollRun!]!
  }

  type SkippedEmployee {
    employeeId: ID!
    employeeCode: String!
    employeeName: String!
    reason: String!
  }

  type PreparedPayroll {
    run: PayrollRun!
    skipped: [SkippedEmployee!]!
  }

  type Payslip {
    id: ID!
    runId: ID!
    employeeId: ID!
    employeeCode: String!
    employeeName: String!
    designation: String
    basic: String!
    hra: String!
    allowance: String!
    daysInPeriod: Int!
    "Counted in half days, so 0.5 shows as 1."
    paidHalfDays: Int!
    presentDays: Int!
    halfDays: Int!
    leaveDays: Int!
    offDays: Int!
    holidayDays: Int!
    absentDays: Int!
    shortDays: Int!
    incompleteDays: Int!
    fullGross: String!
    earned: String!
    bonus: String!
    plannedDeductions: String!
    deductions: String!
    otherDeductions: String!
    deductionsCapped: Boolean!
    adjustmentNote: String
    netPay: String!
  }

  type PayslipPage {
    total: Int!
    items: [Payslip!]!
  }

  type MyPayslip {
    id: ID!
    periodStart: String!
    periodEnd: String!
    runStatus: PayrollStatus!
    paidOn: String
    employeeCode: String!
    employeeName: String!
    designation: String
    basic: String!
    hra: String!
    allowance: String!
    daysInPeriod: Int!
    paidHalfDays: Int!
    presentDays: Int!
    halfDays: Int!
    leaveDays: Int!
    offDays: Int!
    holidayDays: Int!
    absentDays: Int!
    fullGross: String!
    earned: String!
    bonus: String!
    deductions: String!
    otherDeductions: String!
    adjustmentNote: String
    netPay: String!
  }

  type MyPayslipPage {
    total: Int!
    items: [MyPayslip!]!
  }

  input ListPayrollRunsInput {
    status: PayrollStatus
    limit: Int
    offset: Int
  }

  input ListPayslipsInput {
    runId: ID!
    search: String
    limit: Int
    offset: Int
  }

  input MyPayslipsInput {
    limit: Int
    offset: Int
  }

  input CreatePayrollRunInput {
    "The month to pay, like 2026-10."
    month: String!
    notes: String
  }

  input PayrollVersionInput {
    version: Int!
  }

  input AdjustPayslipInput {
    version: Int!
    bonus: String
    otherDeductions: String
    note: String
  }

  input PayPayrollRunInput {
    version: Int!
    method: PaymentMethod!
    paidOn: String!
    reference: String
  }

  input CancelPayrollRunInput {
    version: Int!
    reason: String!
  }

  extend type Query {
    salaryStructures(input: ListSalaryStructuresInput): SalaryStructurePage!
    payrollRuns(input: ListPayrollRunsInput): PayrollRunPage!
    payrollRun(id: ID!): PayrollRun!
    payslips(input: ListPayslipsInput!): PayslipPage!
    myPayslips(input: MyPayslipsInput): MyPayslipPage!
  }

  extend type Mutation {
    saveSalaryStructure(input: SaveSalaryStructureInput!): SalaryStructure!
    createPayrollRun(input: CreatePayrollRunInput!): PreparedPayroll!
    recalculatePayrollRun(id: ID!, input: PayrollVersionInput!): PreparedPayroll!
    adjustPayslip(id: ID!, input: AdjustPayslipInput!): Payslip!
    approvePayrollRun(id: ID!, input: PayrollVersionInput!): PayrollRun!
    payPayrollRun(id: ID!, input: PayPayrollRunInput!): PayrollRun!
    cancelPayrollRun(id: ID!, input: CancelPayrollRunInput!): PayrollRun!
  }
`;

type Args<T> = { input: T };
type IdArgs<T> = { id: string; input: T };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type RunLike = {
  createdAt: Date;
  approvedAt: Date | null;
  paidAt: Date | null;
  cancelledAt: Date | null;
};
const runDates = <T extends RunLike>(r: T) => ({
  ...r,
  createdAt: r.createdAt.toISOString(),
  approvedAt: iso(r.approvedAt),
  paidAt: iso(r.paidAt),
  cancelledAt: iso(r.cancelledAt),
});

type Prepared = Awaited<ReturnType<PayrollService['createPayrollRun']>>;
const shapePrepared = (p: Prepared) => ({ ...p, run: runDates(p.run) });

export function payrollResolvers(payroll: PayrollService) {
  return {
    Query: {
      salaryStructures: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) =>
        payroll.listSalaryStructures(await ctx.viewer(), a.input),
      payrollRuns: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) => {
        const page = await payroll.listPayrollRuns(await ctx.viewer(), a.input);
        return {
          total: page.total,
          items: page.items.map((r) => ({
            ...runDates(r),
            label: monthLabel(r.periodStart),
            incompleteCount: null,
            cappedCount: null,
          })),
        };
      },
      payrollRun: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        runDates(await payroll.getPayrollRun(await ctx.viewer(), a.id)),
      payslips: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        payroll.listPayslips(await ctx.viewer(), a.input),
      myPayslips: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) =>
        payroll.myPayslips(await ctx.viewer(), a.input),
    },
    Mutation: {
      saveSalaryStructure: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        payroll.saveSalaryStructure(await ctx.viewer(), a.input),
      createPayrollRun: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        shapePrepared(await payroll.createPayrollRun(await ctx.viewer(), a.input)),
      recalculatePayrollRun: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapePrepared(await payroll.recalculatePayrollRun(await ctx.viewer(), a.id, a.input)),
      adjustPayslip: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        payroll.adjustPayslip(await ctx.viewer(), a.id, a.input),
      approvePayrollRun: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        runDates(await payroll.approvePayrollRun(await ctx.viewer(), a.id, a.input)),
      payPayrollRun: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        runDates(await payroll.payPayrollRun(await ctx.viewer(), a.id, a.input)),
      cancelPayrollRun: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        runDates(await payroll.cancelPayrollRun(await ctx.viewer(), a.id, a.input)),
    },
  };
}
