-- Prefixed with reply_assistant_ to avoid colliding with other tables
-- already living in this Supabase project.
CREATE TABLE IF NOT EXISTS reply_assistant_contacts (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL DEFAULT 'sms',
  external_id TEXT NOT NULL,           -- phone number for sms; will hold thread/email id for other channels later
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);

CREATE TABLE IF NOT EXISTS reply_assistant_messages (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES reply_assistant_contacts(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body TEXT NOT NULL,
  subject TEXT,                        -- email only
  provider_sid TEXT,                   -- Twilio MessageSid, for dedupe/debugging
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reply_assistant_messages_contact ON reply_assistant_messages(contact_id, created_at);

CREATE TABLE IF NOT EXISTS reply_assistant_pending_replies (
  id SERIAL PRIMARY KEY,
  contact_id INTEGER NOT NULL REFERENCES reply_assistant_contacts(id),
  inbound_message_id INTEGER NOT NULL REFERENCES reply_assistant_messages(id),
  draft_body TEXT NOT NULL,
  reasoning TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reply_assistant_pending_status ON reply_assistant_pending_replies(status);
