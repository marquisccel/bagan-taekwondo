/**
 * The app's mark: a rounded badge holding a small bracket tree -- the exact shape this product
 * draws everywhere else (see packages/export/src/pdf/compact-bracket-svg.ts), rendered in the same
 * cheong/hong (blue/red) corner colors as a real match, converging on a single gold final line. Two
 * sizes only ("nav" for the topbar, "hero" for the upload/login screen) so the mark never appears at
 * an arbitrary in-between size.
 */
export function BrandMark({ size = 'nav' }: { size?: 'nav' | 'hero' }) {
  const px = size === 'hero' ? 56 : 26;
  return (
    <svg className="brand-mark" width={px} height={px} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="url(#brandmark-badge)" />
      <path d="M9 11.5H15.5V19" stroke="var(--cheong)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9 27.5H15.5V20" stroke="var(--hong)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M15.5 19.5H31" stroke="var(--gold)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="31" cy="19.5" r="2.1" fill="var(--gold)" />
      <defs>
        <linearGradient id="brandmark-badge" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#111826" />
          <stop offset="1" stopColor="#0a0e19" />
        </linearGradient>
      </defs>
    </svg>
  );
}
