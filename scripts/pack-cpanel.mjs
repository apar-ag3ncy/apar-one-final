/*
 * Assemble the Next.js standalone bundle for a cPanel / Passenger deploy.
 *
 * `next build` with `output: 'standalone'` emits `.next/standalone/` with a
 * minimal `server.js` + traced node_modules — but it intentionally does NOT
 * copy `.next/static` or `public` (those are normally served by a CDN). For a
 * single-host cPanel deploy the Node server must serve them, so fold them in.
 *
 * Run AFTER `npm run build`:  node scripts/pack-cpanel.mjs
 * Then upload `.next/standalone/` + `app.js` to the cPanel app root.
 */
import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standalone = join(root, '.next', 'standalone');

if (!existsSync(standalone)) {
  console.error(
    '✗ .next/standalone not found — run `npm run build` first (needs output:"standalone").',
  );
  process.exit(1);
}

// .next/static → .next/standalone/.next/static
const staticSrc = join(root, '.next', 'static');
if (existsSync(staticSrc)) {
  cpSync(staticSrc, join(standalone, '.next', 'static'), { recursive: true });
  console.log('✓ copied .next/static');
}

// public → .next/standalone/public
const publicSrc = join(root, 'public');
if (existsSync(publicSrc)) {
  cpSync(publicSrc, join(standalone, 'public'), { recursive: true });
  console.log('✓ copied public');
}

console.log('\n✓ Standalone bundle ready at .next/standalone/');
console.log('  Upload it + app.js to the cPanel Node app root, set the startup');
console.log('  file to app.js, set env vars, then Restart. See DEPLOY-CPANEL.md.');
