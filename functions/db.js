const { createClient } = require('@supabase/supabase-js');

let client;
function getClient(context) {
  if (!client) {
    client = createClient(context.SUPABASE_URL, context.SUPABASE_SECRET_KEY);
  }
  return client;
}

async function getOrCreateContact(context, channel, externalId) {
  const db = getClient(context);

  const { data: existing, error: selectErr } = await db
    .from('reply_assistant_contacts')
    .select('*')
    .eq('channel', channel)
    .eq('external_id', externalId)
    .maybeSingle();
  if (selectErr) throw selectErr;
  if (existing) return existing;

  const { data: inserted, error: insertErr } = await db
    .from('reply_assistant_contacts')
    .insert({ channel, external_id: externalId })
    .select()
    .single();
  if (insertErr) throw insertErr;
  return inserted;
}

async function insertMessage(context, contactId, direction, body, options = {}) {
  const safeProviderSid = options.providerSid === undefined ? '' : String(options.providerSid);
  const safeSubject = options.subject === undefined ? '' : String(options.subject);
  const db = getClient(context);
  const { data, error } = await db
    .from('reply_assistant_messages')
    .insert({ contact_id: contactId, direction, body, provider_sid: safeProviderSid, subject: safeSubject })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateMessageProviderSid(context, messageId, providerSid) {
  const safeProviderSid = providerSid === undefined ? '' : String(providerSid);
  const db = getClient(context);
  const { error } = await db
    .from('reply_assistant_messages')
    .update({ provider_sid: safeProviderSid })
    .eq('id', messageId);
  if (error) throw error;
}

async function getRecentHistory(context, contactId, limit = 20) {
  const db = getClient(context);
  const { data, error } = await db
    .from('reply_assistant_messages')
    .select('direction, body, created_at')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.reverse();
}

async function createPendingReply(context, contactId, inboundMessageId, draftBody, reasoning) {
  const safeReasoning = reasoning === undefined ? '' : String(reasoning);
  const db = getClient(context);
  const { data, error } = await db
    .from('reply_assistant_pending_replies')
    .insert({ contact_id: contactId, inbound_message_id: inboundMessageId, draft_body: draftBody, reasoning: safeReasoning })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listPendingReplies(context) {
  const db = getClient(context);
  const { data, error } = await db
    .from('reply_assistant_pending_replies')
    .select('*, reply_assistant_contacts(display_name, external_id), reply_assistant_messages!inbound_message_id(body, subject)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;

  return data.map((row) => ({
    ...row,
    display_name: row.reply_assistant_contacts?.display_name,
    external_id: row.reply_assistant_contacts?.external_id,
    inbound_body: row.reply_assistant_messages?.body,
    inbound_subject: row.reply_assistant_messages?.subject,
  }));
}

async function listRecentMessages(context, limit = 25) {
  const db = getClient(context);
  const { data, error } = await db
    .from('reply_assistant_messages')
    .select('id, direction, body, subject, provider_sid, created_at, reply_assistant_contacts(channel, external_id, display_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return data.map((row) => ({
    ...row,
    channel: row.reply_assistant_contacts?.channel || 'unknown',
    external_id: row.reply_assistant_contacts?.external_id || '',
    display_name: row.reply_assistant_contacts?.display_name || '',
  }));
}

async function getPendingReply(context, id) {
  const db = getClient(context);
  const { data, error } = await db
    .from('reply_assistant_pending_replies')
    .select('*, reply_assistant_contacts(external_id, channel), reply_assistant_messages!inbound_message_id(subject)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;

  return {
    ...data,
    external_id: data.reply_assistant_contacts?.external_id,
    channel: data.reply_assistant_contacts?.channel,
    inbound_subject: data.reply_assistant_messages?.subject,
  };
}

async function resolvePendingReply(context, id, status) {
  const db = getClient(context);
  const { error } = await db
    .from('reply_assistant_pending_replies')
    .update({ status, resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

module.exports = {
  getOrCreateContact,
  insertMessage,
  updateMessageProviderSid,
  getRecentHistory,
  createPendingReply,
  listPendingReplies,
  listRecentMessages,
  getPendingReply,
  resolvePendingReply,
};
