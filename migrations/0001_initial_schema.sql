-- Raw feedback storage
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  user TEXT,
  link TEXT,
  processed BOOLEAN DEFAULT 0,
  instant_alert_sent INTEGER DEFAULT 0,
  classification_severity TEXT,
  classification_confidence REAL
);

-- Analysis results from Workers AI
CREATE TABLE IF NOT EXISTS feedback_analysis (
  feedback_id TEXT PRIMARY KEY,
  sentiment TEXT,
  urgency_score REAL,
  theme TEXT,
  severity TEXT,
  revenue_risk INTEGER DEFAULT 0,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id)
);

-- Clusters (deduplicated groups)
CREATE TABLE IF NOT EXISTS clusters (
  cluster_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  representative_feedback_id TEXT,
  representative_feedback TEXT,
  count INTEGER DEFAULT 1,
  top_sources TEXT,
  created_at INTEGER,
  category TEXT,
  severity TEXT,
  centroid TEXT, -- embedding vector (stored as JSON string)
  first_seen INTEGER,
  last_seen INTEGER,
  summary TEXT,
  suggested_action TEXT,
  user_impact TEXT,
  priority_score REAL,
  sentiment_score REAL,
  -- Fix tracking fields
  fix_status TEXT DEFAULT 'open',
  fix_deployed_date INTEGER,
  fix_deployed_version TEXT,
  rollout_period_days INTEGER DEFAULT 7,
  original_severity TEXT,
  current_severity TEXT,
  reports_before_fix INTEGER,
  reports_after_fix INTEGER,
  fix_notes TEXT,
  FOREIGN KEY (representative_feedback_id) REFERENCES feedback(id)
);

-- Cluster membership
CREATE TABLE IF NOT EXISTS cluster_members (
  cluster_id TEXT,
  feedback_id TEXT,
  PRIMARY KEY (cluster_id, feedback_id),
  FOREIGN KEY (cluster_id) REFERENCES clusters(cluster_id),
  FOREIGN KEY (feedback_id) REFERENCES feedback(id)
);

-- Generated digests
CREATE TABLE IF NOT EXISTS digests (
  digest_id TEXT PRIMARY KEY,
  generated_at INTEGER NOT NULL,
  top_issues TEXT NOT NULL,
  summary TEXT,
  sent_to_telegram INTEGER DEFAULT 0,
  telegram_message_id TEXT
);

-- Instant alerts log
CREATE TABLE IF NOT EXISTS instant_alerts (
  alert_id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  severity TEXT NOT NULL,
  category TEXT,
  message TEXT,
  FOREIGN KEY (feedback_id) REFERENCES feedback(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(timestamp);
CREATE INDEX IF NOT EXISTS idx_feedback_processed ON feedback(processed);
CREATE INDEX IF NOT EXISTS idx_clusters_created_at ON clusters(created_at);
CREATE INDEX IF NOT EXISTS idx_clusters_priority_score ON clusters(priority_score);
CREATE INDEX IF NOT EXISTS idx_clusters_last_seen ON clusters(last_seen);
CREATE INDEX IF NOT EXISTS idx_clusters_fix_status ON clusters(fix_status);
CREATE INDEX IF NOT EXISTS idx_clusters_fix_deployed_date ON clusters(fix_deployed_date);
CREATE INDEX IF NOT EXISTS idx_digests_generated_at ON digests(generated_at);
CREATE INDEX IF NOT EXISTS idx_instant_alerts_sent_at ON instant_alerts(sent_at);
