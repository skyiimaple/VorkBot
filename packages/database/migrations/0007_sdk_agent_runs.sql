CREATE TABLE sdk_agent_runs (
  task_id text PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  state_text text NOT NULL,
  history_json jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE sdk_tool_links (
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  call_id text NOT NULL,
  tool_call_id text NOT NULL REFERENCES tool_calls(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, call_id)
);
