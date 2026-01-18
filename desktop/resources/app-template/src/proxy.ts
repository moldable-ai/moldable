import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

/**
 * Next.js 16+ Proxy (formerly middleware).
 * This runs on every request and can intercept/modify requests.
 *
 * For Moldable apps, this is typically a pass-through unless you need
 * custom routing logic (e.g., auth redirects, rewrites).
 *
 * @see https://nextjs.org/docs/app/building-your-application/routing/middleware
 */
export function proxy(_request: NextRequest) {
  // Pass through all requests by default
  return NextResponse.next()
}

/**
 * Configure which paths the proxy runs on.
 * By default, it runs on all paths except static files and api routes.
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
