import {
  createEmployeeInputSchema,
  idSchema,
  listEmployeesInputSchema,
  updateEmployeeInputSchema,
  type Viewer,
} from '@erp/shared';
import { requirePermission } from '../../core/auth/guard';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors';
import type { Logger } from '../../core/logger';
import type { Database, TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import * as repo from './employees.repository';
import { assertBranchInScope, inScope, scopeOf } from './scope';

const STALE = 'Someone else changed this record. Reload it and try again.';

export function createEmployeesService({ db, logger }: { db: Database; logger: Logger }) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'hr action',
    );

  /** Branch must exist (RLS hides other tenants'), and be in the viewer's reach. */
  async function checkBranch(tx: TenantTx, viewer: Viewer, branchId: string) {
    const branch = await repo.findBranch(tx, branchId);
    if (!branch) {
      throw new ValidationError({ branchId: ['Choose a valid branch'] }, 'Choose a valid branch');
    }
    assertBranchInScope(viewer, branchId);
    return branch;
  }

  async function checkLinks(
    tx: TenantTx,
    values: { shiftId: string | null; userId: string | null },
    current?: { shiftId?: string | null; userId?: string | null },
  ) {
    if (values.shiftId && values.shiftId !== current?.shiftId) {
      const shift = await repo.findActiveShift(tx, values.shiftId);
      if (!shift || shift.status !== 'active') {
        throw new ValidationError(
          { shiftId: ['Choose an active shift'] },
          'Choose an active shift',
        );
      }
    }
    if (values.userId && values.userId !== current?.userId) {
      const user = await repo.findUserRef(tx, values.userId);
      if (!user || user.status !== 'active') {
        throw new ValidationError({ userId: ['Choose an active user'] }, 'Choose an active user');
      }
    }
  }

  function mapConflict(error: unknown): never {
    if (isUniqueViolation(error, 'employees_tenant_code_unique')) {
      throw new ConflictError('This employee code is already used', {
        fieldErrors: { employeeCode: ['This employee code is already used'] },
      });
    }
    if (isUniqueViolation(error, 'employees_tenant_email_unique')) {
      throw new ConflictError('Another employee already has this email', {
        fieldErrors: { email: ['Another employee already has this email'] },
      });
    }
    if (isUniqueViolation(error, 'employees_tenant_user_unique')) {
      throw new ConflictError('This user is already linked to another employee', {
        fieldErrors: { userId: ['This user is already linked to another employee'] },
      });
    }
    throw error;
  }

  return {
    async list(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'employee.employee.view');
      const input = listEmployeesInputSchema.parse(raw ?? {});
      return run(viewer, (tx) =>
        repo.listEmployees(tx, {
          ...input,
          scope: scopeOf(viewer),
        }),
      );
    },

    async get(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'employee.employee.view');
      const id = idSchema.parse(rawId);
      const row = await run(viewer, (tx) => repo.findEmployee(tx, id));
      // Outside the scope looks exactly like missing.
      if (!row || !inScope(viewer, row)) throw new NotFoundError('Employee not found');
      return row;
    },

    /** The viewer's own employee record, if they have one. */
    async mine(viewer: Viewer) {
      requirePermission(viewer, 'employee.profile.view-own');
      return run(viewer, (tx) => repo.findEmployeeByUser(tx, viewer.user.id));
    },

    async create(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'employee.employee.create');
      const input = createEmployeeInputSchema.parse(raw);
      try {
        const id = await run(viewer, async (tx, tenantId) => {
          const branch = await checkBranch(tx, viewer, input.branchId);
          if (branch.status !== 'active') {
            throw new ValidationError(
              { branchId: ['Choose an active branch'] },
              'Choose an active branch',
            );
          }
          await checkLinks(tx, input);
          return repo.insertEmployee(tx, { ...input, tenantId });
        });
        audit(viewer, 'employee.create', { employeeId: id });
        return (await run(viewer, (tx) => repo.findEmployee(tx, id)))!;
      } catch (error) {
        return mapConflict(error);
      }
    },

    async update(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'employee.employee.update');
      const id = idSchema.parse(rawId);
      const { version, status, ...values } = updateEmployeeInputSchema.parse(raw);
      try {
        await run(viewer, async (tx) => {
          const current = await repo.lockEmployee(tx, id);
          if (!current || !inScope(viewer, current)) throw new NotFoundError('Employee not found');
          if (current.version !== version) throw new ConflictError(STALE);
          if (values.branchId !== current.branchId) {
            const branch = await checkBranch(tx, viewer, values.branchId);
            if (branch.status !== 'active') {
              throw new ValidationError(
                { branchId: ['Choose an active branch'] },
                'Choose an active branch',
              );
            }
          }
          await checkLinks(tx, values, { shiftId: current.shiftId, userId: current.userId });
          const ok = await repo.updateEmployee(tx, id, version, { ...values, status });
          if (!ok) throw new ConflictError(STALE);
        });
        audit(viewer, 'employee.update', { employeeId: id, status });
        return (await run(viewer, (tx) => repo.findEmployee(tx, id)))!;
      } catch (error) {
        return mapConflict(error);
      }
    },
  };
}

export type EmployeesService = ReturnType<typeof createEmployeesService>;
