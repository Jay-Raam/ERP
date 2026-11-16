'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayrollStatus } from '@erp/shared';
import { gqlRequest } from '@/lib/api-client';

export const PAGE_SIZE = 20;

export interface Structure {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  joiningDate: string;
  branch: { id: string; code: string; name: string };
  basic: string | null;
  hra: string | null;
  allowance: string | null;
  deductions: string | null;
  version: number | null;
}

export interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  label: string;
  status: PayrollStatus;
  notes: string | null;
  employeeCount: number;
  grossTotal: string;
  deductionsTotal: string;
  netTotal: string;
  version: number;
  createdAt: string;
  preparedByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  paidByName: string | null;
  paidAt: string | null;
  paidOn: string | null;
  payMethod: string | null;
  payReference: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  approveEntryId: string | null;
  payEntryId: string | null;
  cancelEntryId: string | null;
  incompleteCount: number | null;
  cappedCount: number | null;
}

export interface Payslip {
  id: string;
  runId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  basic: string;
  hra: string;
  allowance: string;
  daysInPeriod: number;
  paidHalfDays: number;
  presentDays: number;
  halfDays: number;
  leaveDays: number;
  offDays: number;
  holidayDays: number;
  absentDays: number;
  shortDays: number;
  incompleteDays: number;
  fullGross: string;
  earned: string;
  bonus: string;
  plannedDeductions: string;
  deductions: string;
  otherDeductions: string;
  deductionsCapped: boolean;
  adjustmentNote: string | null;
  netPay: string;
}

export interface MyPayslip {
  id: string;
  periodStart: string;
  periodEnd: string;
  runStatus: PayrollStatus;
  paidOn: string | null;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  basic: string;
  hra: string;
  allowance: string;
  daysInPeriod: number;
  paidHalfDays: number;
  presentDays: number;
  halfDays: number;
  leaveDays: number;
  offDays: number;
  holidayDays: number;
  absentDays: number;
  fullGross: string;
  earned: string;
  bonus: string;
  deductions: string;
  otherDeductions: string;
  adjustmentNote: string | null;
  netPay: string;
}

export interface Skipped {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  reason: string;
}

const STRUCTURE = `employeeId employeeCode employeeName designation joiningDate branch { id code name } basic hra allowance deductions version`;
const RUN = `id periodStart periodEnd label status notes employeeCount grossTotal deductionsTotal netTotal version createdAt preparedByName approvedByName approvedAt paidByName paidAt paidOn payMethod payReference cancelledAt cancelReason approveEntryId payEntryId cancelEntryId incompleteCount cappedCount`;
const SLIP = `id runId employeeId employeeCode employeeName designation basic hra allowance daysInPeriod paidHalfDays presentDays halfDays leaveDays offDays holidayDays absentDays shortDays incompleteDays fullGross earned bonus plannedDeductions deductions otherDeductions deductionsCapped adjustmentNote netPay`;
const MINE = `id periodStart periodEnd runStatus paidOn employeeCode employeeName designation basic hra allowance daysInPeriod paidHalfDays presentDays halfDays leaveDays offDays holidayDays absentDays fullGross earned bonus deductions otherDeductions adjustmentNote netPay`;

const keys = {
  structures: ['payroll', 'structures'] as const,
  runs: ['payroll', 'runs'] as const,
  run: ['payroll', 'run'] as const,
  payslips: ['payroll', 'payslips'] as const,
  mine: ['payroll', 'mine'] as const,
};

/** Approving and paying post to the books, so the accounts figures change with payroll. */
const EVERYTHING = [['payroll'], ['accounts']] as const;

function useAction<TVars, TResult>(run: (vars: TVars) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all(
        EVERYTHING.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })),
      );
    },
  });
}

// ---------------------------------------------------------------- structures

export interface StructureFilter {
  search: string;
  missingOnly: boolean;
  page: number;
}

export const useStructures = (filter: StructureFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.structures, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ salaryStructures: { items: Structure[]; total: number } }>(
          `query($input: ListSalaryStructuresInput){ salaryStructures(input:$input){ total items { ${STRUCTURE} } } }`,
          {
            input: {
              search: filter.search || null,
              missingOnly: filter.missingOnly,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).salaryStructures,
  });

