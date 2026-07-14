require('dotenv').config();

const express = require('express');
const app = express();

const context = process.env;

const smsRoute = require('./routes/sms');
const emailInboundRoute = require('./routes/email-inbound');
const dashboardRoute = require('./routes/dashboard');
const dashboardActionRoute = require('./routes/dashboard-action');
const payRoute = require('./routes/pay');
const squareWebhookRoute = require('./routes/square-webhook');

function requireKey(req, res, next) {
  const key = req.query.key || req.body.key;
  if (!context.DASHBOARD_SECRET || key !== context.DASHBOARD_SECRET) {
    return res.status(403).send('Forbidden — missing or incorrect key');
  }
  next();
}

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.use(express.static('public'));

app.get('/pay', async (req, res) => {
  try {
    const packageKey = req.query.package || 'essential';
    const link = await payRoute.handlePayRequest(context, packageKey);
    res.redirect(link.url);
  } catch (err) {
    console.error('Failed to create Square payment link:', err);
    res.status(500).send(`Payment setup failed: ${err.message}`);
  }
});

app.get('/payment-success', (req, res) => {
  res.send('Thanks! Your payment is being processed. We\'ll be in touch soon.');
});

app.get('/square-webhook', (req, res) => res.status(200).send('ok'));

app.post('/square-webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const signature = req.headers['x-square-hmacsha256-signature'] || '';
    const body = req.body;

    if (!context.SQUARE_WEBHOOK_SIGNATURE_KEY) {
      const bodyString = Buffer.isBuffer(body) ? body.toString() : String(body || '');
      let challenge;
      try {
        const parsed = JSON.parse(bodyString);
        challenge = parsed.challenge;
      } catch {}
      console.log('Square webhook received without signature key configured:', bodyString.slice(0, 200));
      return res.status(200).send(challenge || 'ok');
    }

    await squareWebhookRoute.handleWebhook(context, body, signature);
    res.status(200).send('ok');
  } catch (err) {
    console.error('Square webhook failed:', err);
    res.status(400).send('webhook rejected');
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/sms', requireKey, async (req, res) => {
  try {
    await smsRoute.handleInboundSms(context, { ...req.query, ...req.body });
    res.status(200).send('<Response/>');
  } catch (err) {
    console.error('Failed to process inbound SMS:', err);
    res.status(200).send('<Response/>');
  }
});

app.post('/email-inbound', requireKey, async (req, res) => {
  try {
    await emailInboundRoute.handleInboundEmail(context, { ...req.query, ...req.body });
    res.status(200).type('text/plain').send('ok');
  } catch (err) {
    console.error('Failed to process inbound email:', err);
    res.status(200).type('text/plain').send('ok');
  }
});

app.get('/dashboard', requireKey, async (req, res) => {
  try {
    const html = await dashboardRoute.renderQueue(context, req.query.key);
    res.status(200).type('text/html').send(html);
  } catch (err) {
    console.error('Failed to load dashboard:', err);
    res.status(500).send('Something went wrong loading the dashboard.');
  }
});

app.get('/api/stats', requireKey, async (req, res) => {
  try {
    const db = require('./lib/db');
    const stats = db.getDashboardStats(context);
    res.json(stats);
  } catch (err) {
    console.error('Failed to load stats API:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/dashboard-action', requireKey, async (req, res) => {
  try {
    await dashboardActionRoute.handleAction(context, { ...req.query, ...req.body });
  } catch (err) {
    console.error('Failed dashboard action:', err);
  }
  res.redirect(dashboardActionRoute.redirectUrl(req));
});

const PORT = context.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lux Studio reply server listening on http://localhost:${PORT}`);
});
