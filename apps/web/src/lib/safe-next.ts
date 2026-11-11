export const DEFAULT_AFTER_LOGIN = '/dashboard';

/**
 * Where to go after sign-in. Only same-site paths are accepted, so a crafted
 * link like /login?next=https://evil.example cannot bounce the user off-site.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return DEFAULT_AFTER_LOGIN;
  }
  try {
    const url = new URL(value, 'http://internal.invalid');
    if (url.origin !== 'http://internal.invalid') return DEFAULT_AFTER_LOGIN;
    if (url.pathname === '/login' || url.pathname === '/register') return DEFAULT_AFTER_LOGIN;
    return `${url.pathname}${url.search}`;
  } catch {
    return DEFAULT_AFTER_LOGIN;
  }
}
