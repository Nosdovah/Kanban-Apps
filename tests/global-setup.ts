import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

// Runs once before the test suite: apply schema + reset the test database so
// runs are deterministic and never touch the dev/production database.
export default async function globalSetup() {
  const url =
    process.env.TEST_DATABASE_URL ||
    'postgres://kanban:kanban@localhost:5432/kanban_test';
  const pool = new Pool({ connectionString: url });

  const schema = fs.readFileSync(
    path.join(process.cwd(), 'server', 'schema.sql'),
    'utf8'
  );
  await pool.query(schema);
  await pool.query('TRUNCATE tasks, sprints');
  await pool.end();
}