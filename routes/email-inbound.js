const db = require('../lib/db');
const venice = require('../lib/venice');
const brevo = require('../lib/brevo');

function extractEmail(headerValue) {
  const match = /<([^>]+)>/.exec(headerValue || '');
  return (match ? match[1] : headerValue || '').trim().toLowerCase();
}

function normalizeBrevoInbound(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  const item = items[0];
  if (!item) return null;

  const fromMailbox = item.From;
  const toMailbox = Array.isArray(item.To) ? item.To[0] : null;

  return {
    from: typeof fromMailbox === 'string' ? extractEmail(fromMailbox) : extractEmail(fromMailbox?.Address),
    to: typeof toMailbox === 'string' ? extractEmail(toMailbox) : extractEmail(toMailbox?.Address),
    subject: item.Subject || '(no subject)',
    text: (item.ExtractedMarkdownMessage || item.RawTextBody || item.RawHtmlBody || '').trim(),
    messageId: item.MessageId || '',
  };
}

async function handleInboundEmail(env, event) {
  const payload = normalizeBrevoInbound(event) || {
    from: extractEmail(event.from),
    to: extractEmail(event.to),
    subject: event.subject || '(no subject)',
    text: (event.text || '').trim(),
    messageId: event.messageId || '',
  };

  const senderEmail = payload.from;
  const subject = payload.subject;
  const text = payload.text;

  const contact = db.getOrCreateContact(env, 'email', senderEmail);
  const inboundMessage = db.insertMessage(env, contact.id, 'inbound', text, { subject });

  if (env.FORWARD_EMAIL) {
    try {
      const forwardSubject = `[Copy] ${subject} - from ${senderEmail}`;
      const forwardBody = `Forwarded copy of an inbound email to ${payload.to}.\nFrom: ${senderEmail}\n\n${text}`;
      const forwardContact = db.getOrCreateContact(env, 'email_forward', env.FORWARD_EMAIL.toLowerCase());
      const forwardId = await brevo.sendMail(env, {
        to: env.FORWARD_EMAIL,
        from: env.FROM_EMAIL,
        subject: forwardSubject,
        text: forwardBody,
      });
      db.insertMessage(env, forwardContact.id, 'outbound', forwardBody, {
        subject: forwardSubject,
        providerSid: forwardId,
      });
    } catch (forwardErr) {
      console.error('Failed to send forward copy email:', forwardErr);
    }
  }

  const history = db.getRecentHistory(env, contact.id);
  const { reply, classification, reasoning } = await venice.draftReply(env, {
    history,
    incomingBody: text,
    channel: 'email',
    contactId: contact.id,
  });

  const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
  const shouldAutoSend = env.AUTO_SEND_ENABLED === 'true' && classification === 'routine';

  if (shouldAutoSend) {
    const messageId = await brevo.sendMail(env, {
      to: senderEmail,
      from: env.FROM_EMAIL,
      subject: replySubject,
      text: reply,
    });
    db.insertMessage(env, contact.id, 'outbound', reply, { subject: replySubject, providerSid: messageId });
  } else {
    db.createPendingReply(env, contact.id, inboundMessage.id, reply, reasoning);
  }
}

module.exports = { handleInboundEmail };