export const useSaveStructure = () =>
  useAction((input: Record<string, unknown>) =>
    gqlRequest(
      `mutation($input: SaveSalaryStructureInput!){ saveSalaryStructure(input:$input){ employeeId } }`,
      { input },
    ),
  );

// ---------------------------------------------------------------------- runs

export const useRuns = (page: number, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.runs, page],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ payrollRuns: { items: PayrollRun[]; total: number } }>(
          `query($input: ListPayrollRunsInput){ payrollRuns(input:$input){ total items { ${RUN} } } }`,
          { input: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } },
        )
      ).payrollRuns,
  });

export const useRun = (id: string | null) =>
  useQuery({
    enabled: id !== null,
    queryKey: [...keys.run, id],
    queryFn: async () =>
      (
        await gqlRequest<{ payrollRun: PayrollRun }>(
          `query($id: ID!){ payrollRun(id:$id){ ${RUN} } }`,
          { id },
        )
      ).payrollRun,
  });

export const usePayslips = (runId: string | null, filter: { search: string; page: number }) =>
  useQuery({
    enabled: runId !== null,
    queryKey: [...keys.payslips, runId, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ payslips: { items: Payslip[]; total: number } }>(
          `query($input: ListPayslipsInput!){ payslips(input:$input){ total items { ${SLIP} } } }`,
          {
            input: {
              runId,
              search: filter.search || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).payslips,
  });

export const useCreateRun = () =>
  useAction(
    async (input: { month: string; notes: string | null }) =>
      (
        await gqlRequest<{ createPayrollRun: { run: PayrollRun; skipped: Skipped[] } }>(
          `mutation($input: CreatePayrollRunInput!){ createPayrollRun(input:$input){ run { ${RUN} } skipped { employeeId employeeCode employeeName reason } } }`,
          { input },
        )
      ).createPayrollRun,
  );

export const useRecalculateRun = () =>
  useAction(
    async (vars: { id: string; version: number }) =>
      (
        await gqlRequest<{ recalculatePayrollRun: { run: PayrollRun; skipped: Skipped[] } }>(
          `mutation($id: ID!, $input: PayrollVersionInput!){ recalculatePayrollRun(id:$id,input:$input){ run { ${RUN} } skipped { employeeId employeeCode employeeName reason } } }`,
          { id: vars.id, input: { version: vars.version } },
        )
      ).recalculatePayrollRun,
  );

export const useAdjustPayslip = () =>
  useAction((vars: { id: string; input: Record<string, unknown> }) =>
    gqlRequest(
      `mutation($id: ID!, $input: AdjustPayslipInput!){ adjustPayslip(id:$id,input:$input){ id } }`,
      vars,
    ),
  );

export const useApproveRun = () =>
  useAction((vars: { id: string; version: number }) =>
    gqlRequest(
      `mutation($id: ID!, $input: PayrollVersionInput!){ approvePayrollRun(id:$id,input:$input){ id } }`,
      { id: vars.id, input: { version: vars.version } },
    ),
  );

export const usePayRun = () =>
  useAction((vars: { id: string; input: Record<string, unknown> }) =>
    gqlRequest(
      `mutation($id: ID!, $input: PayPayrollRunInput!){ payPayrollRun(id:$id,input:$input){ id } }`,
      vars,
    ),
  );

export const useCancelRun = () =>
  useAction((vars: { id: string; version: number; reason: string }) =>
    gqlRequest(
      `mutation($id: ID!, $input: CancelPayrollRunInput!){ cancelPayrollRun(id:$id,input:$input){ id } }`,
      { id: vars.id, input: { version: vars.version, reason: vars.reason } },
    ),
  );

// ------------------------------------------------------------- own payslips

export const useMyPayslips = (page: number, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.mine, page],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ myPayslips: { items: MyPayslip[]; total: number } }>(
          `query($input: MyPayslipsInput){ myPayslips(input:$input){ total items { ${MINE} } } }`,
          { input: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } },
        )
      ).myPayslips,
  });
