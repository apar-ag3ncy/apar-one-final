import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The script reads from `process.cwd()/drizzle/*.sql`. We run it as a child
 * process with `cwd` pointed at a temp dir so we can fixture-in SQL files.
 */
const SCRIPT_PATH = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'check-no-floats.ts',
);

async function runScript(cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  // Use Node + tsx via npm to keep this Windows-friendly.
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const proc = spawn('npx', ['tsx', SCRIPT_PATH], {
      cwd,
      shell: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

describe('check-no-floats', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'apar-floats-'));
    await mkdir(join(cwd, 'drizzle'), { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('passes when no migrations exist', async () => {
    await rm(join(cwd, 'drizzle'), { recursive: true, force: true });
    const result = await runScript(cwd);
    expect(result.code).toBe(0);
  });

  it('passes when migrations contain only bigint/int/text', async () => {
    await writeFile(
      join(cwd, 'drizzle', '0000_init.sql'),
      `CREATE TABLE foo (id uuid PRIMARY KEY, amount_paise bigint NOT NULL, name text);`,
    );
    const result = await runScript(cwd);
    expect(result.code).toBe(0);
  });

  it('fails on numeric column', async () => {
    await writeFile(
      join(cwd, 'drizzle', '0000_init.sql'),
      `CREATE TABLE foo (amount numeric(10, 2) NOT NULL);`,
    );
    const result = await runScript(cwd);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/numeric/);
  });

  it('fails on double precision column', async () => {
    await writeFile(
      join(cwd, 'drizzle', '0000_init.sql'),
      `CREATE TABLE foo (rate double precision NOT NULL);`,
    );
    const result = await runScript(cwd);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/double\s+precision/i);
  });

  it('fails on real and float', async () => {
    await writeFile(
      join(cwd, 'drizzle', '0000_init.sql'),
      `CREATE TABLE foo (a real, b float(8));`,
    );
    const result = await runScript(cwd);
    expect(result.code).toBe(1);
  });

  it('ignores matches inside line comments', async () => {
    await writeFile(
      join(cwd, 'drizzle', '0000_init.sql'),
      `CREATE TABLE foo (id uuid); -- NOTE: do not use numeric here`,
    );
    const result = await runScript(cwd);
    expect(result.code).toBe(0);
  });

  it('ignores matches inside string literals', async () => {
    await writeFile(
      join(cwd, 'drizzle', '0000_init.sql'),
      `INSERT INTO foo (note) VALUES ('numeric column was banned');`,
    );
    const result = await runScript(cwd);
    expect(result.code).toBe(0);
  });
}, 30000);
