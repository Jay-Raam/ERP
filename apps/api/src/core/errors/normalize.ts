import { ErrorCode, type ApiErrorBody, type FieldErrors } from '@erp/shared';
import { ZodError } from 'zod';
import { getRequestId } from '../request-context';
import { AppError } from './app-error';

export interface NormalizedError {
  status: number;
  body: ApiErrorBody;
  /** False for unknown errors: these are bugs and must be logged in full. */
  expected: boolean;
}

export function zodToFieldErrors(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_root';
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * The single place that decides what a failure looks like to the client.
 * Anything that is not an AppError or ZodError becomes INTERNAL_ERROR with a
 * generic message, so stack traces and driver messages never leave the server.
 */
export function normalizeError(error: unknown): NormalizedError {
  const requestId = getRequestId();

  if (error instanceof AppError) {
    return {
      status: error.status,
      expected: true,
      body: {
        code: error.code,
        message: error.message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        requestId,
      },
    };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      expected: true,
      body: {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Some fields are invalid',
        fieldErrors: zodToFieldErrors(error),
        requestId,
      },
    };
  }

  return {
    status: 500,
    expected: false,
    body: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Something went wrong. Please try again.',
      requestId,
    },
  };
}
