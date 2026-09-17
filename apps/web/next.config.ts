import type { NextConfig } from 'next';

/**
 * Next 16 blocks cross-origin dev requests by default (a new safety feature — see AGENTS.md).
 * The Claude Code browser preview reaches this dev server over 127.0.0.1, which otherwise trips
 * that guard and silently breaks client-side data fetching in the preview pane.
 */
const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
