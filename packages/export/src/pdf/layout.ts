import type { ExportModel } from '../model.js';
import { EXPORT_MODE_LABEL, revisionLifecycleLabel } from '../presentation.js';

export interface RenderOptions {
  readonly mode: 'PREVIEW' | 'OFFICIAL';
  /** ISO-8601 timestamp supplied by the caller — the renderer never reads the wall clock itself. */
  readonly generatedAt: string;
  /** Short, human-typeable verification string (e.g. the first 12 hex chars of the output fingerprint). */
  readonly verificationCode: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(d);
};

/**
 * Shared print CSS: A4, consistent margins, no marketing chrome — dense operator-document styling.
 * This string is embedded verbatim in every document's <style> block regardless of mode, so no
 * comment in here may contain the literal word the watermark itself prints — it would leak into an
 * OFFICIAL document's HTML even though the watermark div is never rendered for OFFICIAL.
 *
 * `.watermark`'s color alpha (final polish §4) was lightened from 0.18 to keep table/bracket text
 * underneath easy to read, while staying clearly visible — see `EXPORT_MODE_LABEL` and
 * `watermarkHtml()` for where it is (and is not) rendered.
 */
export const PDF_BASE_CSS = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; color: #111; margin: 0; }
  h1, h2, h3 { overflow-wrap: break-word; }
  h1 { font-size: 15pt; margin: 0 0 2mm; }
  h2 { font-size: 12.5pt; margin: 4mm 0 2mm; page-break-after: avoid; }
  h3 { font-size: 11pt; margin: 3mm 0 1.5mm; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
  th, td { border: 0.3pt solid #999; padding: 1.2mm 2mm; text-align: left; vertical-align: top; word-break: break-word; }
  th { background: #eee; font-weight: 600; }
  .num { text-align: center; }
  .meta { font-size: 8.5pt; color: #444; margin-bottom: 3mm; }
  .meta div { margin-bottom: 0.5mm; }
  .doc-kicker { font-size: 8.5pt; letter-spacing: 0.06em; text-transform: uppercase; color: #777; margin-bottom: 1mm; }
  .tech-meta { font-size: 7.5pt; color: #999; margin-top: 4mm; }
  .code-tag { font-size: 7.5pt; color: #999; font-family: 'Consolas', monospace; }
  .warn { color: #7a4b00; margin-bottom: 1mm; }
  .bye { color: #888; font-style: italic; }
  .section { page-break-inside: avoid; }
  .page-break { page-break-before: always; }
  .watermark {
    position: fixed; top: 40%; left: 0; right: 0; text-align: center;
    font-size: 44pt; color: rgba(200, 30, 30, 0.11); font-weight: 700; transform: rotate(-28deg);
    z-index: -1;
  }
`;

/** The two labels the spec requires verbatim, in Bahasa Indonesia, wherever a document's mode must be visible. */
export function modeLabel(mode: RenderOptions['mode']): string {
  return EXPORT_MODE_LABEL[mode];
}

export function watermarkHtml(mode: RenderOptions['mode']): string {
  return mode === 'PREVIEW' ? `<div class="watermark">${esc(EXPORT_MODE_LABEL.PREVIEW)}</div>` : '';
}

/** The metadata block every document type must show: revision/version, tournament, timestamp, verification code. */
export function metaBlockHtml(model: ExportModel, opts: RenderOptions): string {
  return `
    <div class="meta">
      <div><strong>${esc(model.tournament.name)}</strong> (${esc(model.tournament.code)})</div>
      <div>Revisi ${model.revision.revisionNo} &middot; Status: ${esc(revisionLifecycleLabel(model.revision.lifecycle))}</div>
      <div>${modeLabel(opts.mode)}</div>
      <div>Dibuat: ${esc(fmtDate(opts.generatedAt))}</div>
      <div>Kode verifikasi: ${esc(opts.verificationCode)}</div>
    </div>
  `;
}

export function pageShell(title: string, bodyHtml: string, opts: RenderOptions): string {
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>${PDF_BASE_CSS}</style>
</head>
<body>
${watermarkHtml(opts.mode)}
${bodyHtml}
</body>
</html>`;
}

export const headerTemplate = (title: string): string =>
  `<div style="font-size:8pt; width:100%; padding:0 10mm; color:#555; box-sizing:border-box;
     overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">${esc(title)}</div>`;

/**
 * `bare`: no "bagan-tkd" branding, page number right-aligned flush with the body's own right margin
 * (12mm, matching `renderHtmlToPdf`'s page margin) so it lines up with a full-width bracket's own
 * right edge -- used by the FINAL/OFFICIAL semi-prestasi sheet (structural reference: the legacy
 * manually-produced bracket sheet carried no branding footer). Every other document keeps the
 * original two-sided footer.
 */
export const footerTemplate = (opts: { readonly bare?: boolean } = {}): string =>
  opts.bare
    ? `<div style="font-size:8pt; width:100%; padding:0 12mm; color:#555; text-align:right; box-sizing:border-box;">
    <span>Hal. <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`
    : `<div style="font-size:8pt; width:100%; padding:0 10mm; color:#555; display:flex; justify-content:space-between;">
    <span>bagan-tkd</span>
    <span>Hal. <span class="pageNumber"></span> / <span class="totalPages"></span></span>
  </div>`;

export { esc };
