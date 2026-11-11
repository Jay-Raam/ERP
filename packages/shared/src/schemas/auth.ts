import { z } from 'zod';

/** Organisation slug: what the user types in the "organisation" box at login. */
export const orgSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Organisation ID is required')
  .min(2, 'Organisation ID must be at least 2 characters')
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letters, numbers and hyphens only');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Enter a valid email'));

export const loginInputSchema = z.strictObject({
  email: emailSchema,
  // Not trimmed: spaces can be part of a password. Upper bound stops hashing-cost abuse.
  password: z.string().min(1, 'Password is required').max(128),
});

export type LoginInput = z.infer<typeof loginInputSchema>;
