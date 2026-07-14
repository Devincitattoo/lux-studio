const db = require('../lib/db');
const brevo = require('../lib/brevo');
const venice = require('../lib/venice');

function redirectUrl(req) {
  const key = req.body?.key || req.query?.key || '';
  return `/dashboard?key=${encodeURIComponent(key)}`;
}

async function sendApprovedReply(env, item, finalBody) {
  if (item.channel === 'sms') {
    const smsFrom = String(env.BREVO_SMS_SENDER || '').trim();
    if (!smsFrom) throw new Error('Missing BREVO_SMS_SENDER for approved SMS sends.');
    const smsTo = String(item.external_id || '').trim();
    if (!smsTo) throw new Error('Missing destination for approved SMS send.');
    const providerSid = await brevo.sendSms(env, { to: smsTo, from: smsFrom, body: finalBody });
    db.insertMessage(env, item.contact_id, 'outbound', finalBody, { providerSid });
  } else if (item.channel === 'email') {
    const subject = item.inbound_subject || '';
    const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
    const messageId = await brevo.sendMail(env, {
      to: item.external_id,
      from: env.FROM_EMAIL,
      subject: replySubject,
      text: finalBody,
    });
    db.insertMessage(env, item.contact_id, 'outbound', finalBody, { subject: replySubject, providerSid: messageId });
  } else {
    throw new Error(`Unsupported channel for send: ${item.channel}`);
  }
}

async function forceAiReply(env, contactId, inboundBody) {
  const conn = db.getDb(env);
  const contactRow = conn.prepare('SELECT * FROM reply_assistant_contacts WHERE id = ?').get(contactId);
  if (!contactRow) throw new Error('Contact not found');

  const history = db.getRecentHistory(env, contactId);
  const incoming = inboundBody || history.filter((m) => m.direction === 'inbound').pop()?.body || '';
  if (!incoming) throw new Error('No incoming message to reply to');

  const { reply, classification, reasoning } = await venice.draftReply(env, {
    history,
    incomingBody: incoming,
    channel: contactRow.channel,
    contactId,
  });

  if (contactRow.channel === 'sms') {
    const smsFrom = String(env.BREVO_SMS_SENDER || '').trim();
    if (!smsFrom) throw new Error('Missing BREVO_SMS_SENDER');
    const providerSid = await brevo.sendSms(env, { to: contactRow.external_id, from: smsFrom, body: reply });
    db.insertMessage(env, contactId, 'outbound', reply, { providerSid });
  } else if (contactRow.channel === 'email') {
    const lastInboundSubject = conn.prepare('SELECT subject FROM reply_assistant_messages WHERE contact_id = ? AND direction = ? ORDER BY created_at DESC LIMIT 1').get(contactId, 'inbound')?.subject || '';
    const replySubject = lastInboundSubject.toLowerCase().startsWith('re:') ? lastInboundSubject : `Re: ${lastInboundSubject}`;
    const messageId = await brevo.sendMail(env, {
      to: contactRow.external_id,
      from: env.FROM_EMAIL,
      subject: replySubject,
      text: reply,
    });
    db.insertMessage(env, contactId, 'outbound', reply, { subject: replySubject, providerSid: messageId });
  } else {
    throw new Error(`Force reply not implemented for channel ${contactRow.channel}`);
  }

  return { reply, classification, reasoning };
}

async function handleAction(env, event) {
  const action = event.action;

  // Legacy / current pending-reply approval flow
  if (action === 'approve' || action === 'reject') {
    const item = db.getPendingReply(env, event.id);
    if (item && item.status === 'pending') {
      if (action === 'approve') {
        const finalBody = (event.edited_reply || '').trim() || item.draft_body;
        await sendApprovedReply(env, item, finalBody);
      }
      db.resolvePendingReply(env, item.id, action === 'approve' ? 'approved' : 'rejected');
    }
    return;
  }

  if (action === 'force_ai_reply') {
    const contactId = parseInt(event.contact_id, 10);
    if (!contactId) throw new Error('Missing contact_id');
    await forceAiReply(env, contactId, event.inbound_body || '');
    return;
  }

  if (action === 'update_lead_status') {
    const threadId = event.thread_id;
    const status = event.status;
    if (!threadId || !status) throw new Error('Missing thread_id or status');
    db.updateAirbnbLeadStatus(env, threadId, status);
    return;
  }

  if (action === 'request_intervention') {
    const leadId = event.lead_id ? parseInt(event.lead_id, 10) : null;
    const contactId = event.contact_id ? parseInt(event.contact_id, 10) : null;
    const reason = event.reason || 'Manual intervention requested from dashboard';
    db.createIntervention(env, { leadId, contactId, reason });
    return;
  }

  if (action === 'resolve_intervention') {
    const id = parseInt(event.id, 10);
    if (!id) throw new Error('Missing intervention id');
    db.resolveIntervention(env, id);
    return;
  }

  throw new Error(`Unknown dashboard action: ${action}`);
}

module.exports = { handleAction, redirectUrl };
