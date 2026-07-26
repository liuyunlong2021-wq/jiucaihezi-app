CREATE UNIQUE INDEX idx_sync_mutations_project_path_revision
  ON sync_mutations(project_id, path, revision);
