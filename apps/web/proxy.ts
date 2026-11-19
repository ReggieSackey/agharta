import { authkitMiddleware } from '@workos-inc/authkit-nextjs';

/**
 * Next.js 16 proxy (successor of middleware) using the official AuthKit
 * middleware. Public paths only; everything else requires a session.
 */
export default authkitMiddleware({
  eagerAuth: true,
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: ['/', '/login', '/sign-in', '/sign-up'],
  },
  redirectUri:
    process.env.VERCEL_ENV === 'preview'
      ? `https://${process.env.VERCEL_BRANCH_URL}/callback`
      : process.env.VERCEL_ENV === 'production'
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/callback`
        : undefined,
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
