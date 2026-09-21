-- Phase 3: approvals, memories, skill drafts, model credentials.
-- Idempotent so local/test databases can re-apply safely.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'tasks'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%cancelled%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('queued', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled'));

CREATE TABLE IF NOT EXISTS approvals (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  action jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL,
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS memories (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  bot_id text NOT NULL REFERENCES bots(id),
  kind text NOT NULL CHECK (kind IN ('identity', 'fact', 'working')),
  content text NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('normal', 'sensitive')),
  source_task_id text REFERENCES tasks(id),
  superseded_by text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_proposals (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  bot_id text NOT NULL REFERENCES bots(id),
  task_id text NOT NULL REFERENCES tasks(id),
  name text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft')) DEFAULT 'draft',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS model_credentials (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  provider text NOT NULL,
  api_key text NOT NULL,
  base_url text,
  model text,
  updated_at timestamptz NOT NULL,
  UNIQUE (user_id, provider)
);
