/**
 * Database Migration Script
 * Runs all SQL migrations in the migrations/ directory
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');

  console.log('🔍 Looking for migrations in:', migrationsDir);

  const client = await pool.connect();

  try {
    // Get list of migration files
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Run migrations in order

    console.log(`📋 Found ${files.length} migration files\n`);

    for (const file of files) {
      console.log(`⏳ Running migration: ${file}`);

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      try {
        await client.query(sql);
        console.log(`✅ Successfully applied: ${file}\n`);
      } catch (error) {
        console.error(`❌ Error in ${file}:`, error.message);
        // Continue with other migrations (some might be already applied)
      }
    }

    console.log('\n🎉 Migration process completed!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations();
