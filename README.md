# Lux Studio — Reply Assistant

Claude-powered auto-reply for Lux Studio, across SMS and email. Deployed as Twilio Serverless Functions, backed by Supabase, with a small review dashboard for anything that isn't clearly routine.

## How it works

- **SMS**: inbound texts to the Lux Studio Twilio number hit `functions/sms.js` (Twilio-signature protected). Outbound replies use the inbound `To` number when available, otherwise `TWILIO_PHONE_NUMBER`.
- **Email**: inbound mail to `devin@luxstudios.shop` is parsed by SendGrid Inbound Parse, relayed through a small Cloudflare Worker (`email-relay-worker.js`, needed because Twilio Functions reject `multipart/form-data`, which SendGrid always sends) to `functions/email-inbound.js`.
- Both paths call Claude (`functions/claude.js`) with a channel-specific persona (`functions/persona.js` for SMS, `functions/persona-email.js` for email) to draft a reply and classify it as `routine` or `needs_review`.
- `routine` + `AUTO_SEND_ENABLED=true` → sent automatically (Twilio for SMS, SendGrid Mail Send API for email).
- `needs_review` → queued in Supabase, shown at `/dashboard` (gated by `DASHBOARD_SECRET`) for manual approve/edit/reject, alongside recent pipeline activity from Supabase.
- Every inbound email also gets forwarded as a copy to `FORWARD_EMAIL` so it's readable in a normal inbox.
- Airbnb inbox replies captured by `airbnb_getter` are written into `reply_assistant_messages` (channel `airbnb`) and appear in dashboard recent activity.

## Deploy

```bash
npm install
TWILIO_SID=... TWILIO_TOKEN=... node deploy.js
```

`deploy.js` talks to the Twilio Serverless REST API directly (no CLI plugin) and reads env vars from `.env` (see `.env.example`) to push to the deployed Function's environment.

## Data

Supabase tables (prefixed `reply_assistant_` to avoid colliding with other tables in the same project): `contacts`, `messages`, `pending_replies`. Schema in `migrations/schema.sql`.

## Persona / boundaries

Edit `functions/persona.js` (SMS) and `functions/persona-email.js` (email) directly — not environment variables, since Twilio Function env values are capped at 450 bytes.

## Not yet built

- Airbnb platform messaging (no official third-party API; would require browser automation, which carries real ToS risk — needs a deliberate decision before building).
- Automatically triggering outreach from newly-discovered leads (this repo only *replies*; it doesn't yet find or cold-pitch leads).
