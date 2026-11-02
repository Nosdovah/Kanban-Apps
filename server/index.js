require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const { ensureSchema } = require('./migrate');

const app = express();
const PORT = process.env.PORT || 3000;

const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const STATUSES = new Set(['backlog', 'todo', 'inprogress', 'review', 'done']);
const SPRINT_STATUSES = new Set(['planned', 'active', 'done']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.use(cors());
app.use(express.json());

/* ---------- helpers ---------- */

function nullIfEmpty(v) {
  return v === '' || v === undefined || v === null ? null : v;
}

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
    sprintId: row.sprint_id,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseTask(body) {
  const title = (body.title ?? '').toString().trim();
  if (!title) return { error: 'Judul tugas (title) wajib diisi.' };

  let points = null;
  if (body.points != null && body.points !== '') {
    const n = Number(body.points);
    if (Number.isFinite(n)) points = n;
  }

  const sprintId = nullIfEmpty(body.sprintId ?? body.sprint_id ?? null);
  if (sprintId != null && !UUID_RE.test(sprintId)) return { error: 'Sprint ID tidak valid.' };

  return {
    title,
    description: (body.description ?? body.desc ?? '').toString().trim(),
    assignee: (body.assignee ?? '').toString().trim(),
    priority: PRIORITIES.has(body.priority) ? body.priority : 'medium',
    status: STATUSES.has(body.status) ? body.status : 'todo',
    points,
    start: nullIfEmpty(body.start ?? body.start_date ?? null),
    due: nullIfEmpty(body.due ?? body.due_date ?? null),
    sprintId,
  };
}

function parseSprint(body) {
  const name = (body.name ?? '').toString().trim();
  if (!name) return { error: 'Nama sprint wajib diisi.' };
  return {
    name,
    goal: (body.goal ?? '').toString().trim(),
    status: SPRINT_STATUSES.has(body.status) ? body.status : 'planned',
    start: nullIfEmpty(body.start ?? body.start_date ?? null),
    due: nullIfEmpty(body.due ?? body.end_date ?? body.endDate ?? null),
  };
}

function computeCompletedAt(newStatus, oldStatus, oldCompletedAt) {
  if (newStatus === 'done') {
    return oldStatus === 'done' && oldCompletedAt ? oldCompletedAt : new Date();
  }
  return null;
}

const INSERT_SQL = `
  INSERT INTO tasks (title, description, assignee, priority, status, points, start_date, due_date, sprint_id, completed_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  RETURNING *`;

const UPDATE_SQL = `
  UPDATE tasks
  SET title = $1, description = $2, assignee = $3, priority = $4, status = $5,
      points = $6, start_date = $7, due_date = $8, sprint_id = $9, completed_at = $10
  WHERE id = $11
  RETURNING *`;

function values(t, completedAt) {
  return [t.title, t.description, t.assignee, t.priority, t.status, t.points, t.start, t.due, t.sprintId, completedAt];
}

function sprintToCamel(row) {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    status: row.status,
    start: row.start_date,
    due: row.end_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskCount: row.task_count != null ? Number(row.task_count) : undefined,
    totalPoints: row.total_points != null ? Number(row.total_points) : undefined,
    donePoints: row.done_points != null ? Number(row.done_points) : undefined,
  };
}

/* ---------- health ---------- */

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

/* ---------- tasks ---------- */

app.get('/api/tasks', async (_req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    res.json(rows.map(toCamel));
  } catch (e) { next(e); }
});

app.post('/api/tasks', async (req, res, next) => {
  try {
    const t = parseTask(req.body);
    if (t.error) return res.status(400).json({ error: t.error });
    const completedAt = computeCompletedAt(t.status, null, null);
    const { rows } = await pool.query(INSERT_SQL, values(t, completedAt));
    res.status(201).json(toCamel(rows[0]));
  } catch (e) { next(e); }
});

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
      const completedAt = computeCompletedAt(t.status, null, null);
      const { rows } = await client.query(INSERT_SQL, values(t, completedAt));
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

app.get('/api/tasks/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    res.json(toCamel(rows[0]));
  } catch (e) { next(e); }
});

