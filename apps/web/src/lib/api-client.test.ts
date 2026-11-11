import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, gqlRequest, refreshSession, restPost } from './api-client';

type Reply = { status?: number; json?: unknown; text?: string };
let calls: { url: string; init: RequestInit }[];
let replies: Record<string, Reply[]>;

function reply({ status = 200, json, text }: Reply): Response {
  return new Response(text ?? (json === undefined ? null : JSON.stringify(json)), {
    status,
    headers: { 'content-type': text ? 'text/html' : 'application/json' },
  });
}

beforeEach(() => {
  calls = [];
  replies = {};
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies[url]?.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return reply(next);
  });
});

afterEach(() => vi.unstubAllGlobals());

const unauth = {
  json: { data: null, errors: [{ message: 'x', extensions: { code: 'UNAUTHENTICATED' } }] },
};
const ok = { json: { data: { me: { id: '1' } } } };
const count = (url: string) => calls.filter((c) => c.url === url).length;

describe('gqlRequest', () => {
  it('sends the CSRF header and same-origin credentials', async () => {
    replies['/graphql'] = [ok];
    await gqlRequest('{ me { id } }');
    const { init } = calls[0]!;
    expect((init.headers as Record<string, string>)['x-erp-client']).toBe('web');
    expect(init.credentials).toBe('same-origin');
    expect(init.method).toBe('POST');
  });

  it('refreshes once on UNAUTHENTICATED and retries', async () => {
    replies['/graphql'] = [unauth, ok];
    replies['/auth/refresh'] = [{ json: { ok: true } }];
    await expect(gqlRequest('{ me { id } }')).resolves.toEqual({ me: { id: '1' } });
    expect(count('/auth/refresh')).toBe(1);
    expect(count('/graphql')).toBe(2);
  });

  it('gives up after one retry instead of looping', async () => {
    replies['/graphql'] = [unauth, unauth];
    replies['/auth/refresh'] = [{ json: { ok: true } }];
    await expect(gqlRequest('{ me { id } }')).rejects.toMatchObject({
      error: { code: 'UNAUTHENTICATED' },
    });
    expect(count('/graphql')).toBe(2);
    expect(count('/auth/refresh')).toBe(1);
  });

  it('does not retry when the refresh itself fails', async () => {
    replies['/graphql'] = [unauth];
    replies['/auth/refresh'] = [{ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }];
    await expect(gqlRequest('{ me { id } }')).rejects.toBeInstanceOf(ApiError);
    expect(count('/graphql')).toBe(1);
  });

  it('shares one refresh between parallel requests', async () => {
    replies['/graphql'] = [unauth, unauth, unauth, ok, ok, ok];
    replies['/auth/refresh'] = [{ json: { ok: true } }];
    await Promise.all([gqlRequest('{ a }'), gqlRequest('{ b }'), gqlRequest('{ c }')]);
    expect(count('/auth/refresh')).toBe(1);
  });

  it('passes other errors through with code, fields and request id', async () => {
    replies['/graphql'] = [
      {
        json: {
          data: null,
          errors: [
            {
              message: 'Some fields are invalid',
              extensions: {
                code: 'VALIDATION_ERROR',
                fieldErrors: { email: ['bad'] },
                requestId: 'r-1',
              },
            },
          ],
        },
      },
    ];
    await expect(gqlRequest('mutation { x }')).rejects.toMatchObject({
      error: { code: 'VALIDATION_ERROR', fieldErrors: { email: ['bad'] }, requestId: 'r-1' },
    });
    expect(count('/auth/refresh')).toBe(0);
  });

  it('reads the REST error shape when the request never reached GraphQL', async () => {
    replies['/graphql'] = [
      { status: 429, json: { error: { code: 'RATE_LIMITED', message: 'slow down' } } },
    ];
    await expect(gqlRequest('{ me { id } }')).rejects.toMatchObject({
      status: 429,
      error: { code: 'RATE_LIMITED' },
    });
  });

  it('treats a gateway error page as the network being down', async () => {
    replies['/graphql'] = [{ status: 502, text: '<html>Bad Gateway</html>' }];
    await expect(gqlRequest('{ me { id } }')).rejects.toBeInstanceOf(TypeError);
  });
});

describe('restPost', () => {
  it('returns the body on success and null on 204', async () => {
    replies['/auth/login'] = [{ json: { viewer: { user: { id: 'u' } } } }];
    replies['/auth/logout'] = [{ status: 204 }];
    await expect(restPost('/auth/login', {})).resolves.toEqual({ viewer: { user: { id: 'u' } } });
    await expect(restPost('/auth/logout')).resolves.toBeNull();
  });

  it('throws ApiError with the server body', async () => {
    replies['/auth/login'] = [
      { status: 401, json: { error: { code: 'UNAUTHENTICATED', message: 'nope' } } },
    ];
    await expect(restPost('/auth/login', {})).rejects.toMatchObject({
      status: 401,
      error: { code: 'UNAUTHENTICATED', message: 'nope' },
    });
  });
});

describe('refreshSession', () => {
  it('reports failure without throwing when the network is down', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline');
    });
    await expect(refreshSession()).resolves.toBe(false);
  });
});
