CREATE TABLE IF NOT EXISTS intake_share_links (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Diagnostic Intake',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMP,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS intake_public_submissions (
  id SERIAL PRIMARY KEY,
  share_link_id INTEGER NOT NULL REFERENCES intake_share_links(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  payload TEXT NOT NULL,
  company_name TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  profile_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intake_share_links_token ON intake_share_links(token);
CREATE INDEX IF NOT EXISTS idx_intake_public_submissions_token ON intake_public_submissions(token);
CREATE INDEX IF NOT EXISTS idx_intake_public_submissions_status ON intake_public_submissions(status);
