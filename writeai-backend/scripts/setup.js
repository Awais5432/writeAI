const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const envPath = path.join(__dirname, '..', '.env');

function run(cmd, cwd = path.join(__dirname, '..')) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('WriteAI setup\n');

if (!fs.existsSync(envPath)) {
  fs.copyFileSync(path.join(__dirname, '..', '.env.example'), envPath);
  console.log('Created .env from .env.example');
}

try {
  run('docker compose up -d', root);
  console.log('Waiting for PostgreSQL...');
  execSync('timeout /t 5 /nobreak >nul 2>&1 || sleep 5', { stdio: 'ignore', shell: true });
} catch (err) {
  console.warn('Docker compose failed — ensure Docker Desktop is running.');
  console.warn(err.message);
}

run('npm run migrate');
run('npm run seed:admin');

console.log('\nSetup complete.');
console.log('Next steps:');
console.log('  1. Edit writeai-backend/.env — add GOOGLE_CLIENT_ID, OPENAI_API_KEY, ADMIN_EMAILS');
console.log('  2. npm run dev');
console.log('  3. Open http://localhost:3000/admin');
console.log('  4. Load writeai-extension/ in chrome://extensions');
