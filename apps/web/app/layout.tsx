import type { Metadata } from 'next';
import './globals.css';
import { ConvexClientProvider } from './ConvexClientProvider';
import { withAuth } from '@workos-inc/authkit-nextjs';

export const metadata: Metadata = {
  title: 'AGHARTA — An engine for unconventional thinking',
  description:
    'A self-improving creative search engine. It explores problems through multiple strategies, evaluates and compares results, and learns which strategies work.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { accessToken } = await withAuth();
  return (
    <html lang="en">
      <body className="antialiased">
        <ConvexClientProvider expectAuth={!!accessToken}>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