app.put('/api/tasks/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const existing = await pool.query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });

    const t = parseTask(req.body);
    if (t.error) return res.status(400).json({ error: t.error });
    const completedAt = computeCompletedAt(t.status, existing.rows[0].status, existing.rows[0].completed_at);
    const { rows } = await pool.query(UPDATE_SQL, [...values(t, completedAt), req.params.id]);
    res.json(toCamel(rows[0]));
  } catch (e) { next(e); }
});

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
      sprintId: req.body.sprintId ?? req.body.sprint_id ?? row.sprint_id,
    });
    if (merged.error) return res.status(400).json({ error: merged.error });

    const completedAt = computeCompletedAt(merged.status, row.status, row.completed_at);
    const { rows } = await pool.query(UPDATE_SQL, [...values(merged, completedAt), req.params.id]);
    res.json(toCamel(rows[0]));
  } catch (e) { next(e); }
});

app.delete('/api/tasks/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const { rows } = await pool.query('DELETE FROM tasks WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Tugas tidak ditemukan.' });
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { next(e); }
});

/* ---------- sprints ---------- */

app.get('/api/sprints', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*,
        COUNT(t.id)::int AS task_count,
        COALESCE(SUM(t.points), 0)::int AS total_points,
        COALESCE(SUM(t.points) FILTER (WHERE t.status = 'done'), 0)::int AS done_points
      FROM sprints s
      LEFT JOIN tasks t ON t.sprint_id = s.id
      GROUP BY s.id
      ORDER BY s.created_at DESC`);
    res.json(rows.map(sprintToCamel));
  } catch (e) { next(e); }
});

app.post('/api/sprints', async (req, res, next) => {
  try {
    const s = parseSprint(req.body);
    if (s.error) return res.status(400).json({ error: s.error });
    const { rows } = await pool.query(
      'INSERT INTO sprints (name, goal, status, start_date, end_date) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [s.name, s.goal, s.status, s.start, s.due]
    );
    res.status(201).json(sprintToCamel(rows[0]));
  } catch (e) { next(e); }
});

app.get('/api/sprints/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const sres = await pool.query('SELECT * FROM sprints WHERE id = $1', [req.params.id]);
    if (!sres.rows.length) return res.status(404).json({ error: 'Sprint tidak ditemukan.' });

    const tres = await pool.query('SELECT * FROM tasks WHERE sprint_id = $1 ORDER BY created_at', [req.params.id]);
    res.json({ ...sprintToCamel(sres.rows[0]), tasks: tres.rows.map(toCamel) });
  } catch (e) { next(e); }
});

app.patch('/api/sprints/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const existing = await pool.query('SELECT * FROM sprints WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Sprint tidak ditemukan.' });

    const row = existing.rows[0];
    const s = parseSprint({
      name: req.body.name ?? row.name,
      goal: req.body.goal ?? row.goal,
      status: req.body.status ?? row.status,
      start: req.body.start ?? req.body.start_date ?? row.start_date,
      due: req.body.due ?? req.body.end_date ?? row.end_date,
    });
    if (s.error) return res.status(400).json({ error: s.error });

    const { rows } = await pool.query(
      'UPDATE sprints SET name = $1, goal = $2, status = $3, start_date = $4, end_date = $5 WHERE id = $6 RETURNING *',
      [s.name, s.goal, s.status, s.start, s.due, req.params.id]
    );
    res.json(sprintToCamel(rows[0]));
  } catch (e) { next(e); }
});

app.delete('/api/sprints/:id', async (req, res, next) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'ID tidak valid.' });
    const { rows } = await pool.query('DELETE FROM sprints WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Sprint tidak ditemukan.' });
    res.json({ ok: true, id: rows[0].id });
  } catch (e) { next(e); }
});

/* ---------- static frontend + error handler ---------- */

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, _req, res, _next) => {
  console.error('[api]', err.message);
  if (err.code === '23503') return res.status(400).json({ error: 'Referensi tidak ditemukan (sprint tidak ada).' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Nilai input tidak valid (UUID/format).' });
  if (err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'Format tanggal tidak valid.' });
  res.status(500).json({ error: err.message || 'Terjadi kesalahan internal.' });
});

(async function boot() {
  try {
    await ensureSchema();
    console.log('[boot] schema applied OK (idempotent — data never dropped)');
  } catch (e) {
    console.error('[boot] schema apply failed (server tetap berjalan; /api/health akan report):', e.message);
  }
  app.listen(PORT, () => {
    console.log(`Kanban API berjalan di http://localhost:${PORT}`);
  });
})();