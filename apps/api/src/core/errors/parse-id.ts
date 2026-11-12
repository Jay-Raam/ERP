import { idSchema } from '@erp/shared';
import { ValidationError } from './app-error';

/** Validates an id argument. A bad one is reported against the `id` field, not a nameless root. */
export function parseId(raw: unknown, field = 'id'): string {
  const result = idSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError({ [field]: result.error.issues.map((issue) => issue.message) });
  }
  return result.data;
}
