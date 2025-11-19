/**
 * Quick Fix: Add metadata column to conversations table
 * This fixes the iOS coordination error by adding the missing metadata column
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL environment variable is not set');
  console.error('Please set it in your .env file');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function fixMetadataColumn() {
  const client = await pool.connect();

  try {
    console.log('🔧 Fixing conversations table...\n');

    // Add metadata column if it doesn't exist
    const sql = `
      ALTER TABLE conversations
      ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    `;

    await client.query(sql);

    console.log('✅ Successfully added metadata column to conversations table');

    // Verify the column was added
    const checkSql = `
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'conversations'
      AND column_name = 'metadata';
    `;

    const result = await client.query(checkSql);

    if (result.rows.length > 0) {
      console.log('\n✅ Verification successful:');
      console.log('   Column:', result.rows[0].column_name);
      console.log('   Type:', result.rows[0].data_type);
      console.log('   Default:', result.rows[0].column_default);
      console.log('\n🎉 iOS coordination error should now be fixed!');
    } else {
      console.log('\n⚠️  Column not found - this is unexpected');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

fixMetadataColumn();
