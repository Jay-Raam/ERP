import { z } from 'zod';
import { emailSchema, orgSlugSchema } from './auth';
import { plainText } from './text';

/** Slugs that would be confusing or dangerous as an organisation ID. */
export const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'auth',
  'graphql',
  'health',
  'login',
  'logout',
  'register',
  'root',
  'support',
  'system',
  'www',
  'null',
  'undefined',
]);

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  // Upper bound stops a huge password being used to burn CPU in the hash.
  .max(128, 'Password must be at most 128 characters');

export const registerOrganisationInputSchema = z.strictObject({
  organisationName: plainText('Organisation name', 2, 120),
  organisation: orgSlugSchema.refine((slug) => !RESERVED_ORG_SLUGS.has(slug), {
    message: 'This organisation ID is not available',
  }),
  ownerName: plainText('Your name', 2, 120),
  email: emailSchema,
  password: passwordSchema,
});

export type RegisterOrganisationInput = z.infer<typeof registerOrganisationInputSchema>;
