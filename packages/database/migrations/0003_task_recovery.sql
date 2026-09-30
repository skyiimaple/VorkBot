-- Task pause, checkpoint, retry, and uncertain side-effect recovery.
-- Idempotent so existing local databases can re-apply safely.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pause_requested_at timestamptz;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

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
  CHECK (status IN ('queued', 'running', 'waiting_approval', 'paused', 'uncertain', 'completed', 'failed', 'cancelled'));

DO $$ BEGIN
  ALTER TABLE tasks ADD CONSTRAINT tasks_retry_count_check CHECK (retry_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS task_checkpoints (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  version integer NOT NULL CHECK (version > 0),
  state_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (task_id, version)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  turn integer NOT NULL CHECK (turn >= 0),
  attempt integer NOT NULL CHECK (attempt >= 0),
  action_json jsonb NOT NULL,
  risk text NOT NULL CHECK (risk IN ('safe', 'side_effect')),
  status text NOT NULL CHECK (status IN ('prepared', 'executing', 'succeeded', 'failed', 'uncertain')),
  observation text,
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (task_id, turn, attempt)
);

CREATE INDEX IF NOT EXISTS tasks_recovery_scan_idx ON tasks (status, next_retry_at);
CREATE INDEX IF NOT EXISTS tool_calls_recovery_scan_idx ON tool_calls (task_id, status, risk);
