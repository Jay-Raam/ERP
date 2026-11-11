import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from '../src/config/env';

describe('loadEnv', () => {
  it('applies local defaults outside production', () => {
    const env = loadEnv({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.DATABASE_URL).toContain('localhost');
  });

  it('treats empty values as unset', () => {
    expect(loadEnv({ PORT: '' }).PORT).toBe(4000);
  });

  it('parses a comma-separated origin list', () => {
    const env = loadEnv({ CORS_ORIGINS: 'https://a.example, https://b.example' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('refuses to boot in production without connection strings', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(EnvError);
    try {
      loadEnv({ NODE_ENV: 'production' });
    } catch (error) {
      expect((error as EnvError).problems).toHaveLength(3);
    }
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['NODE_ENV', 'staging'],
    ['CORS_ORIGINS', 'not-a-url'],
    ['CORS_ORIGINS', 'javascript:alert(1)'],
    ['DATABASE_URL', 'mysql://x'],
    ['REDIS_URL', 'http://x'],
  ])('rejects %s=%s', (key, value) => {
    expect(() => loadEnv({ [key]: value })).toThrow(EnvError);
  });
});
