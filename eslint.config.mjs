import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([
 ...nextVitals,...nextTs,
 {rules:{'react-hooks/set-state-in-effect':'off','react-hooks/refs':'off'}},
 globalIgnores(['.next/**','.cloudflare/**','.vinext/**','convex/_generated/**','out/**','next-env.d.ts','test-results/**','playwright-report/**']),
]);
