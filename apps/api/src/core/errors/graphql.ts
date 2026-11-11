import { ErrorCode } from '@erp/shared';
import { GraphQLError, type ExecutionResult } from 'graphql';
import type { Plugin } from 'graphql-yoga';
import type { Logger } from '../logger';
import { getRequestId } from '../request-context';
import { normalizeError } from './normalize';

// Duck-typed on purpose: `instanceof GraphQLError` breaks when a bundler or
// test runner loads a second copy of the graphql package.
function isGraphQLError(error: unknown): error is GraphQLError {
  return error instanceof Error && error.name === 'GraphQLError' && 'extensions' in error;
}

// Build replacements with the class of the error being replaced, so Yoga's own
// `instanceof` checks (which decide the HTTP status) still recognise them.
function sameClass(error: GraphQLError): typeof GraphQLError {
  return error.constructor as typeof GraphQLError;
}

/**
 * Yoga calls this for every error thrown inside a resolver.
 * The result has the same code / message / fieldErrors / requestId as REST errors.
 */
export function createMaskError(logger: Logger) {
  return (error: unknown): GraphQLError => {
    const wrapped = isGraphQLError(error) ? error : undefined;
    const original = wrapped?.originalError ?? error;
    const { body, expected } = normalizeError(original);

    if (expected) {
      logger.info({ code: body.code, path: wrapped?.path }, 'operation rejected');
    } else {
      logger.error({ err: original, path: wrapped?.path }, 'unhandled resolver error');
    }

    const ErrorClass = wrapped ? sameClass(wrapped) : GraphQLError;
    return new ErrorClass(body.message, {
      nodes: wrapped?.nodes,
      path: wrapped?.path,
      extensions: {
        code: body.code,
        ...(body.fieldErrors ? { fieldErrors: body.fieldErrors } : {}),
        requestId: body.requestId,
      },
    });
  };
}

/**
 * Errors GraphQL raises itself (syntax, unknown field, wrong variable type)
 * never reach maskError. This gives them the same code and request ID.
 * GraphQLError extensions are read-only, so errors are copied, not mutated.
 */
export function useUniformErrors(): Plugin {
  const withCode = (error: GraphQLError): GraphQLError => {
    if (error.extensions?.code && error.extensions?.requestId) return error;
    return new (sameClass(error))(error.message, {
      nodes: error.nodes,
      source: error.source,
      positions: error.positions,
      path: error.path,
      originalError: error.originalError,
      extensions: {
        ...error.extensions,
        code: error.extensions?.code ?? ErrorCode.BAD_REQUEST,
        requestId: error.extensions?.requestId ?? getRequestId(),
      },
    });
  };

  const patch = (item: ExecutionResult): ExecutionResult =>
    item.errors ? { ...item, errors: item.errors.map(withCode) } : item;

  return {
    onResultProcess({ result, setResult }) {
      // Streams (subscriptions, @defer) are passed through untouched.
      if (Symbol.asyncIterator in result) return;
      setResult(Array.isArray(result) ? result.map(patch) : patch(result as ExecutionResult));
    },
  };
}
