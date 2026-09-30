/**
 * The app's mark: a rounded badge holding a dynamic taekwondo kicking figure -- a bold, pictogram-
 * style stickman mid-kick (chambered knee, raised striking leg), not a literal photo/silhouette of
 * any real person or organization's actual logo artwork. Two sizes only ("nav" for the topbar,
 * "hero" for the upload/login screen) so the mark never appears at an arbitrary in-between size.
 */
export function BrandMark({ size = 'nav' }: { size?: 'nav' | 'hero' }) {
  const px = size === 'hero' ? 56 : 26;
  return (
    <svg className="brand-mark" width={px} height={px} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="url(#brandmark-badge)" />
      <circle cx="20" cy="9.5" r="3" fill="#f2f4f8" />
      <path
        d="M20 12.5 16.5 21 M16.5 21 13 31 M16.5 21 25 16 M25 16 32 20 M17 14 10 12 M17 14 12.5 19"
        stroke="#f2f4f8"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="20" r="2" fill="var(--hong)" />
      <defs>
        <linearGradient id="brandmark-badge" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#111826" />
          <stop offset="1" stopColor="#0a0e19" />
        </linearGradient>
      </defs>
    </svg>
  );
}
