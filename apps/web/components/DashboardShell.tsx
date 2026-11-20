'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@workos-inc/authkit-nextjs/components';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/experiments', label: 'Experiments' },
  { href: '/v2learning', label: 'Learning' },
  { href: '/mechanisms', label: 'Mechanisms' },
  { href: '/settings', label: 'Settings' },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-[var(--color-line)] bg-[#fffefb] px-4 py-6 md:block">
        <Link href="/dashboard" className="mb-8 block">
          <span className="font-semibold tracking-tight">AGHARTA</span>
          <p className="data-label mt-0.5">creative search</p>
        </Link>
        <nav className="space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-[var(--color-paper)] font-medium text-[var(--color-ink)]'
                    : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-10 border-t border-[var(--color-line)] pt-4">
          <p className="data-label">signed in</p>
          <p className="mt-1 truncate text-xs text-[var(--color-muted)]">
            {loading ? '…' : (user?.firstName ?? user?.email ?? 'user')}
          </p>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-8 md:px-10">{children}</main>
    </div>
  );
}
