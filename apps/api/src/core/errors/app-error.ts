import { ErrorCode, type FieldErrors } from '@erp/shared';

interface AppErrorOptions {
  fieldErrors?: FieldErrors;
  cause?: unknown;
}

/**
 * Base class for every error the API raises on purpose.
 * The message of an AppError is safe to show to the user.
 */
export class AppError extends Error {
  readonly fieldErrors?: FieldErrors;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    options: AppErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.fieldErrors = options.fieldErrors;
  }
}

export class ValidationError extends AppError {
  constructor(fieldErrors: FieldErrors, message = 'Some fields are invalid') {
    super(ErrorCode.VALIDATION_ERROR, message, 400, { fieldErrors });
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(ErrorCode.BAD_REQUEST, message, 400);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Please sign in to continue') {
    super(ErrorCode.UNAUTHENTICATED, message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do this') {
    super(ErrorCode.FORBIDDEN, message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(ErrorCode.NOT_FOUND, message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(ErrorCode.CONFLICT, message, 409);
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(ErrorCode.BUSINESS_RULE, message, 422, options);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = 'Too many requests. Please try again shortly.') {
    super(ErrorCode.RATE_LIMITED, message, 429);
  }
}
