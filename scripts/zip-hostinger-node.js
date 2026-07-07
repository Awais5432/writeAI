#!/usr/bin/env node
/**
 * Zip writeai-backend for Hostinger Node.js upload (hPanel → Node.js Apps → Upload).
 * Usage: node scripts/zip-hostinger-node.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backend = path.join(__dirname, '..', 'writeai-backend');
const staging = path.join(__dirname, '..', 'deploy', 'writeai-backend-staging');
const outDir = path.join(__dirname, '..', 'deploy');
const zipPath = path.join(outDir, 'writeai-backend-upload.zip');

if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
// Remove old zip names if unlocked; otherwise write to writeai-backend-upload.zip
for (const name of ['writeai-backend.zip', 'writeai-backend-upload.zip']) {
  const p = path.join(outDir, name);
  if (p !== zipPath && fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch { /* locked — ignore */ }
  }
}

const SKIP = new Set(['node_modules', '.env', '.git']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(srcPath, destPath);
    else fs.copyFileSync(srcPath, destPath);
  }
}

fs.mkdirSync(outDir, { recursive: true });
copyDir(backend, staging);

const isWin = process.platform === 'win32';
if (isWin) {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'inherit' }
  );
} else {
  execSync(`cd "${staging}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
}

fs.rmSync(staging, { recursive: true, force: true });

const sizeMb = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(2);
console.log(`\nReady: ${zipPath} (${sizeMb} MB)`);
console.log('Upload in hPanel → Websites → Add Website → Node.js Apps → Upload.');
