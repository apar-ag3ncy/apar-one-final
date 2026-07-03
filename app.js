/*
 * GoDaddy cPanel "Setup Node.js App" (Phusion Passenger) startup file.
 *
 * Point the app's "Application startup file" at this. It boots the Next.js
 * standalone server (produced by `output: 'standalone'` in next.config.ts),
 * which listens on the port Passenger provides via process.env.PORT.
 *
 * Requires the standalone bundle assembled next to it — run
 * `npm run build && node scripts/pack-cpanel.mjs` locally, then upload
 * `.next/standalone/` (with static + public folded in), this file, and
 * `.next/static` / `public`. See DEPLOY-CPANEL.md.
 */
const path = require('node:path');

const standaloneDir = path.join(__dirname, '.next', 'standalone');
// The Next standalone server resolves its manifests relative to the working
// directory, so run from inside the standalone bundle.
process.chdir(standaloneDir);
require(path.join(standaloneDir, 'server.js'));
