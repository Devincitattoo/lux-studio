exports.handler = async function (context, event, callback) {
  if (!context.DASHBOARD_SECRET || event.key !== context.DASHBOARD_SECRET) {
    const response = new Twilio.Response();
    response.setStatusCode(403);
    response.setBody('Forbidden — missing or incorrect key');
    return callback(null, response);
  }

  const { getPendingReply, resolvePendingReply, insertMessage } = require(Runtime.getFunctions()['db'].path);
  const { sendMail } = require(Runtime.getFunctions()['sendgrid'].path);
  const client = context.getTwilioClient();

  try {
    const item = await getPendingReply(context, event.id);

    if (item && item.status === 'pending') {
      if (event.action === 'approve') {
        const finalBody = (event.edited_reply || '').trim() || item.draft_body;
        if (item.channel === 'sms') {
          await client.messages.create({ to: item.external_id, from: context.TWILIO_PHONE_NUMBER, body: finalBody });
          await insertMessage(context, item.contact_id, 'outbound', finalBody);
        } else if (item.channel === 'email') {
          const subject = item.inbound_subject || '';
          const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
          await sendMail(context, { to: item.external_id, from: context.FROM_EMAIL, subject: replySubject, text: finalBody });
          await insertMessage(context, item.contact_id, 'outbound', finalBody, { subject: replySubject });
        }
        await resolvePendingReply(context, item.id, 'approved');
      } else if (event.action === 'reject') {
        await resolvePendingReply(context, item.id, 'rejected');
      }
    }
  } catch (err) {
    console.error('Failed to resolve pending reply:', err);
  }

  const response = new Twilio.Response();
  response.setStatusCode(302);
  response.appendHeader('Location', `/dashboard?key=${encodeURIComponent(event.key)}`);
  callback(null, response);
};
