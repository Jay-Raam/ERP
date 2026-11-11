import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { toast } from 'sonner';
import { resolveApiError } from './api-error';

interface Options<T extends FieldValues> {
  /** Field errors from the server are shown on these inputs. */
  setError?: UseFormSetError<T>;
  fields?: readonly Path<T>[];
  /** Called when the session has ended and the user must sign in again. */
  onLogin?: () => void;
}

/**
 * The one place screens send a failed API call. Decides between inline field
 * errors, a toast, or a trip to sign-in, and returns a message for callers
 * that render their own inline alert.
 */
export function handleApiError<T extends FieldValues>(
  error: unknown,
  options: Options<T> = {},
): string {
  const action = resolveApiError(error);

  if (action.kind === 'fields' && options.setError) {
    const known = new Set<string>(options.fields ?? []);
    let shown = false;
    for (const [field, messages] of Object.entries(action.fieldErrors)) {
      if (known.size > 0 && !known.has(field)) continue;
      options.setError(
        field as Path<T>,
        { type: 'server', message: messages[0] },
        { shouldFocus: !shown },
      );
      shown = true;
    }
    if (shown) return action.message;
  }

  if (action.kind === 'login' && options.onLogin) {
    options.onLogin();
    return action.message;
  }

  toast.error(action.message, {
    description: action.requestId ? `Reference: ${action.requestId}` : undefined,
  });
  return action.message;
}
