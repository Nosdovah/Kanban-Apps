-- Agile Kanban schema (idempotent)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  description TEXT        NOT NULL DEFAULT '',
  assignee    TEXT        NOT NULL DEFAULT '',
  priority    TEXT        NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status      TEXT        NOT NULL DEFAULT 'todo'
                CHECK (status IN ('backlog', 'todo', 'inprogress', 'review', 'done')),
  points      INTEGER,
  start_date  DATE,
  due_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks (due_date);

-- Keep updated_at fresh on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();