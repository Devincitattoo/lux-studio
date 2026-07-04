// Public (not Twilio-signed, since SendGrid calls this): gated by a shared
// secret query param instead, same as /dashboard.
function extractEmail(headerValue) {
  const match = /<([^>]+)>/.exec(headerValue || '');
  return (match ? match[1] : headerValue || '').trim().toLowerCase();
}

exports.handler = async function (context, event, callback) {
  const twiml = new Twilio.Response();
  twiml.appendHeader('Content-Type', 'text/plain');

  if (!context.DASHBOARD_SECRET || event.key !== context.DASHBOARD_SECRET) {
    twiml.setStatusCode(403);
    twiml.setBody('Forbidden');
    return callback(undefined, twiml);
  }

  const {
    getOrCreateContact,
    insertMessage,
    updateMessageProviderSid,
    getRecentHistory,
    createPendingReply,
  } = require(Runtime.getFunctions()['db'].path);
  const { draftReply } = require(Runtime.getFunctions()['claude'].path);
  const { sendMail } = require(Runtime.getFunctions()['sendgrid'].path);

  try {
    const senderEmail = extractEmail(event.from);
    const subject = event.subject || '(no subject)';
    const text = (event.text || '').trim();

    const contact = await getOrCreateContact(context, 'email', senderEmail);
    const inboundMessage = await insertMessage(context, contact.id, 'inbound', text, { subject });

    if (context.FORWARD_EMAIL) {
      try {
        const forwardSubject = `[Copy] ${subject || '(no subject)'} - from ${event.from}`;
        const forwardBody = `Forwarded copy of an inbound email to ${event.to}.\nFrom: ${event.from}\n\n${text}`;
        const forwardContact = await getOrCreateContact(context, 'email_forward', context.FORWARD_EMAIL.toLowerCase());
        const forwardMessage = await insertMessage(context, forwardContact.id, 'outbound', forwardBody, {
          subject: forwardSubject,
        });
        const forwardSid = await sendMail(context, {
          to: context.FORWARD_EMAIL,
          from: context.FROM_EMAIL,
          subject: forwardSubject,
          text: forwardBody,
        });
        await updateMessageProviderSid(context, forwardMessage.id, forwardSid);
      } catch (forwardErr) {
        console.error('Failed to send forward copy email:', forwardErr);
      }
    }

    const history = await getRecentHistory(context, contact.id);
    const { reply, classification, reasoning } = await draftReply(context, {
      history,
      incomingBody: text,
      channel: 'email',
    });

    const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

    const shouldAutoSend = context.AUTO_SEND_ENABLED === 'true' && classification === 'routine';

    if (shouldAutoSend) {
      const outboundMessage = await insertMessage(context, contact.id, 'outbound', reply, { subject: replySubject });
      const sendgridSid = await sendMail(context, { to: senderEmail, from: context.FROM_EMAIL, subject: replySubject, text: reply });
      await updateMessageProviderSid(context, outboundMessage.id, sendgridSid);
    } else {
      await createPendingReply(context, contact.id, inboundMessage.id, reply, reasoning);
    }
  } catch (err) {
    console.error('Failed to process inbound email:', err);
  }

  twiml.setBody('ok');
  callback(undefined, twiml);
};
