CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  department TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL,
  push_subscription TEXT,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  caller_id TEXT NOT NULL REFERENCES users(id),
  callee_id TEXT NOT NULL REFERENCES users(id),
  started_at INTEGER NOT NULL,
  answered_at INTEGER,
  ended_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('ringing','answered','rejected','missed','ended')),
  duration INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
