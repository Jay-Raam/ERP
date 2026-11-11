import { randomBytes } from 'node:crypto';
import { argon2Verify, argon2id } from 'hash-wasm';

// OWASP minimum for argon2id: 19 MiB memory, 2 iterations, 1 lane.
const PARAMS = { parallelism: 1, iterations: 2, memorySize: 19_456, hashLength: 32 } as const;

/** Returns a self-describing `$argon2id$...` string with a fresh random salt. */
export function hashPassword(password: string): Promise<string> {
  return argon2id({ ...PARAMS, password, salt: randomBytes(16), outputType: 'encoded' });
}

/** Never throws: a malformed stored hash is simply a failed check. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash });
  } catch {
    return false;
  }
}
