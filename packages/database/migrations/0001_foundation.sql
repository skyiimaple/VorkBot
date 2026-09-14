CREATE TABLE users (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE bots (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  persona text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE conversations (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  bot_id text NOT NULL REFERENCES bots(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE conversation_members (
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE messages (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_type text NOT NULL CHECK (author_type IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE tasks (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  bot_id text NOT NULL REFERENCES bots(id),
  conversation_id text NOT NULL REFERENCES conversations(id),
  message_id text NOT NULL REFERENCES messages(id),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  error_code text,
  last_event_sequence integer NOT NULL DEFAULT 0 CHECK (last_event_sequence >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE task_events (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  sequence integer NOT NULL CHECK (sequence > 0),
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT task_events_task_id_sequence_key UNIQUE (task_id, sequence)
);
