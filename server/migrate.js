// Idempotent schema bootstrap: applies schema.sql without ever dropping or
// truncating data. Safe to run on every boot (and on every redeploy), so a
// `git push` that redeploys the app only ever ADDs missing columns/tables —
// existing rows are untouched.
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { ensureSchema };