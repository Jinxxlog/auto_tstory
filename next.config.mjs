/** @type {import('next').NextConfig} */
const config = {
  turbopack: { root: process.cwd() },
  outputFileTracingExcludes: {
    '/**': ['data/**/*', 'backups/**/*', '.local/**/*', '*.before-restore-*/**/*', '*.failed-restore-*/**/*', '.restore-*/**/*', '.creating-*/**/*', '.env*'],
  },
  serverExternalPackages: ['sharp'],
  async headers() { return [{ source: '/:path*', headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  ] }]; },
};
export default config;
