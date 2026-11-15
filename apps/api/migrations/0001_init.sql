-- Migration 0001: apps, api_keys, logs

CREATE TABLE apps (
  id            TEXT    PRIMARY KEY
                        CHECK (length(id) BETWEEN 1 AND 50 AND id NOT GLOB '*[^a-z0-9-]*'),
  display_name  TEXT    NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  created_at    INTEGER NOT NULL,
  disabled_at   INTEGER
);

CREATE TABLE api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id        TEXT    NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  key_hash      TEXT    NOT NULL UNIQUE CHECK (length(key_hash) = 64),
  key_prefix    TEXT    NOT NULL,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  revoked_at    INTEGER
);

CREATE INDEX idx_api_keys_app ON api_keys (app_id);

CREATE TABLE logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id        TEXT    NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  level         TEXT    NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error', 'fatal')),
  event         TEXT    NOT NULL CHECK (length(event) BETWEEN 1 AND 100),
  message       TEXT,
  route         TEXT,
  params        TEXT    CHECK (params IS NULL OR json_valid(params)),
  context       TEXT    CHECK (context IS NULL OR json_valid(context)),
  app_version   TEXT    NOT NULL,
  platform      TEXT    NOT NULL CHECK (platform IN ('web', 'android', 'ios')),
  session_id    TEXT    NOT NULL,
  client_ts     INTEGER NOT NULL,
  received_at   INTEGER NOT NULL
);

CREATE INDEX idx_logs_app_id       ON logs (app_id, id);
CREATE INDEX idx_logs_app_level_id ON logs (app_id, level, id);
CREATE INDEX idx_logs_received_at  ON logs (received_at);
