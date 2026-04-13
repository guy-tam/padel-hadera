/** @type {import('next').NextConfig} */
const nextConfig = {
  // workspace root מוגדר במפורש כדי להימנע מאזהרת lockfile כפול
  outputFileTracingRoot: new URL('.', import.meta.url).pathname,
  async rewrites() {
    return [
      // גשר זמני ל-Express הקיים — יוסר כשכל ה-API יעבור ל-Server Actions
      { source: '/legacy-api/:path*', destination: `${process.env.LEGACY_API_URL || 'http://localhost:3000'}/api/:path*` }
    ];
  }
};
export default nextConfig;
