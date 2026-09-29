import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
 poweredByHeader:false,
 // The Codex SDK finds its CLI binary relative to its own files, which breaks when bundled.
 serverExternalPackages:['cheerio','ipaddr.js','@openai/codex-sdk'],
};
export default nextConfig;
