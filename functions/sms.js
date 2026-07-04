// .protected.js: Twilio Runtime validates the request signature automatically
// before this handler runs, so we don't need to check it ourselves.
function normalizePhone(raw) {
  return String(raw || '').trim();
}

function resolveOutboundFrom(context, event) {
  const fromNumber = normalizePhone(event.To || context.TWILIO_PHONE_NUMBER);
  if (!fromNumber) {
    throw new Error('Missing outbound SMS number. Set TWILIO_PHONE_NUMBER or ensure inbound event.To is present.');
  }
  return fromNumber;
}

exports.handler = async function (context, event, callback) {
  const {
    getOrCreateContact,
    insertMessage,
    updateMessageProviderSid,
    getRecentHistory,
    createPendingReply,
  } = require(Runtime.getFunctions()['db'].path);
  const { draftReply } = require(Runtime.getFunctions()['claude'].path);

  const twiml = new Twilio.twiml.MessagingResponse();
  const client = context.getTwilioClient();

  try {
    const { Body, MessageSid } = event;
    const inboundFrom = normalizePhone(event.From);
    if (!inboundFrom) throw new Error('Missing event.From in inbound SMS webhook.');

    const contact = await getOrCreateContact(context, 'sms', inboundFrom);
    const inboundMessage = await insertMessage(context, contact.id, 'inbound', Body, { providerSid: MessageSid });

    const history = await getRecentHistory(context, contact.id);
    const { reply, classification, reasoning } = await draftReply(context, {
      history,
      incomingBody: Body,
      channel: 'sms',
    });

    const shouldAutoSend = context.AUTO_SEND_ENABLED === 'true' && classification === 'routine';

    if (shouldAutoSend) {
      const outboundMessage = await insertMessage(context, contact.id, 'outbound', reply);
      const sent = await client.messages.create({ to: inboundFrom, from: resolveOutboundFrom(context, event), body: reply });
      await updateMessageProviderSid(context, outboundMessage.id, sent?.sid);
    } else {
      await createPendingReply(context, contact.id, inboundMessage.id, reply, reasoning);
    }
  } catch (err) {
    // Log and still ack the webhook — an unhandled failure here should
    // never surface as an error back to the sender.
    console.error('Failed to process inbound SMS:', err);
  }

  callback(undefined, twiml);
};
