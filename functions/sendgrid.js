async function sendMail(context, { to, from, subject, text }) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${context.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: 'Lux Studio' },
      subject,
      content: [{ type: 'text/plain', value: text }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid send failed: ${res.status} ${body}`);
  }
}

async function forwardCopy(context, { originalFrom, originalTo, subject, text }) {
  const forwardTo = context.FORWARD_EMAIL;
  if (!forwardTo) return;

  await sendMail(context, {
    to: forwardTo,
    from: context.FROM_EMAIL,
    subject: `[Copy] ${subject || '(no subject)'} - from ${originalFrom}`,
    text: `Forwarded copy of an inbound email to ${originalTo}.\nFrom: ${originalFrom}\n\n${text}`,
  });
}

module.exports = { sendMail, forwardCopy };
