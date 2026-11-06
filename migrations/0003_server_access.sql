-- Given and family names from Google, so sites can greet people properly.
ALTER TABLE users ADD COLUMN given_name TEXT;
ALTER TABLE users ADD COLUMN family_name TEXT;

-- A student's permission for a site's server to read and write that site's folder while they are away.
-- Given only on Teather's own /grant page. revoked_at is set when they withdraw it.
CREATE TABLE site_grants (
  sub TEXT NOT NULL,
  host TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'server',
  granted_at INTEGER NOT NULL,
  revoked_at INTEGER,
  PRIMARY KEY (sub, host)
);

-- Ids of site-server tokens already used, so a captured token can't be replayed. Kept until the token expires.
CREATE TABLE server_jti (
  jti TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Why a sign-in was started: NULL for a plain sign-in, 'server' when it also gives the site's server access.
ALTER TABLE oauth_states ADD COLUMN purpose TEXT;
