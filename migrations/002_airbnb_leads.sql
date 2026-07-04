-- Airbnb lead tracking table
-- Linked to reply_assistant_contacts (channel='airbnb') so the dashboard
-- can show every lead, their current stage, and full message history.

CREATE TABLE IF NOT EXISTS airbnb_leads (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   text        UNIQUE NOT NULL,
  listing_id  text,
  stage       text        NOT NULL DEFAULT 'outreach_sent',
  area        text,
  contact_id  integer     REFERENCES reply_assistant_contacts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS airbnb_leads_stage_idx      ON airbnb_leads(stage);
CREATE INDEX IF NOT EXISTS airbnb_leads_contact_idx    ON airbnb_leads(contact_id);
CREATE INDEX IF NOT EXISTS airbnb_leads_updated_idx    ON airbnb_leads(updated_at DESC);
