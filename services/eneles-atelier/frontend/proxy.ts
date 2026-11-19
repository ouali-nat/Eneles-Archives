import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const protectedRoutes = [
  '/dashboard',
  '/pdfs',
  '/projects',
  '/snips',
  '/profile',
  '/settings',
  '/billing',
  '/ai',
  '/statistics',
]

const authRoutes = ['/login', '/signup']

/** The host the visitor asked for. Behind the platform's proxy the original host arrives in x-forwarded-host. */
function requestHost(request: NextRequest): string {
  return (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(',')[0].trim().toLowerCase()
}

/** The site's domain (the Eneles Atelier host), from the one setting everything is derived from. Read on each request: DOMAIN_NAME is a server variable and may differ between deployments of one build. */
function siteDomain(): string {
  return (process.env.DOMAIN_NAME || process.env.NEXT_PUBLIC_DOMAIN_NAME || '').trim().toLowerCase()
}

/** http or https, as the visitor used it. */
function requestProtocol(request: NextRequest): string {
  return (request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')).split(',')[0].trim() || 'https'
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = requestHost(request)

  // www.the Eneles Atelier host is not a second site: send it to the bare domain, keeping the path and query. A permanent redirect, so browsers and search engines remember it.
  if (host.startsWith('www.')) {
    return NextResponse.redirect(`${requestProtocol(request)}://${host.slice(4)}${pathname}${request.nextUrl.search}`, 308)
  }

  // The operators' panel lives in app/admin and is served at admin.<domain>: there, /users is app/admin/users. A request to that host for /admin/users is sent to the short address, so each page has one URL. Nothing needs to be set for this: any host that begins with "admin." is the panel.
  // Signing in happens inside the panel, so none of the rules below apply to it. This mapping is for tidy addresses only: the API decides who is an administrator on every request.
  const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/')
  if (host.startsWith('admin.')) {
    // Files from public/ (the country flags, the web manifest) and the app's generated files (icon, manifest.webmanifest) are served as they are: no panel page has a dot in its last segment, and mapping these under /admin answered 404.
    if (/\.[a-z0-9]+$/i.test(pathname)) return NextResponse.next()
    const url = request.nextUrl.clone()
    if (inAdmin) {
      // Built from the host the visitor asked for: behind the platform's proxy the request's own URL can name an internal address.
      return NextResponse.redirect(`${requestProtocol(request)}://${host}${pathname.slice('/admin'.length) || '/'}${request.nextUrl.search}`, 308)
    }
    url.pathname = pathname === '/' ? '/admin' : `/admin${pathname}`
    return NextResponse.rewrite(url)
  }
  if (inAdmin) {
    // On the site's own domain the panel is not at /admin: it is at admin.<domain>. Anywhere else (localhost, a preview address) there is no such host, so the panel stays here.
    const domain = siteDomain()
    if (domain && host === domain) return NextResponse.redirect(`https://admin.${domain}${pathname.slice('/admin'.length) || '/'}${request.nextUrl.search}`, 308)
    return NextResponse.next()
  }

  // A Docs, Learn, or Library page with .md appended (/docs/compiling.md) is that page as plain Markdown, for AI assistants and other readers of text. The copies are built by app/md.
  if (/^\/(docs|learn|library)\/.+\.md$/.test(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = `/md${pathname.slice(0, -'.md'.length)}`
    return NextResponse.rewrite(url)
  }

  // The sign-in itself is an HttpOnly cookie on the API's host, which this
  // proxy cannot see. The page sets `texer_signed_in` beside it; `auth-token`
  // is what older versions set, and the page removes it on first load.
  const hasAuthToken =
    request.cookies.get('texer_signed_in')?.value === '1' ||
    request.cookies.has('auth-token')

  const isEmbeddedApp = request.headers.get('sec-fetch-dest') === 'iframe'
  const isProtectedRoute = protectedRoutes.some((route) =>
    pathname.startsWith(route),
  )
  // Third-party cookie restrictions can hide the local hint cookie inside
  // Eneles' iframe. Its API bearer session is still verified on every request.
  if (isProtectedRoute && !hasAuthToken && !isEmbeddedApp) {
    // Keep the destination, so a shared project link opens after sign-in.
    const login = new URL('/login', request.url)
    login.searchParams.set('redirect', pathname + request.nextUrl.search)
    return NextResponse.redirect(login)
  }

  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route))
  if (isAuthRoute && hasAuthToken) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|branding).*)',
  ],
}
