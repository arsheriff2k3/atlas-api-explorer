import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
 poweredByHeader:false,
 serverExternalPackages:['cheerio','ipaddr.js'],
};
export default nextConfig;
