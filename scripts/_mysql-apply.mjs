/*
 * Dev tool: apply a drizzle-kit-generated MySQL/MariaDB .sql file to the
 * GoDaddy database (GODADDY_MYSQL_URL in .env.local) and print the resulting
 * tables. Used to prove the MariaDB schema pipeline before Stage 1 fans out.
 *
 *   node scripts/_mysql-apply.mjs drizzle-mysql/0000_whole_black_crow.sql
 */
import { readFileSync } from 'node:fs';

import mysql from 'mysql2/promise';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')];
    }),
);

const url = env.GODADDY_MYSQL_URL;
const sqlFile = process.argv[2];
if (!sqlFile) {
  console.log('usage: node scripts/_mysql-apply.mjs <path-to.sql>');
  process.exit(1);
}
const sql = readFileSync(sqlFile, 'utf8');
const stmts = sql
  .split('--> statement-breakpoint')
  .map((s) => s.trim())
  .filter(Boolean);

const conn = await mysql.createConnection({ uri: url, connectTimeout: 15_000 });
try {
  for (const s of stmts) {
    await conn.query(s);
    console.log('✓ applied:', s.split('\n')[0].slice(0, 70));
  }
  const [tables] = await conn.query('SHOW TABLES');
  console.log('\nTABLES in db:', tables.map((r) => Object.values(r)[0]).join(', '));
  for (const t of ['organizations', 'users']) {
    try {
      const [cols] = await conn.query(`DESCRIBE \`${t}\``);
      console.log(`\n${t}:`);
      for (const c of cols)
        console.log(
          `   ${c.Field}  ${c.Type}  null=${c.Null}  key=${c.Key || '-'}${c.Default != null ? '  def=' + c.Default : ''}`,
        );
    } catch {
      /* table not in this file */
    }
  }
} catch (e) {
  console.log('✗ ERROR', e.code || '', '|', e.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
