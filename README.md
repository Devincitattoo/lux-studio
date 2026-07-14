# Lux Studio — Reply Assistant

Venice-powered auto-reply for Lux Studio, running locally as an Express server. Brevo handles email delivery, SQLite stores contacts/messages/pending replies and payments, Venice AI drafts + classifies replies, and Square handles payments.

## How it works

- **Email**: inbound emails to a Brevo-delegated domain hit `POST /email-inbound?key=...` as structured JSON.
- Venice AI (`lib/venice.js`) uses a channel-specific persona (`lib/persona-email.js`) to draft a reply and classify it as `routine` or `needs_review`.
- `routine` + `AUTO_SEND_ENABLED=true` → sent automatically via Brevo.
- `needs_review` → queued in SQLite, shown at `/dashboard?key=...` for manual approve/edit/reject.
- Every inbound email also gets forwarded as a copy to `FORWARD_EMAIL` so it's readable in a normal inbox.
- **Payments**: customers visit `/pay?package=essential` (or `signature`/`estate`) and are redirected to Square Checkout. Square webhooks post to `/square-webhook` and record payments in SQLite.
- **SMS**: the code is wired but disabled for now until you add a Brevo SMS number later.
- **Airbnb**: still handled by `airbnb_getter/` Python scripts, which write to Supabase.

## Database

Local **SQLite** file. Path is set by `DATABASE_PATH` in `.env` (default `./data/lux-studio.db`). The schema is created automatically on first run.

## Run locally

```bash
cp .env.example .env
# fill in .env
npm install
npm run dev
```

The server starts on `http://localhost:3000` (or `PORT`).

## Expose webhooks

Brevo and Square need public URLs. Use a tunnel in development:

```bash
npx ngrok http 3000
```

Then set `BASE_URL` to your ngrok HTTPS URL and configure:
- **Brevo inbound email webhook**: `https://<your-ngrok>/email-inbound?key=YOUR_DASHBOARD_SECRET`
- **Square webhook**: `https://<your-ngrok>/square-webhook`

## Environment variables

See `.env.example`. The key variables are:

| Variable | Purpose |
|---|---|
| `PORT` | Local server port |
| `BASE_URL` | Public URL for redirects and webhooks |
| `DATABASE_PATH` | SQLite file path |
| `VENICE_API_KEY` | Venice AI API key |
| `VENICE_MODEL` | Venice model, defaults to `venice-uncensored` |
| `BREVO_API_KEY` | Brevo v3 API key |
| `BREVO_SMS_SENDER` | Phone number for SMS (disabled for now) |
| `FROM_EMAIL` | Outbound email "from" address |
| `FORWARD_EMAIL` | Inbound email forward copy recipient |
| `SQUARE_ENVIRONMENT` | `sandbox` or `production` |
| `SQUARE_ACCESS_TOKEN` | Square API access token |
| `SQUARE_LOCATION_ID` | Square location ID |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Square webhook signature key |
| `DASHBOARD_SECRET` | Shared secret for all public routes |
| `AUTO_SEND_ENABLED` | Set `true` to auto-send routine replies |

## Dashboard

Open `/dashboard?key=YOUR_DASHBOARD_SECRET` in a browser to approve, edit, or reject queued replies.

## Payments

Visit `/pay?package=essential` to create a Square Checkout link for the Essential package. Replace `essential` with `signature` or `estate`.

## Persona / boundaries

Edit `lib/persona.js` (SMS) and `lib/persona-email.js` (email) directly to change tone, pricing, or auto-send boundaries.

## Note on other components

- `dashboard-worker/` is a separate Cloudflare Worker that reads the same data sources; it is unchanged.
- `airbnb_getter/` still writes to Supabase. If you want to fully remove Supabase from the project, those components need a separate migration.
- SMS sending is inactive until you add a Brevo SMS number and set `BREVO_SMS_SENDER`.
