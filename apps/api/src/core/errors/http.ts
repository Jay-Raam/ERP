import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from '../logger';
import { NotFoundError } from './app-error';
import { normalizeError } from './normalize';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route not found'));
};

/** The one Express error middleware. Must be registered last. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  // Express identifies error middleware by its four-argument signature.
  return (error, req, res, _next) => {
    const { status, body, expected } = normalizeError(error);

    if (expected) {
      logger.info({ code: body.code, path: req.path }, 'request rejected');
    } else {
      logger.error({ err: error, path: req.path }, 'unhandled error');
    }

    if (res.headersSent) {
      // Too late to change the response; drop the connection rather than send a mixed body.
      res.destroy();
      return;
    }
    res.status(status).json({ error: body });
  };
}
