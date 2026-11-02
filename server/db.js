require('dotenv').config();
const { Pool, types } = require('pg');

// Keep DATE columns (OID 1082) as 'YYYY-MM-DD' strings instead of JS Date.
// Without this, pg converts DATE to a local-midnight Date and, in a non-UTC
// timezone (e.g. WIB +07:00), the date drifts back one day after JSON encode.
types.setTypeParser(1082, (v) => v);

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgres://kanban:kanban@localhost:5432/kanban',
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

module.exports = pool;