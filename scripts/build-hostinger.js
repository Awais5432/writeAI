#!/usr/bin/env node
/**
 * Build static files for Hostinger upload.
 * Usage: node scripts/build-hostinger.js https://writeai-api.onrender.com
 */
const fs = require('fs');
const path = require('path');

const apiBase = (process.argv[2] || process.env.WRITEAI_API_BASE || '').replace(/\/$/, '');

if (!apiBase) {
  console.error('Usage: node scripts/build-hostinger.js https://YOUR-API.onrender.com');
  process.exit(1);
}

const src = path.join(__dirname, '..', 'writeai-backend', 'src', 'web', 'public');
const dest = path.join(__dirname, '..', 'deploy', 'hostinger');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(dest)) {
  fs.rmSync(dest, { recursive: true, force: true });
}

copyDir(src, dest);

const configJs = `// Auto-generated — do not edit. Re-run: node scripts/build-hostinger.js ${apiBase}
window.WRITEAI_API_BASE = '${apiBase}';
`;

fs.writeFileSync(path.join(dest, 'js', 'config.js'), configJs, 'utf8');

console.log(`Hostinger package ready: deploy/hostinger/`);
console.log(`API base: ${apiBase}`);
console.log('Upload everything inside deploy/hostinger/ to your demo subdomain folder.');
