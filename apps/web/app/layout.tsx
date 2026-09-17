import type { ReactNode } from 'react';

import { DevAuthProvider } from '../lib/dev-auth';
import './globals.css';

export const metadata = { title: 'BaganTKD Operator' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>
        <div className="dev-auth-banner">DEV AUTH ONLY — not a production login system</div>
        <DevAuthProvider>{children}</DevAuthProvider>
      </body>
    </html>
  );
}
