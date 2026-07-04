async function sendMail(context, { to, from, subject, text }) {
  const resolvedTo = String(to || '').trim().toLowerCase();
  if (!resolvedTo) {
    throw new Error('Missing email recipient.');
  }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${context.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: resolvedTo }] }],
      from: { email: from, name: 'Lux Studio' },
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid send failed: ${res.status} ${body}`);
  }

  return (res.headers.get('x-message-id') || '').trim();
}

module.exports = { sendMail };
