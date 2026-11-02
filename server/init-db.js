// Applies schema.sql against the configured PostgreSQL database (idempotent).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db:init] schema applied OK');
  await pool.end();
})().catch((err) => {
  console.error('[db:init] FAILED:', err.message);
  process.exit(1);
});