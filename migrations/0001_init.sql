-- Students who have connected Google Drive. Refresh and access tokens are AES-GCM encrypted.
CREATE TABLE users (
  sub TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  refresh_enc TEXT,
  access_enc TEXT,
  access_expires INTEGER,
  data TEXT NOT NULL DEFAULT '{}',   -- JSON: folder/file ids, README versions, warnings
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One row per signed-in site per browser. Only the SHA-256 of the token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  sub TEXT NOT NULL,
  host TEXT NOT NULL,
  origin TEXT NOT NULL,
  manage INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_user ON sessions (sub, host);

-- In-flight Google sign-ins (10 minutes).
CREATE TABLE oauth_states (
  nonce TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  host TEXT NOT NULL,
  manage INTEGER NOT NULL DEFAULT 0,
  poll_id TEXT,
  expires_at INTEGER NOT NULL
);

-- Sign-in results waiting for the site page to collect them (2 minutes, read once).
CREATE TABLE handoffs (
  poll_id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
