require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const STATUSES = new Set(['backlog', 'todo', 'inprogress', 'review', 'done']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.use(cors());
app.use(express.json());

/* ---------- helpers ---------- */

// snake_case DB row -> camelCase API object
function toCamel(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assignee: row.assignee,
    priority: row.priority,
    status: row.status,
    points: row.points,
    start: row.start_date,
    due: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Validate + normalize a task payload. Returns { error } or clean fields.
function parseTask(body) {
  const title = (body.title ?? '').toString().trim();
  if (!title) return { error: 'Judul tugas (title) wajib diisi.' };

  let points = null;
  if (body.points != null && body.points !== '') {
    const n = Number(body.points);
    if (Number.isFinite(n)) points = n;
  }

  const nullIfEmpty = (v) => (v === '' || v === undefined || v === null ? null : v);

  return {
    title,
    description: (body.description ?? body.desc ?? '').toString().trim(),
    assignee: (body.assignee ?? '').toString().trim(),
    priority: PRIORITIES.has(body.priority) ? body.priority : 'medium',
    status: STATUSES.has(body.status) ? body.status : 'todo',
    points,
    start: nullIfEmpty(body.start ?? body.start_date ?? null),
    due: nullIfEmpty(body.due ?? body.due_date ?? null),
  };
}

const INSERT_SQL = `
  INSERT INTO tasks (title, description, assignee, priority, status, points, start_date, due_date)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING *`;

const UPDATE_SQL = `
  UPDATE tasks
  SET title = $1, description = $2, assignee = $3, priority = $4,
      status = $5, points = $6, start_date = $7, due_date = $8
  WHERE id = $9
  RETURNING *`;

function values(t) {
  return [t.title, t.description, t.assignee, t.priority, t.status, t.points, t.start, t.due];
}

/* ---------- routes ---------- */

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// List all tasks (newest first)
app.get('/api/tasks', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(rows.map(toCamel));
  } catch (e) { next(e); }
});

// Create one task
app.post('/api/tasks', async (req, res, next) => {
  try {
    const t = parseTask(req.body);
    if (t.error) return res.status(400).json({ error: t.error });
    const { rows } = await pool.query(INSERT_SQL, values(t));
    res.status(201).json(toCamel(rows[0]));
  } catch (e) { next(e); }
});

// Bulk create (used by sample data / import)
app.post('/api/tasks/bulk', async (req, res, next) => {
  const items = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'Payload harus berupa array.' });

  const client = await pool.connect();
  const created = [];
  try {
    await client.query('BEGIN');
    for (let i = 0; i < items.length; i++) {
      const t = parseTask(items[i]);
      if (t.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `${t.error} (index ${i})` });
      }
      const { rows } = await client.query(INSERT_SQL, values(t));
      created.push(toCamel(rows[0]));
    }
    await client.query('COMMIT');
    res.status(201).json(created);
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

// Get one task
app.get('/api/tasks/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    res.json(toCamel(rows[0]));
  } catch (e) { next(e); }
});

// Full update (PUT) — replace all editable fields
app.put('/api/tasks/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const t = parseTask(req.body);
    if (t.error) return res.status(400).json({ error: t.error });
    const { rows } = await pool.query(UPDATE_SQL, [...values(t), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    res.json(toCamel(rows[0]));
  } catch (e) { next(e); }
});

// Partial update (PATCH) — used by drag & drop to change status only
app.patch('/api/tasks/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });

    const row = existing.rows[0];
    const merged = parseTask({
      title: req.body.title ?? row.title,
      description: req.body.description ?? row.description,
      assignee: req.body.assignee ?? row.assignee,
      priority: req.body.priority ?? row.priority,
      status: req.body.status ?? row.status,
      points: req.body.points ?? row.points,
      start: req.body.start ?? req.body.start_date ?? row.start_date,
      due: req.body.due ?? req.body.due_date ?? row.due_date,
    });
    if (merged.error) return res.status(400).json({ error: merged.error });

    const { rows } = await pool.query(UPDATE_SQL, [...values(merged), req.params.id]);
    res.json(toCamel(rows[0]));
  } catch (e) { next(e); }
});

// Delete one task
app.delete('/api/tasks/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const { rows } = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { next(e); }
});

/* ---------- static frontend + error handler ---------- */

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, _req, res, _next) => {
  console.error('[api]', err.message);
  res.status(500).json({ error: err.message || 'Terjadi kesalahan internal.' });
});

app.listen(PORT, () => {
  console.log(`Kanban API berjalan di http://localhost:${PORT}`);
});