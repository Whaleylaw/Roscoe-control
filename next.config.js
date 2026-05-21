const withNextIntl = require('next-intl/plugin')('./src/i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: {
    // The Waypoint catalog YAML is runtime data shipped inside @waypoint/core.
    // The API passes an explicit root to avoid import.meta.resolve in the
    // package loader, and standalone builds must copy these files with it.
    '/*': [
      './node_modules/@waypoint/core/quests/**/*',
      './node_modules/@waypoint/core/recipes/**/*',
    ],
  },
  outputFileTracingExcludes: {
    // Exclude local runtime and diagnostic state from standalone tracing.
    // `.git` must be excluded so the self-update endpoint does not see the
    // standalone dir as a dirty working tree. `.data` and agent diagnostic
    // dirs can be very large in long-lived dev checkouts and must never be
    // bundled into `.next/standalone/` or scanned as runtime dependencies.
    '/*': [
      './.data/**/*',
      './.git/**/*',
      './.hermes/**/*',
      './.claude/**/*',
      './.playwright-mcp/**/*',
      './playwright-report/**/*',
      './test-results/**/*',
      './Heap.*.heapsnapshot',
    ],
  },
  turbopack: {
    root: __dirname,
  },
  // Transpile ESM-only packages so they resolve correctly in all environments
  transpilePackages: ['react-markdown', 'remark-gfm'],
  
  // Security headers
  // Content-Security-Policy is set in src/proxy.ts with a per-request nonce.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ...(process.env.NODE_ENV === 'production' && process.env.MC_DISABLE_HSTS !== '1' || process.env.MC_ENABLE_HSTS === '1' ? [
            { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }
          ] : []),
        ],
      },
    ];
  },
  
};

module.exports = withNextIntl(nextConfig);
