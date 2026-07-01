# lux-studio

A modular autonomous workflow scaffold for lead discovery, pitch automation, reply monitoring, and stateful tracking.

## What this project contains

- A TypeScript workflow engine that runs discovery, pitch generation, communication dispatch, reply monitoring, and validation.
- A local JSON-backed state store to persist lead and metric history.
- A scheduler for 5-minute reply checks and 30-minute discovery/pitch runs.
- Tests, type checking, and linting support.

## Quick start

1. Install dependencies:

```bash
npm install
```

2. Run the workflow in development mode:

```bash
npm run dev
```

3. Run a single discovery + reply pass and then exit:

```bash
npm run run-once
```

4. Run a dry-run pass without persisting state:

```bash
npm run dry-run
```

5. Live mode and required configuration

The workflow can run in live mode with real lead discovery, email delivery, and reply capture. By default it uses mock/sample data unless you enable live mode.

Set the following environment variables to use live data:

```bash
export LIVE_DISCOVERY=true
export LIVE_MESSAGING=true
export LIVE_REPLIES=true
export LEAD_SOURCE_PROVIDER=apify-airbnb
export APIFY_TOKEN="your-apify-token"
export APIFY_TASK_ID="your-apify-task-id"
export APIFY_DATASET_ID="your-apify-dataset-id"
export APIFY_INPUT='{"query":"luxury vacation rental Miami Beach, Florida"}'
export SENDGRID_API_KEY="your-sendgrid-api-key"
export SENDGRID_SENDER="your-verified-sendgrid-email@example.com"
export REPLY_SOURCE_URL="https://your-reply-endpoint.example.com/replies"
export USE_VIDEO_GENERATION=true
export HIGGSFIELD_API_KEY="your-higgsfield-api-key"
export HIGGSFIELD_PROJECT_ID="your-higgsfield-project-id"
export HIGGSFIELD_MODEL="higgsfield-mcp-video"
export HIGGSFIELD_CALLBACK_URL="https://your-callback.example.com/higgsfield"
```

If any live-mode variable is missing, the workflow will throw a clear error and stop until the live configuration is completed.

6. To enable Stripe payment intent creation, set `STRIPE_SECRET_KEY` before running the workflow.

```bash
export STRIPE_SECRET_KEY="sk_test_..."
npm run run-once
```

7. Build for production:

```bash
npm run build
npm start
```

4. Run checks:

```bash
npm run check
```







