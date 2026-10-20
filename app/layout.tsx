import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Session } from '@/components/Session';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = { title: 'Voter Search' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="te">
      <body className="text-slate-900">
        <Session>
          <div className="mx-auto min-h-dvh max-w-xl pb-24">{children}</div>
          <Nav />
        </Session>
      </body>
    </html>
  );
}
