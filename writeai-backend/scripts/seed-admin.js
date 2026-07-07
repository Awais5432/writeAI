require('dotenv').config();

const { upsertAdmin } = require('../src/services/panelAuth');

async function seed() {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const displayName = process.env.ADMIN_DISPLAY_NAME || 'WriteAI Admin';

  if (!process.env.ADMIN_PASSWORD) {
    console.warn('Warning: using default password "admin123". Set ADMIN_PASSWORD in .env');
  }

  const admin = await upsertAdmin(username, password, displayName);
  console.log(`Panel admin ready: ${admin.username} (${admin.id})`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
