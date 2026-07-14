const Database = require('better-sqlite3');
const path = require('node:path');
const fs = require('node:fs');

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reply_assistant_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'sms',
  external_id TEXT NOT NULL,
  display_name TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (channel, external_id)
);

CREATE TABLE IF NOT EXISTS reply_assistant_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES reply_assistant_contacts(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT NOT NULL,
  subject TEXT,
  provider_sid TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reply_assistant_messages_contact ON reply_assistant_messages(contact_id, created_at);

CREATE TABLE IF NOT EXISTS reply_assistant_pending_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES reply_assistant_contacts(id),
  inbound_message_id INTEGER NOT NULL REFERENCES reply_assistant_messages(id),
  draft_body TEXT NOT NULL,
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_reply_assistant_pending_status ON reply_assistant_pending_replies(status);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  square_payment_id TEXT UNIQUE,
  square_order_id TEXT,
  package_name TEXT,
  amount INTEGER,
  currency TEXT,
  customer_email TEXT,
  status TEXT,
  raw_event TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_square_payment_id ON payments(square_payment_id);

CREATE TABLE IF NOT EXISTS airbnb_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id TEXT NOT NULL UNIQUE,
  listing_id TEXT,
  area TEXT,
  stage TEXT NOT NULL DEFAULT 'outreach_sent',
  status TEXT DEFAULT 'new',
  contact_id INTEGER REFERENCES reply_assistant_contacts(id),
  last_inbound_at DATETIME,
  last_outbound_at DATETIME,
  unresponsive INTEGER DEFAULT 0,
  video_job_id INTEGER REFERENCES video_jobs(id),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_airbnb_leads_stage ON airbnb_leads(stage);

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
`;

function normalizeOptionalText(value) {
  return value == undefined ? '' : String(value);
}

function columnExists(conn, table, column) {
  const info = conn.prepare(`PRAGMA table_info(${table})`).all();
  return info.some((row) => row.name === column);
}

function migrateDb(conn) {
  // Add columns that may be missing from older databases
  const columns = [
    { table: 'airbnb_leads', column: 'status', type: "TEXT DEFAULT 'new'" },
    { table: 'airbnb_leads', column: 'last_inbound_at', type: 'DATETIME' },
    { table: 'airbnb_leads', column: 'last_outbound_at', type: 'DATETIME' },
    { table: 'airbnb_leads', column: 'unresponsive', type: 'INTEGER DEFAULT 0' },
    { table: 'airbnb_leads', column: 'video_job_id', type: 'INTEGER REFERENCES video_jobs(id)' },
  ];
  for (const { table, column, type } of columns) {
    if (!columnExists(conn, table, column)) {
      try {
        conn.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`).run();
      } catch (e) {
        console.error(`Migration warning: failed to add ${table}.${column}:`, e.message);
      }
    }
  }
  // Index added after column migration so it does not break on older DBs.
  try {
    conn.prepare('CREATE INDEX IF NOT EXISTS idx_airbnb_leads_status ON airbnb_leads(status)').run();
  } catch (e) {
    console.error('Migration warning: failed to create status index:', e.message);
  }
}

function getDb(env) {
  if (!db) {
    const dbPath = env.DATABASE_PATH || './data/lux-studio.db';
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    migrateDb(db);
  }
  return db;
}

function getOrCreateContact(env, channel, externalId) {
  const conn = getDb(env);
  const select = conn.prepare(
    'SELECT * FROM reply_assistant_contacts WHERE channel = ? AND external_id = ?'
  );
  const existing = select.get(channel, externalId);
  if (existing) return existing;

  const insert = conn.prepare(
    'INSERT INTO reply_assistant_contacts (channel, external_id) VALUES (?, ?) RETURNING *'
  );
  return insert.get(channel, externalId);
}

