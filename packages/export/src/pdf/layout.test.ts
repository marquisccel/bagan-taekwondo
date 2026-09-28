import { describe, expect, it } from 'vitest';

import { footerTemplate } from './layout.js';

describe('footerTemplate', () => {
  it('default: keeps the "bagan-tkd" branding beside the page number', () => {
    const html = footerTemplate();
    expect(html).toContain('bagan-tkd');
    expect(html).toContain('Hal.');
  });

  it("bare (FINAL/OFFICIAL semi-prestasi sheet): no branding, page number right-aligned flush with the body's own 12mm margin", () => {
    const html = footerTemplate({ bare: true });
    expect(html).not.toContain('bagan-tkd');
    expect(html).toContain('Hal.');
    expect(html).toContain('text-align:right');
    expect(html).toContain('padding:0 12mm');
  });
});
