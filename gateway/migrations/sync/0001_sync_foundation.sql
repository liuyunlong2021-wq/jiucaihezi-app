CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL CHECK (length(user_id) > 0),
  name TEXT NOT NULL CHECK (length(name) > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_projects_user_updated
  ON projects(user_id, updated_at DESC);

CREATE TABLE text_files (
  project_id TEXT NOT NULL,
  path TEXT NOT NULL CHECK (length(path) > 0),
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (project_id, path),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_text_files_project_updated
  ON text_files(project_id, updated_at DESC);

CREATE TABLE sync_mutations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  mutation_id TEXT NOT NULL UNIQUE CHECK (length(mutation_id) > 0),
  project_id TEXT NOT NULL,
  device_id TEXT NOT NULL CHECK (length(device_id) > 0),
  path TEXT NOT NULL CHECK (length(path) > 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_sync_mutations_project_seq
  ON sync_mutations(project_id, seq);
