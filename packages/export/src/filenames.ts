/**
 * Stable, safe, sanitized filenames (ACCEPTANCE §Filenames) — never a participant NIK or other
 * sensitive identifier, never raw user-controlled text. `tournamentSlug`/`categorySlug` must
 * already be caller-provided plain identifiers (e.g. tournament.code, category.categoryKey); this
 * function only sanitizes and assembles, it does not decide what identifies a document.
 */
function slugify(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'x'
  );
}

export function exportFilename(args: {
  readonly tournamentSlug: string;
  readonly documentType: string;
  readonly revisionNo: number;
  readonly categorySlug?: string;
  readonly generatedAt: string;
  readonly extension: 'pdf' | 'xlsx';
}): string {
  const ts = args.generatedAt.replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
  const parts = [
    slugify(args.tournamentSlug),
    ...(args.categorySlug ? [slugify(args.categorySlug)] : []),
    `rev${args.revisionNo}`,
    slugify(args.documentType),
    ts,
  ];
  return `${parts.join('_')}.${args.extension}`;
}
