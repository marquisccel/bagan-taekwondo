import type { ReactNode } from 'react';

export const metadata = { title: 'BaganTKD' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
