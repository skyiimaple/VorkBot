-- Durable routines and execution history.

CREATE TABLE IF NOT EXISTS routines (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  bot_id text NOT NULL REFERENCES bots(id),
  conversation_id text NOT NULL UNIQUE REFERENCES conversations(id),
  name text NOT NULL,
  prompt text NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('once', 'cron')),
  cron_expression text,
  run_at timestamptz,
  timezone text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'error', 'deleted')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_run_status text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK (
    (trigger_type = 'once' AND run_at IS NOT NULL AND cron_expression IS NULL) OR
    (trigger_type = 'cron' AND cron_expression IS NOT NULL AND run_at IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS routine_runs (
  id text PRIMARY KEY,
  routine_id text NOT NULL REFERENCES routines(id),
  user_id text NOT NULL REFERENCES users(id),
  task_id text REFERENCES tasks(id) ON DELETE SET NULL,
  scheduled_for timestamptz NOT NULL,
  claimed_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'queued', 'running', 'completed', 'failed', 'cancelled', 'waiting_approval', 'paused', 'uncertain', 'skipped_overlap', 'publication_failed')),
  missed_count integer NOT NULL DEFAULT 0 CHECK (missed_count >= 0),
  error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (routine_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS routines_due_idx ON routines (next_run_at, id)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS routine_runs_schedule_unique ON routine_runs (routine_id, scheduled_for);
CREATE INDEX IF NOT EXISTS routine_runs_history_idx ON routine_runs (routine_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS routine_runs_task_unique ON routine_runs (task_id) WHERE task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION sync_routine_run_task_status() RETURNS trigger AS $$
BEGIN
  UPDATE routine_runs SET status = NEW.status, updated_at = NEW.updated_at WHERE task_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS routine_runs_task_status_trigger ON tasks;
CREATE TRIGGER routine_runs_task_status_trigger
AFTER UPDATE OF status ON tasks
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION sync_routine_run_task_status();
