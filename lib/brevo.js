const BREVO_API_BASE = 'https://api.brevo.com/v3';

async function brevoFetch(path, apiKey, { method = 'GET', body } = {}) {
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured');

  const res = await fetch(`${BREVO_API_BASE}${path}`, {
    method,
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brevo ${method} ${path} failed: ${res.status} ${text}`);
  }

  return res;
}

async function sendSms(context, { to, from, body }) {
  const apiKey = context.BREVO_API_KEY;
  const sender = from || context.BREVO_SMS_SENDER;
  if (!sender) throw new Error('Missing BREVO_SMS_SENDER for outbound SMS.');
  if (!to) throw new Error('Missing recipient for outbound SMS.');

  const res = await brevoFetch('/transactionalSMS/send', apiKey, {
    method: 'POST',
    body: {
      sender,
      recipient: to,
      content: body,
      type: 'transactional',
    },
  });

  const data = await res.json().catch(() => ({}));
  return String(data.messageId || data.reference || data.smsId || JSON.stringify(data));
}

async function sendMail(context, { to, from, subject, text }) {
  const apiKey = context.BREVO_API_KEY;
  if (!to) throw new Error('Missing recipient for outbound email.');

  const res = await brevoFetch('/smtp/email', apiKey, {
    method: 'POST',
    body: {
      sender: { email: from || context.FROM_EMAIL, name: 'Lux Studio' },
      to: [{ email: to.toLowerCase() }],
      subject,
      textContent: text,
    },
  });

  const data = await res.json().catch(() => ({}));
  return String(data.messageId || '');
}

module.exports = { sendSms, sendMail };
