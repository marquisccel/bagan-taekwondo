import { chromium } from 'playwright';

/**
 * Print-optimized HTML rendered by headless Chromium (the pre-existing decision — see
 * docs/PHASE0_PROPOSAL.md: "PDF: print-optimized HTML/SVG rendered by headless Chromium
 * (Playwright) in the worker"). One browser instance per render call keeps this function simple
 * and safe to call from short-lived worker jobs; a caller doing many renders in a batch may choose
 * to hoist browser launch itself in a future phase — not needed at Phase 6's volume.
 */
export async function renderHtmlToPdf(
  html: string,
  options: {
    readonly headerTemplate?: string;
    readonly footerTemplate?: string;
    /** Landscape A4 — used only by documents that need it (the compact semi-prestasi sheet's 2-column pool grid). */
    readonly landscape?: boolean;
  } = {},
): Promise<Uint8Array> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const displayHeaderFooter = Boolean(options.headerTemplate || options.footerTemplate);
    const pdf = await page.pdf({
      format: 'A4',
      landscape: options.landscape ?? false,
      printBackground: true,
      margin: {
        top: displayHeaderFooter ? '18mm' : '14mm',
        bottom: displayHeaderFooter ? '16mm' : '14mm',
        left: '12mm',
        right: '12mm',
      },
      displayHeaderFooter,
      headerTemplate: options.headerTemplate ?? '<span></span>',
      footerTemplate: options.footerTemplate ?? '<span></span>',
    });
    return pdf;
  } finally {
    await browser.close();
  }
}
