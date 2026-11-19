import { getSignInUrl } from '@workos-inc/authkit-nextjs';
import { redirect } from 'next/navigation';

/**
 * Redirects into the AuthKit hosted sign-in page (v4 SDK API).
 */
export default async function LoginPage() {
  try {
    const url = await getSignInUrl();
    redirect(url);
  } catch {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <div className="panel p-6">
          <h1 className="mb-2 font-medium">Sign in unavailable</h1>
          <p className="text-sm text-[var(--color-muted)]">
            WorkOS AuthKit is not configured on this deployment. Set <code>WORKOS_CLIENT_ID</code>,{' '}
            <code>WORKOS_API_KEY</code>, and <code>WORKOS_COOKIE_PASSWORD</code> in{' '}
            <code>apps/web/.env.local</code>, then restart. See <code>.env.example</code> at the
            repository root.
          </p>
        </div>
      </main>
    );
  }
}
