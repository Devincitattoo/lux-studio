exports.handler = async function (context, event, callback) {
  if (!context.DASHBOARD_SECRET || event.key !== context.DASHBOARD_SECRET) {
    const response = new Twilio.Response();
    response.setStatusCode(403);
    response.setBody('Forbidden — missing or incorrect key');
    return callback(undefined, response);
  }

  const { getPendingReply, resolvePendingReply, insertMessage, updateMessageProviderSid } = require(Runtime.getFunctions()['db'].path);
  const { sendMail } = require(Runtime.getFunctions()['sendgrid'].path);
  const client = context.getTwilioClient();
  const smsFrom = String(context.TWILIO_PHONE_NUMBER || '').trim();

  function resolveSmsDestination(externalId) {
    const to = String(externalId || '').trim();
    if (smsFrom.toLowerCase().startsWith('whatsapp:') && to && !to.toLowerCase().startsWith('whatsapp:')) {
      return `whatsapp:${to}`;
    }
    return to;
  }

  try {
    const item = await getPendingReply(context, event.id);

    if (item && item.status === 'pending') {
      if (event.action === 'approve') {
        const finalBody = (event.edited_reply || '').trim() || item.draft_body;
        if (item.channel === 'sms') {
          if (!smsFrom) throw new Error('Missing TWILIO_PHONE_NUMBER for approved SMS sends.');
          const smsTo = resolveSmsDestination(item.external_id);
          if (!smsTo) throw new Error('Missing destination for approved SMS send.');
          const outboundMessage = await insertMessage(context, item.contact_id, 'outbound', finalBody);
          const sent = await client.messages.create({ to: smsTo, from: smsFrom, body: finalBody });
          await updateMessageProviderSid(context, outboundMessage.id, sent?.sid);
        } else if (item.channel === 'email') {
          const subject = item.inbound_subject || '';
          const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
          const outboundMessage = await insertMessage(context, item.contact_id, 'outbound', finalBody, { subject: replySubject });
          const sendgridSid = await sendMail(context, { to: item.external_id, from: context.FROM_EMAIL, subject: replySubject, text: finalBody });
          await updateMessageProviderSid(context, outboundMessage.id, sendgridSid);
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
  callback(undefined, response);
};
