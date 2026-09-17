import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// This repo imports test globals explicitly (no `test.globals: true`), so RTL's own
// auto-cleanup — which only registers when it detects a global `afterEach` — never fires
// on its own; without this, every render leaks into the next test's DOM.
afterEach(() => {
  cleanup();
});
