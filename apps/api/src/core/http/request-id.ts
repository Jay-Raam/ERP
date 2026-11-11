import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { runWithContext } from '../request-context';

export const REQUEST_ID_HEADER = 'x-request-id';

// An inbound ID is reused only if it is a harmless token; anything else is
// replaced so a caller cannot inject content into logs or responses.
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const inbound = req.get(REQUEST_ID_HEADER);
  const id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  runWithContext({ requestId: id }, next);
};