function insertMessage(env, contactId, direction, body, options = {}) {
  const conn = getDb(env);
  const stmt = conn.prepare(
    'INSERT INTO reply_assistant_messages (contact_id, direction, body, subject, provider_sid) VALUES (?, ?, ?, ?, ?) RETURNING *'
  );
  const row = stmt.get(
    contactId,
    direction,
    body,
    normalizeOptionalText(options.subject),
    normalizeOptionalText(options.providerSid)
  );
  // Keep lead activity timestamps in sync for dashboard stats
  const leadUpdate = conn.prepare(
    'UPDATE airbnb_leads SET last_inbound_at = CASE WHEN ? = ? THEN ? ELSE last_inbound_at END, last_outbound_at = CASE WHEN ? = ? THEN ? ELSE last_outbound_at END, updated_at = CURRENT_TIMESTAMP WHERE contact_id = ?'
  );
  leadUpdate.run(
    direction,
    'inbound',
    row.created_at,
    direction,
    'outbound',
    row.created_at,
    contactId
  );
  return row;
}

function updateMessageProviderSid(env, messageId, providerSid) {
  const conn = getDb(env);
  const stmt = conn.prepare(
    'UPDATE reply_assistant_messages SET provider_sid = ? WHERE id = ?'
  );
  stmt.run(normalizeOptionalText(providerSid), messageId);
}

function getRecentHistory(env, contactId, limit = 20) {
  const conn = getDb(env);
  const stmt = conn.prepare(
    'SELECT direction, body, created_at FROM reply_assistant_messages WHERE contact_id = ? ORDER BY created_at DESC LIMIT ?'
  );
  return stmt.all(contactId, limit).reverse();
}

function createPendingReply(env, contactId, inboundMessageId, draftBody, reasoning) {
  const conn = getDb(env);
  const stmt = conn.prepare(
    'INSERT INTO reply_assistant_pending_replies (contact_id, inbound_message_id, draft_body, reasoning) VALUES (?, ?, ?, ?) RETURNING *'
  );
  return stmt.get(contactId, inboundMessageId, draftBody, normalizeOptionalText(reasoning));
}

function listPendingReplies(env) {
  const conn = getDb(env);
  const stmt = conn.prepare(`
    SELECT
      p.*,
      c.display_name,
      c.external_id,
      c.channel,
      m.body AS inbound_body,
      m.subject AS inbound_subject
    FROM reply_assistant_pending_replies p
    JOIN reply_assistant_contacts c ON c.id = p.contact_id
    JOIN reply_assistant_messages m ON m.id = p.inbound_message_id
    WHERE p.status = 'pending'
    ORDER BY p.created_at ASC
  `);
  return stmt.all();
}

