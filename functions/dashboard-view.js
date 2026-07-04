function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function channelLabel(channel) {
  if (channel === 'sms') return 'SMS';
  if (channel === 'email') return 'Email';
  if (channel === 'email_forward') return 'Email Forward';
  if (channel === 'airbnb') return 'Airbnb';
  return channel || 'Unknown';
}

function formatActor(message) {
  return message.display_name || message.external_id || 'Unknown';
}

function renderDashboard({ pending, recentMessages, key }) {
  const cards = pending
    .map(
      (item) => `
    <div class="card">
      <div class="meta">${escapeHtml(item.display_name || item.external_id)} · ${new Date(item.created_at).toLocaleString()}${item.inbound_subject ? ' · ' + escapeHtml(item.inbound_subject) : ''}</div>
      <div class="incoming">${escapeHtml(item.inbound_body)}</div>
      <form method="post" action="/dashboard-action">
        <input type="hidden" name="key" value="${escapeHtml(key)}" />
        <input type="hidden" name="id" value="${item.id}" />
        <textarea name="edited_reply">${escapeHtml(item.draft_body)}</textarea>
        ${item.reasoning ? `<div class="reasoning">Why it was queued: ${escapeHtml(item.reasoning)}</div>` : ''}
        <div class="actions">
          <button type="submit" name="action" value="approve" class="approve">Approve &amp; Send</button>
          <button type="submit" name="action" value="reject" class="reject">Reject</button>
        </div>
      </form>
    </div>`
    )
    .join('\n');

  const inboundCount = recentMessages.filter((m) => m.direction === 'inbound').length;
  const outboundCount = recentMessages.filter((m) => m.direction === 'outbound').length;
  const activityRows = recentMessages
    .map(
      (message) => `<tr>
      <td>${new Date(message.created_at).toLocaleString()}</td>
      <td>${escapeHtml(channelLabel(message.channel))}</td>
      <td>${escapeHtml(message.direction)}</td>
      <td>${escapeHtml(formatActor(message))}</td>
      <td>${escapeHtml(message.subject || '')}</td>
      <td>${escapeHtml((message.body || '').slice(0, 140))}</td>
    </tr>`
    )
    .join('\n');

  return `<!doctype html>
<html>
  <meta charset="utf-8" />
  <title>Reply Assistant — Review Queue</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #222; }
    h1 { font-size: 20px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .meta { color: #666; font-size: 13px; margin-bottom: 8px; }
    .incoming { background: #f6f6f6; border-radius: 6px; padding: 10px; margin-bottom: 10px; white-space: pre-wrap; }
    textarea { width: 100%; box-sizing: border-box; min-height: 80px; font-family: inherit; font-size: 14px; padding: 8px; }
    .reasoning { color: #888; font-size: 12px; margin: 6px 0 10px; }
    .actions { display: flex; gap: 8px; }
    button { padding: 8px 16px; border-radius: 6px; border: 1px solid #ccc; cursor: pointer; font-size: 14px; }
    .approve { background: #1a7f37; color: white; border-color: #1a7f37; }
    .reject { background: white; }
    .empty { color: #888; }
    .summary { display: flex; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .pill { border: 1px solid #ddd; border-radius: 999px; padding: 6px 12px; font-size: 13px; background: #fafafa; }
    .section-title { margin: 24px 0 10px; font-size: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; border-bottom: 1px solid #eee; padding: 8px 6px; vertical-align: top; }
    th { color: #666; font-weight: 600; }
  </style>
<body>
  <h1>Reply Assistant Dashboard</h1>
  <div class="summary">
    <div class="pill">Pending replies: ${pending.length}</div>
    <div class="pill">Recent inbound: ${inboundCount}</div>
    <div class="pill">Recent outbound: ${outboundCount}</div>
    <div class="pill">Recent total: ${recentMessages.length}</div>
  </div>

  <h2 class="section-title">Pending replies</h2>
  ${pending.length === 0 ? '<p class="empty">Nothing waiting on you right now.</p>' : cards}

  <h2 class="section-title">Recent pipeline activity</h2>
  ${
    recentMessages.length === 0
      ? '<p class="empty">No message activity yet.</p>'
      : `<table>
    <thead>
      <tr>
        <th>When</th>
        <th>Channel</th>
        <th>Direction</th>
        <th>Contact</th>
        <th>Subject</th>
        <th>Body</th>
      </tr>
    </thead>
    <tbody>
      ${activityRows}
    </tbody>
  </table>`
  }
</body>
</html>`;
}

module.exports = { renderDashboard };
