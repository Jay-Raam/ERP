import 'server-only';

export type ApiHealth = { online: true; instance: string | null } | { online: false };

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** Server-side liveness probe. Never throws: a down API is a normal state to render. */
export async function getApiHealth(): Promise<ApiHealth> {
  try {
    const res = await fetch(`${API_URL}/health/live`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return { online: false };
    const body = (await res.json()) as { status?: unknown; instance?: unknown };
    if (body.status !== 'ok') return { online: false };
    return { online: true, instance: typeof body.instance === 'string' ? body.instance : null };
  } catch {
    return { online: false };
  }
}
