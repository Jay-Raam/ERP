import { ensureHrDefaults } from '../hr/defaults.repository';
import { randomUUID } from 'node:crypto';
import { DEFAULT_ROLES, OWNER_ROLE_KEY, registerOrganisationInputSchema } from '@erp/shared';
import { ConflictError } from '../../core/errors';
import type { Logger } from '../../core/logger';
import { hashPassword } from '../../core/password';
import { enforceLimit, type Limits, type RateLimiter } from '../../core/rate-limit';
import type { Database } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import * as repo from './repository';

export interface RegisteredOrganisation {
  organisation: { id: string; slug: string; name: string };
  owner: { id: string; email: string; fullName: string };
}

interface OrgServiceDeps {
  db: Database;
  logger: Logger;
  limiter: RateLimiter;
  limits: Limits;
}

export function createOrgService({ db, logger, limiter, limits }: OrgServiceDeps) {
  return {
    /**
     * Creates an organisation with its seed roles, a head-office branch and
     * its first user, who becomes Owner. All of it commits together or not at all.
     */
    async register(rawInput: unknown, meta: { ip: string }): Promise<RegisteredOrganisation> {
      // Throws ZodError, which the central handler turns into VALIDATION_ERROR.
      const input = registerOrganisationInputSchema.parse(rawInput);

      // Counted only for well-formed requests, before the expensive hash.
      await enforceLimit(
        limiter,
        `register:ip:${meta.ip}`,
        limits.registerPerIp,
        'Too many organisations created from this network.',
      );

      // Hash before opening the transaction: it is slow on purpose and must
      // not hold a database connection while it runs.
      const passwordHash = await hashPassword(input.password);
      const tenantId = randomUUID();

      try {
        const result = await withTenant(db, tenantId, async (tx) => {
          const organisation = await repo.insertOrganisation(tx, {
            id: tenantId,
            slug: input.organisation,
            name: input.organisationName,
          });
          const roleIds = await repo.insertRoles(tx, tenantId, DEFAULT_ROLES);
          const branch = await repo.insertBranch(tx, {
            tenantId,
            code: 'HO',
            name: 'Head Office',
            isHeadOffice: true,
          });
          const owner = await repo.insertUser(tx, {
            tenantId,
            email: input.email,
            passwordHash,
            fullName: input.ownerName,
            roleId: roleIds.get(OWNER_ROLE_KEY)!,
          });
          await repo.assignBranch(tx, { tenantId, userId: owner.id, branchId: branch.id });
          await ensureHrDefaults(tx, tenantId);
          return { organisation, owner };
        });

        logger.info({ tenantId, slug: result.organisation.slug }, 'organisation registered');
        return result;
      } catch (error) {
        if (isUniqueViolation(error, 'organisations_slug_unique')) {
          throw new ConflictError('This organisation ID is already taken', {
            fieldErrors: { organisation: ['This organisation ID is already taken'] },
          });
        }
        if (isUniqueViolation(error, 'users_email_unique')) {
          throw new ConflictError('This email is already registered', {
            fieldErrors: { email: ['This email is already registered'] },
          });
        }
        throw error;
      }
    },
  };
}

export type OrgService = ReturnType<typeof createOrgService>;
