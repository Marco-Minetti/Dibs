import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

async function run() {
  await pool.query(`
    create table if not exists _migrations (
      name text primary key,
      run_at timestamptz not null default now()
    )`);

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  const done = new Set((await pool.query('select name from _migrations')).rows.map(r => r.name));

  for (const file of files) {
    if (done.has(file)) { console.log(`· skip ${file}`); continue; }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log(`▸ applying ${file}`);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into _migrations (name) values ($1)', [file]);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      console.error(`✗ failed ${file}:`, e.message);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  console.log('✓ migrations up to date');
  await pool.end();
}

run();
