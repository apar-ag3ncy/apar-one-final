import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; }),
);
const url = env.GODADDY_MYSQL_URL;
if (!url) { console.log('❌ GODADDY_MYSQL_URL not set in .env.local'); process.exit(1); }
console.log('Connecting to:', url.replace(/:[^:@/]+@/, ':***@'));
const t0 = Date.now();
try {
  const conn = await mysql.createConnection({ uri: url, connectTimeout: 12_000 });
  const [[v]] = await conn.query('SELECT VERSION() AS version');
  const [[mu]] = await conn.query("SHOW VARIABLES LIKE 'max_user_connections'");
  const [[mc]] = await conn.query("SHOW VARIABLES LIKE 'max_connections'");
  console.log(`✅ CONNECTED in ${Date.now() - t0}ms`);
  console.log('   version:', v.version, '| max_user_connections:', mu?.Value, '| max_connections:', mc?.Value);
  await conn.end();
} catch (e) {
  console.log(`❌ FAILED in ${Date.now() - t0}ms:`, e.code || '', e.message);
}
