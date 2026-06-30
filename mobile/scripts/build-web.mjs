// Builds the Capacitor web bundle: copies ../frontend into ./www and bakes in
// the production API url so the packaged app talks to your deployed backend.
//
//   DIBS_API_BASE=https://dibs-api.onrender.com npm run build:web
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const srcDir = path.join(root, '..', 'frontend');
const outDir = path.join(root, 'www');

const base = process.env.DIBS_API_BASE || '';
if (!base) {
  console.warn('⚠  DIBS_API_BASE not set — the app will fall back to http://localhost:4000,\n   which a real phone cannot reach. Set it to your HTTPS backend before a release build.');
} else if (!/^https:\/\//.test(base)) {
  console.warn(`⚠  DIBS_API_BASE is "${base}" — Android blocks plain HTTP. Use an https:// url for releases.`);
}

// fresh www/
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// copy every frontend file
for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
  const from = path.join(srcDir, entry.name);
  const to = path.join(outDir, entry.name);
  if (entry.isDirectory()) fs.cpSync(from, to, { recursive: true });
  else fs.copyFileSync(from, to);
}

// bake the API base into index.html
const indexPath = path.join(outDir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const marker = "?? 'http://localhost:4000';";
if (base) {
  if (!html.includes(marker)) {
    console.error('✗ could not find the API-base marker in index.html — did the config script change?');
    process.exit(1);
  }
  html = html.replace(marker, `?? ${JSON.stringify(base)};`);
}
fs.writeFileSync(indexPath, html);

console.log(`✓ www/ built — API base: ${base || 'http://localhost:4000 (dev fallback)'}`);
