/**
 * The app's mark: a flowing, leaping kick silhouette (public/brand-mark.png -- transparent
 * background, tinted blue-to-violet), no badge/backdrop of its own. Two sizes only ("nav" for the
 * topbar, "hero" for the upload/login screen) so the mark never appears at an arbitrary in-between
 * size. Its natural aspect ratio (235:199) is preserved, never stretched.
 */
export function BrandMark({ size = 'nav' }: { size?: 'nav' | 'hero' }) {
  const width = size === 'hero' ? 88 : 34;
  const height = Math.round(width * (199 / 235));
  return (
    <img
      className="brand-mark"
      src="/brand-mark.png"
      alt=""
      width={width}
      height={height}
      aria-hidden="true"
    />
  );
}
