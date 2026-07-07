#!/usr/bin/env node
/**
 * Zip writeai-backend for Hostinger Node.js upload (hPanel → Node.js Apps → Upload).
 * Usage: node scripts/zip-hostinger-node.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const backend = path.join(__dirname, '..', 'writeai-backend');
const outDir = path.join(__dirname, '..', 'deploy');
const zipPath = path.join(outDir, 'writeai-backend.zip');

fs.mkdirSync(outDir, { recursive: true });
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

const isWin = process.platform === 'win32';

if (isWin) {
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${backend}\\*' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'inherit' }
  );
} else {
  execSync(`cd "${backend}" && zip -r "${zipPath}" . -x "node_modules/*" -x ".env"`, { stdio: 'inherit' });
}

console.log(`\nReady: ${zipPath}`);
console.log('Upload this zip in hPanel → Websites → Add Website → Node.js Apps → Upload.');
