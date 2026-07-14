-- Dashboard expansion: lead statuses, AI cost tracking, video jobs, interventions

-- Lead status tracking (existing stage column remains for internal scraper state)
ALTER TABLE airbnb_leads ADD COLUMN status TEXT DEFAULT 'new';
ALTER TABLE airbnb_leads ADD COLUMN last_inbound_at DATETIME;
ALTER TABLE airbnb_leads ADD COLUMN last_outbound_at DATETIME;
ALTER TABLE airbnb_leads ADD COLUMN unresponsive INTEGER DEFAULT 0;
ALTER TABLE airbnb_leads ADD COLUMN video_job_id INTEGER REFERENCES video_jobs(id);

-- AI usage / cost log (Venice chat completions)
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES reply_assistant_contacts(id),
  channel TEXT,
  model TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_contact ON ai_usage_logs(contact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage_logs(created_at);

-- Video generation jobs and cost tracking
CREATE TABLE IF NOT EXISTS video_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES airbnb_leads(id),
  listing_id TEXT,
  photo_indices TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','processing','completed','failed','sent','received')),
  cost REAL DEFAULT 0,
  venice_queue_id TEXT,
  file_path TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  received_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_lead ON video_jobs(lead_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_created ON video_jobs(created_at);

-- Human intervention requests
CREATE TABLE IF NOT EXISTS interventions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER REFERENCES reply_assistant_contacts(id),
  lead_id INTEGER REFERENCES airbnb_leads(id),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);
CREATE INDEX IF NOT EXISTS idx_interventions_status ON interventions(status);
CREATE INDEX IF NOT EXISTS idx_interventions_created ON interventions(created_at);
