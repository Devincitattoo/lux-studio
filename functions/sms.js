// .protected.js: Twilio Runtime validates the request signature automatically
// before this handler runs, so we don't need to check it ourselves.
exports.handler = async function (context, event, callback) {
  const { getOrCreateContact, insertMessage, getRecentHistory, createPendingReply } = require(Runtime.getFunctions()['db'].path);
  const { draftReply } = require(Runtime.getFunctions()['claude'].path);

  const twiml = new Twilio.twiml.MessagingResponse();
  const client = context.getTwilioClient();

  try {
    const { From, Body, MessageSid } = event;

    const contact = await getOrCreateContact(context, 'sms', From);
    const inboundMessage = await insertMessage(context, contact.id, 'inbound', Body, { providerSid: MessageSid });

    const history = await getRecentHistory(context, contact.id);
    const { reply, classification, reasoning } = await draftReply(context, {
      history,
      incomingBody: Body,
      channel: 'sms',
    });

    if (classification === 'routine' && context.AUTO_SEND_ENABLED === 'true') {
      await client.messages.create({ to: From, from: context.TWILIO_PHONE_NUMBER, body: reply });
      await insertMessage(context, contact.id, 'outbound', reply);
    } else {
      await createPendingReply(context, contact.id, inboundMessage.id, reply, reasoning);
    }
  } catch (err) {
    // Log and still ack the webhook — an unhandled failure here should
    // never surface as an error back to the sender.
    console.error('Failed to process inbound SMS:', err);
  }

  callback(null, twiml);
};
