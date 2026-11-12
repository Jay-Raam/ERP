import { describe, expect, it } from 'vitest';
import { resolveApiError } from './api-error';

const gqlError = (extensions: Record<string, unknown>, message = 'msg') => ({
  response: { errors: [{ message, extensions }] },
});

describe('resolveApiError', () => {
  it('maps validation errors to fields', () => {
    const action = resolveApiError(
      gqlError({ code: 'VALIDATION_ERROR', fieldErrors: { email: ['Enter a valid email'] } }),
    );
    expect(action).toMatchObject({
      kind: 'fields',
      fieldErrors: { email: ['Enter a valid email'] },
    });
  });

  it('falls back to a toast when field errors are missing or malformed', () => {
    expect(resolveApiError(gqlError({ code: 'VALIDATION_ERROR' })).kind).toBe('toast');
    expect(
      resolveApiError(gqlError({ code: 'VALIDATION_ERROR', fieldErrors: { a: 'x' } })).kind,
    ).toBe('toast');
  });

  it('maps auth codes to login and forbidden', () => {
    expect(resolveApiError(gqlError({ code: 'UNAUTHENTICATED' })).kind).toBe('login');
    expect(resolveApiError(gqlError({ code: 'FORBIDDEN' })).kind).toBe('forbidden');
  });

  it('reads the REST error shape and keeps the request id', () => {
    const action = resolveApiError({
      error: { code: 'CONFLICT', message: 'Branch code already exists', requestId: 'req-12345' },
    });
    expect(action).toEqual({
      kind: 'toast',
      message: 'Branch code already exists',
      retryable: false,
      requestId: 'req-12345',
    });
  });

  it('puts a conflict that names fields next to those inputs', () => {
    const action = resolveApiError(
      gqlError({
        code: 'CONFLICT',
        message: 'This branch code is already used',
        fieldErrors: { code: ['This branch code is already used'] },
      }),
    );
    expect(action).toMatchObject({ kind: 'fields', fieldErrors: { code: [expect.any(String)] } });
  });

  it('puts a business rule that names fields next to those inputs, and toasts one that does not', () => {
    const named = resolveApiError(
      gqlError({
        code: 'BUSINESS_RULE',
        message: 'You already have leave requested for some of these dates',
        fieldErrors: { startDate: ['These dates overlap another request'] },
      }),
    );
    expect(named).toMatchObject({
      kind: 'fields',
      fieldErrors: { startDate: [expect.any(String)] },
    });
    const plain = resolveApiError(gqlError({ code: 'BUSINESS_RULE' }, 'You just punched.'));
    expect(plain).toMatchObject({ kind: 'toast', message: 'You just punched.' });
  });

  it('never shows the text of an unknown failure', () => {
    const action = resolveApiError(gqlError({ code: 'INTERNAL_ERROR' }, 'ECONNREFUSED db:5432'));
    expect(action).toMatchObject({ kind: 'toast', retryable: true });
    expect(action.message).not.toContain('ECONNREFUSED');
  });

  it('treats unknown codes and junk input as a generic retryable toast', () => {
    for (const junk of [
      null,
      undefined,
      'boom',
      42,
      {},
      { response: {} },
      gqlError({ code: 'X' }),
    ]) {
      expect(resolveApiError(junk)).toMatchObject({ kind: 'toast', retryable: true });
    }
  });

  it('treats network failures as offline', () => {
    const action = resolveApiError(new TypeError('fetch failed'));
    expect(action).toMatchObject({ kind: 'toast', retryable: true });
    expect(action.message).toMatch(/Cannot reach the server/);
  });
});
