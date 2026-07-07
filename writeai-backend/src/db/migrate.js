require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('./postgres');

async function migrate() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  for (const file of files) {
    const { rows } = await db.query(
      'SELECT filename FROM schema_migrations WHERE filename = $1',
      [file]
    );

    if (rows.length) {
      console.log(`Skipping ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Applying ${file}...`);

    await db.query('BEGIN');
    try {
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await db.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }
  }

  console.log('Migrations complete.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
