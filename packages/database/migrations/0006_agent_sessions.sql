CREATE TABLE IF NOT EXISTS agent_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  bot_id text NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  runtime text NOT NULL,
  external_session_id text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT agent_sessions_runtime_check CHECK (runtime IN ('openai-agents')),
  CONSTRAINT agent_sessions_user_conversation_runtime_unique UNIQUE (user_id, conversation_id, runtime),
  CONSTRAINT agent_sessions_external_runtime_unique UNIQUE (runtime, external_session_id)
);

