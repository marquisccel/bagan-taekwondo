import type { ReactNode } from 'react';
import { Plus_Jakarta_Sans } from 'next/font/google';

import { DevAuthProvider } from '../lib/dev-auth';
import './globals.css';

const font = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-plus-jakarta-sans', display: 'swap' });

export const metadata = { title: 'Taekwondo Bracket Generator' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={font.variable}>
      <body>
        <DevAuthProvider>{children}</DevAuthProvider>
      </body>
    </html>
  );
}
