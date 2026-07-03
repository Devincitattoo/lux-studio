function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderDashboard(pending, key) {
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

  return `<!doctype html>
<html>
<head>
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
  </style>
</head>
<body>
  <h1>Pending replies (${pending.length})</h1>
  ${pending.length === 0 ? '<p class="empty">Nothing waiting on you right now.</p>' : cards}
</body>
</html>`;
}

module.exports = { renderDashboard };
