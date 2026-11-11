import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = new Set(['/login', '/register']);
/** Set by the API next to the session cookies. Holds no secret; it is only a hint. */
const SESSION_HINT = 'erp_session';

/**
 * Sends anonymous visitors to sign-in and signed-in users away from it.
 * This is for navigation only. The API checks every request itself.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_HINT);
  const isPublic = PUBLIC_PATHS.has(pathname);

  if (!hasSession && !isPublic) {
    const url = new URL('/login', request.url);
    if (pathname !== '/') url.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  if (hasSession && isPublic) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except API paths, Next internals and files with an extension.
  matcher: ['/((?!graphql|auth/|health|_next/|.*\\..*).*)'],
};
