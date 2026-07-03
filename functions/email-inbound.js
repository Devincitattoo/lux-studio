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
    return callback(null, twiml);
  }

  const { getOrCreateContact, insertMessage, getRecentHistory, createPendingReply } = require(Runtime.getFunctions()['db'].path);
  const { draftReply } = require(Runtime.getFunctions()['claude'].path);
  const { sendMail, forwardCopy } = require(Runtime.getFunctions()['sendgrid'].path);

  try {
    const senderEmail = extractEmail(event.from);
    const subject = event.subject || '(no subject)';
    const text = (event.text || '').trim();

    const contact = await getOrCreateContact(context, 'email', senderEmail);
    const inboundMessage = await insertMessage(context, contact.id, 'inbound', text, { subject });

    forwardCopy(context, { originalFrom: event.from, originalTo: event.to, subject, text }).catch((err) =>
      console.error('Failed to forward copy:', err)
    );

    const history = await getRecentHistory(context, contact.id);
    const { reply, classification, reasoning } = await draftReply(context, {
      history,
      incomingBody: text,
      channel: 'email',
    });

    const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

    if (classification === 'routine' && context.AUTO_SEND_ENABLED === 'true') {
      await sendMail(context, { to: senderEmail, from: context.FROM_EMAIL, subject: replySubject, text: reply });
      await insertMessage(context, contact.id, 'outbound', reply);
    } else {
      await createPendingReply(context, contact.id, inboundMessage.id, reply, reasoning);
    }
  } catch (err) {
    console.error('Failed to process inbound email:', err);
  }

  twiml.setBody('ok');
  callback(null, twiml);
};