function listRecentMessages(env, limit = 25) {
  const conn = getDb(env);
  const stmt = conn.prepare(`
    SELECT
      m.id,
      m.direction,
      m.body,
      m.subject,
      m.provider_sid,
      m.created_at,
      c.channel,
      c.external_id,
      c.display_name
    FROM reply_assistant_messages m
    JOIN reply_assistant_contacts c ON c.id = m.contact_id
    ORDER BY m.created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

function getPendingReply(env, id) {
  const conn = getDb(env);
  const stmt = conn.prepare(`
    SELECT
      p.*,
      c.external_id,
      c.channel,
      m.subject AS inbound_subject
    FROM reply_assistant_pending_replies p
    JOIN reply_assistant_contacts c ON c.id = p.contact_id
    JOIN reply_assistant_messages m ON m.id = p.inbound_message_id
    WHERE p.id = ?
  `);
  return stmt.get(id);
}

function resolvePendingReply(env, id, status) {
  const conn = getDb(env);
  const stmt = conn.prepare(
    "UPDATE reply_assistant_pending_replies SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?"
  );
  stmt.run(status, id);
}

function recordPayment(env, payment) {
  const conn = getDb(env);
  const stmt = conn.prepare(`
    INSERT INTO payments
      (square_payment_id, square_order_id, package_name, amount, currency, customer_email, status, raw_event)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(square_payment_id) DO UPDATE SET
      status = excluded.status,
      raw_event = excluded.raw_event
    RETURNING *
  `);
  return stmt.get(
    normalizeOptionalText(payment.squarePaymentId),
    normalizeOptionalText(payment.squareOrderId),
    normalizeOptionalText(payment.packageName),
    payment.amount || null,
    normalizeOptionalText(payment.currency),
    normalizeOptionalText(payment.customerEmail),
    normalizeOptionalText(payment.status),
    normalizeOptionalText(payment.rawEvent)
  );
}

function listPayments(env, limit = 50) {
  const conn = getDb(env);
  const stmt = conn.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit);
}

function ensureAirbnbContact(env, threadId, displayName) {
  const conn = getDb(env);
  const select = conn.prepare('SELECT * FROM reply_assistant_contacts WHERE channel = ? AND external_id = ?');
  const existing = select.get('airbnb', threadId);
  if (existing) return existing;

  const insert = conn.prepare('INSERT INTO reply_assistant_contacts (channel, external_id, display_name) VALUES (?, ?, ?) RETURNING *');
  return insert.get('airbnb', threadId, normalizeOptionalText(displayName || `Airbnb host ${threadId}`));
}

function logAirbnbMessage(env, threadId, body, direction = 'inbound', subject = null, displayName = null) {
  const conn = getDb(env);
  const contact = ensureAirbnbContact(env, threadId, displayName);
  const stmt = conn.prepare(
    'INSERT INTO reply_assistant_messages (contact_id, direction, body, subject, provider_sid) VALUES (?, ?, ?, ?, ?) RETURNING *'
  );
  return stmt.get(
    contact.id,
    direction,
    body,
    normalizeOptionalText(subject),
    `airbnb-${Date.now()}`
  );
}

function ensureAirbnbLead(env, threadId, listingId, area, stage = 'outreach_sent', displayName = null) {
  const conn = getDb(env);
  const contact = ensureAirbnbContact(env, threadId, displayName);

  const select = conn.prepare('SELECT * FROM airbnb_leads WHERE thread_id = ?');
  const existing = select.get(threadId);
  if (existing) return existing;

  const insert = conn.prepare(
    'INSERT INTO airbnb_leads (thread_id, listing_id, area, stage, status, contact_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING *'
  );
  return insert.get(
    threadId,
    normalizeOptionalText(listingId),
    normalizeOptionalText(area),
    stage,
    'new',
    contact.id
  );
}

function updateAirbnbLeadStage(env, threadId, stage) {
  const conn = getDb(env);
  const stmt = conn.prepare('UPDATE airbnb_leads SET stage = ?, updated_at = CURRENT_TIMESTAMP WHERE thread_id = ?');
  stmt.run(stage, threadId);
}

function updateAirbnbLeadStatus(env, threadId, status) {
  const conn = getDb(env);
  const stmt = conn.prepare('UPDATE airbnb_leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE thread_id = ?');
  stmt.run(status, threadId);
}

function listAirbnbLeads(env, limit = 100) {
  const conn = getDb(env);
  const stmt = conn.prepare(`
    SELECT l.*, c.display_name, c.external_id, c.channel
    FROM airbnb_leads l
    JOIN reply_assistant_contacts c ON c.id = l.contact_id
    ORDER BY l.updated_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

function getAirbnbLeadByContactId(env, contactId) {
  const conn = getDb(env);
  return conn.prepare('SELECT * FROM airbnb_leads WHERE contact_id = ?').get(contactId);
}

function getAirbnbLeadByThreadId(env, threadId) {
  const conn = getDb(env);
  return conn.prepare('SELECT * FROM airbnb_leads WHERE thread_id = ?').get(threadId);
}

// ── AI usage / cost tracking ─────────────────────────────────────────────────

function recordAiUsage(env, { contactId, channel, model, promptTokens, completionTokens, totalTokens, cost }) {
  const conn = getDb(env);
  const stmt = conn.prepare(`
    INSERT INTO ai_usage_logs (contact_id, channel, model, prompt_tokens, completion_tokens, total_tokens, cost)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
  `);
  return stmt.get(
    contactId || null,
    normalizeOptionalText(channel),
    normalizeOptionalText(model),
    promptTokens || 0,
    completionTokens || 0,
    totalTokens || 0,
    cost || 0
  );
}

function getAiCostSummary(env) {
  const conn = getDb(env);
  const row = conn.prepare('SELECT COALESCE(SUM(cost),0) AS total, COUNT(*) AS calls FROM ai_usage_logs').get();
  return row || { total: 0, calls: 0 };
}

// ── Video job tracking ───────────────────────────────────────────────────────

function recordVideoJob(env, { leadId, listingId, photoIndices, status = 'pending', cost = 0, veniceQueueId, filePath }) {
  const conn = getDb(env);
  const stmt = conn.prepare(`
    INSERT INTO video_jobs (lead_id, listing_id, photo_indices, status, cost, venice_queue_id, file_path)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *
  `);
  const job = stmt.get(
    leadId || null,
    normalizeOptionalText(listingId),
    Array.isArray(photoIndices) ? photoIndices.join(',') : normalizeOptionalText(photoIndices),
    status,
    cost || 0,
    normalizeOptionalText(veniceQueueId),
    normalizeOptionalText(filePath)
  );
  if (leadId) {
    conn.prepare('UPDATE airbnb_leads SET video_job_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(job.id, leadId);
  }
  return job;
}

function updateVideoJobStatus(env, id, status, filePath = null) {
  const conn = getDb(env);
  const now = new Date().toISOString();
  const extra = [];
  const params = [status];
  if (filePath) {
    extra.push('file_path = ?');
    params.push(filePath);
  }
  if (status === 'sent') {
    extra.push('sent_at = ?');
    params.push(now);
  }
  if (status === 'received') {
    extra.push('received_at = ?');
    params.push(now);
  }
  params.push(id);
  const setClause = ['status = ?', 'updated_at = CURRENT_TIMESTAMP', ...extra].join(', ');
  conn.prepare(`UPDATE video_jobs SET ${setClause} WHERE id = ?`).run(...params);
}

function listVideoJobs(env, limit = 100) {
  const conn = getDb(env);
  return conn.prepare(`
    SELECT v.*, l.thread_id, c.display_name, c.external_id
    FROM video_jobs v
    LEFT JOIN airbnb_leads l ON l.id = v.lead_id
    LEFT JOIN reply_assistant_contacts c ON c.id = l.contact_id
    ORDER BY v.updated_at DESC
    LIMIT ?
  `).all(limit);
}

function getVideoCostSummary(env) {
  const conn = getDb(env);
  return conn.prepare(`
    SELECT
      COALESCE(SUM(cost),0) AS total,
      COUNT(*) AS total_jobs,
      SUM(CASE WHEN status IN ('pending','queued','processing') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status = 'received' THEN 1 ELSE 0 END) AS received,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM video_jobs
  `).get();
}

// ── Interventions ────────────────────────────────────────────────────────────

function createIntervention(env, { contactId, leadId, reason }) {
  const conn = getDb(env);
  const stmt = conn.prepare(`
    INSERT INTO interventions (contact_id, lead_id, reason, status)
    VALUES (?, ?, ?, 'open') RETURNING *
  `);
  return stmt.get(contactId || null, leadId || null, normalizeOptionalText(reason));
}

function resolveIntervention(env, id) {
  const conn = getDb(env);
  conn.prepare("UPDATE interventions SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

function listInterventions(env, status = null, limit = 100) {
  const conn = getDb(env);
  if (status) {
    return conn.prepare(`
      SELECT i.*, c.display_name, c.external_id, l.thread_id
      FROM interventions i
      LEFT JOIN reply_assistant_contacts c ON c.id = i.contact_id
      LEFT JOIN airbnb_leads l ON l.id = i.lead_id
      WHERE i.status = ?
      ORDER BY i.created_at DESC
      LIMIT ?
    `).all(status, limit);
  }
  return conn.prepare(`
    SELECT i.*, c.display_name, c.external_id, l.thread_id
    FROM interventions i
    LEFT JOIN reply_assistant_contacts c ON c.id = i.contact_id
    LEFT JOIN airbnb_leads l ON l.id = i.lead_id
    ORDER BY i.created_at DESC
    LIMIT ?
  `).all(limit);
}

// ── Dashboard stats ──────────────────────────────────────────────────────────

function getDashboardStats(env) {
  const conn = getDb(env);

  const leadStatusCounts = conn.prepare(`
    SELECT status, COUNT(*) AS n FROM airbnb_leads GROUP BY status
  `).all();
  const leadStageCounts = conn.prepare(`
    SELECT stage, COUNT(*) AS n FROM airbnb_leads GROUP BY stage
  `).all();

  const statusCount = (status) => {
    const found = leadStatusCounts.find((r) => r.status === status);
    return found ? found.n : 0;
  };
  const stageCount = (stage) => {
    const found = leadStageCounts.find((r) => r.stage === stage);
    return found ? found.n : 0;
  };

  const totalLeads = conn.prepare('SELECT COUNT(*) AS n FROM airbnb_leads').get().n;
  const messagedLeads = conn.prepare(`
    SELECT COUNT(DISTINCT l.id) AS n
    FROM airbnb_leads l
    JOIN reply_assistant_messages m ON m.contact_id = l.contact_id
    WHERE m.direction = 'outbound'
  `).get().n;

  const paymentRow = conn.prepare(`
    SELECT COALESCE(SUM(amount),0) AS revenue_cents, COUNT(*) AS payments
    FROM payments
    WHERE status IN ('COMPLETED', 'APPROVED', 'PAID')
  `).get();
  const totalRevenue = (paymentRow.revenue_cents || 0) / 100;

  const aiSummary = getAiCostSummary(env);
  const videoSummary = getVideoCostSummary(env);
  const totalCost = (aiSummary.total || 0) + (videoSummary.total || 0);
  const roi = totalCost > 0 ? (((totalRevenue - totalCost) / totalCost) * 100).toFixed(1) : '0.0';

  const pendingReplies = conn.prepare("SELECT COUNT(*) AS n FROM reply_assistant_pending_replies WHERE status = 'pending'").get().n;
  const openInterventions = conn.prepare("SELECT COUNT(*) AS n FROM interventions WHERE status = 'open'").get().n;

  const messages = conn.prepare(`
    SELECT direction, COUNT(*) AS n
    FROM reply_assistant_messages
    GROUP BY direction
  `).all();
  const inboundCount = messages.find((m) => m.direction === 'inbound')?.n || 0;
  const outboundCount = messages.find((m) => m.direction === 'outbound')?.n || 0;

  return {
    totalLeads,
    messagedLeads,
    newLeads: statusCount('new'),
    repliedLeads: statusCount('replied'),
    pendingLeads: statusCount('pending'),
    unresponsiveLeads: statusCount('unresponsive') + conn.prepare("SELECT COUNT(*) AS n FROM airbnb_leads WHERE unresponsive = 1").get().n,
    pendingApprovalVideo: statusCount('pending_approval_video'),
    paidLeads: statusCount('paid'),
    waitingProduct: statusCount('waiting_product'),
    productReceived: statusCount('product_received'),
    waitingThankyou: statusCount('waiting_thankyou'),
    thankyouReceived: statusCount('thankyou_received'),
    doneLeads: statusCount('done'),
    stages: {
      outreachSent: stageCount('outreach_sent'),
      pitched: stageCount('pitched'),
      closing: stageCount('closing'),
      purchased: stageCount('purchased'),
      videoSent: stageCount('video_sent'),
      done: stageCount('done'),
    },
    messages: { inbound: inboundCount, outbound: outboundCount },
    pendingReplies,
    openInterventions,
    revenue: {
      total: totalRevenue,
      payments: paymentRow.payments || 0,
    },
    costs: {
      aiTotal: aiSummary.total || 0,
      aiCalls: aiSummary.calls || 0,
      videoTotal: videoSummary.total || 0,
      videoPending: videoSummary.pending || 0,
      videoCompleted: videoSummary.completed || 0,
      videoSent: videoSummary.sent || 0,
      videoReceived: videoSummary.received || 0,
      videoFailed: videoSummary.failed || 0,
      total: totalCost,
    },
    roi,
  };
}

module.exports = {
  getDb,
  getOrCreateContact,
  insertMessage,
  updateMessageProviderSid,
  getRecentHistory,
  createPendingReply,
  listPendingReplies,
  listRecentMessages,
  getPendingReply,
  resolvePendingReply,
  recordPayment,
  listPayments,
  ensureAirbnbContact,
  logAirbnbMessage,
  ensureAirbnbLead,
  updateAirbnbLeadStage,
  updateAirbnbLeadStatus,
  listAirbnbLeads,
  getAirbnbLeadByContactId,
  getAirbnbLeadByThreadId,
  recordAiUsage,
  getAiCostSummary,
  recordVideoJob,
  updateVideoJobStatus,
  listVideoJobs,
  getVideoCostSummary,
  createIntervention,
  resolveIntervention,
  listInterventions,
  getDashboardStats,
};
