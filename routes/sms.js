const db = require('../lib/db');
const venice = require('../lib/venice');
const brevo = require('../lib/brevo');

function normalizePhone(raw) {
  return String(raw || '').trim();
}

function resolveOutboundFrom(env, event) {
  const fromNumber = normalizePhone(event.to || event.To || env.BREVO_SMS_SENDER);
  if (!fromNumber) {
    throw new Error('Missing outbound SMS sender. Set BREVO_SMS_SENDER or ensure inbound event.to is present.');
  }
  return fromNumber;
}

async function handleInboundSms(env, event) {
  const body = event.text || event.body || event.message || event.content || '';
  const messageId = event.messageId || event.id || event.msgId || event.MessageSid || '';
  const inboundFrom = normalizePhone(event.from || event.From);
  if (!inboundFrom) throw new Error('Missing from in inbound SMS webhook.');

  const contact = db.getOrCreateContact(env, 'sms', inboundFrom);
  const inboundMessage = db.insertMessage(env, contact.id, 'inbound', body, { providerSid: messageId });

  const history = db.getRecentHistory(env, contact.id);
  const { reply, classification, reasoning } = await venice.draftReply(env, {
    history,
    incomingBody: body,
    channel: 'sms',
    contactId: contact.id,
  });

  const shouldAutoSend = env.AUTO_SEND_ENABLED === 'true' && classification === 'routine';

  if (shouldAutoSend) {
    const providerSid = await brevo.sendSms(env, {
      to: inboundFrom,
      from: resolveOutboundFrom(env, event),
      body: reply,
    });
    db.insertMessage(env, contact.id, 'outbound', reply, { providerSid });
  } else {
    db.createPendingReply(env, contact.id, inboundMessage.id, reply, reasoning);
  }
}

module.exports = { handleInboundSms };
