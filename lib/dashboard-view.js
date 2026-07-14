function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function channelLabel(channel) {
  if (channel === 'sms') return 'SMS';
  if (channel === 'email') return 'Email';
  if (channel === 'email_forward') return 'Email Forward';
  if (channel === 'airbnb') return 'Airbnb';
  return channel || 'Unknown';
}

function statusColor(status) {
  const map = {
    new: '#60A5FA',
    messaged: '#C8A96E',
    replied: '#22D3EE',
    pending: '#F59E0B',
    unresponsive: '#6B7280',
    pending_approval_video: '#A78BFA',
    paid: '#10B981',
    waiting_product: '#F472B6',
    product_received: '#34D399',
    waiting_thankyou: '#FB923C',
    thankyou_received: '#4ADE80',
    done: '#22C55E',
    queued: '#F59E0B',
    processing: '#A78BFA',
    completed: '#10B981',
    failed: '#EF4444',
    sent: '#3B82F6',
    received: '#22C55E',
  };
  return map[status] || '#888';
}

function stageLabel(stage) {
  const map = {
    outreach_sent: 'Outreach',
    pitched: 'Pitched',
    closing: 'Closing',
    purchased: 'Purchased',
    video_sent: 'Delivered',
    done: 'Done',
  };
  return map[stage] || stage || 'Unknown';
}

function formatMoney(dollars) {
  return Number(dollars || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatActor(message) {
  return message.display_name || message.external_id || 'Unknown';
}

function statCard(label, value, sub, color = '#C8A96E') {
  return `
    <div class="stat-card">
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value" style="color:${color}">${value}</div>
      ${sub ? `<div class="stat-sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
}

function buildFunnel(stats) {
  const rows = [
    { label: 'Outreach', key: 'outreachSent', color: '#3B82F6' },
    { label: 'Pitched', key: 'pitched', color: '#06B6D4' },
    { label: 'Closing', key: 'closing', color: '#F59E0B' },
    { label: 'Purchased', key: 'purchased', color: '#10B981' },
    { label: 'Delivered', key: 'videoSent', color: '#8B5CF6' },
    { label: 'Done', key: 'done', color: '#22C55E' },
  ];
  const total = Math.max(stats.totalLeads || 1, 1);
  return rows.map((r) => {
    const count = stats.stages[r.key] || 0;
    const pct = Math.max(3, Math.round((count / total) * 100));
    return `
      <div class="funnel-row">
        <div class="funnel-label">${r.label}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar" style="width:${pct}%;background:${r.color}">${count}</div>
        </div>
      </div>`;
  }).join('');
}

function buildStatusPills(stats) {
  const items = [
    { label: 'New', value: stats.newLeads, color: statusColor('new') },
    { label: 'Messaged', value: stats.messagedLeads, color: statusColor('messaged') },
    { label: 'Replied', value: stats.repliedLeads, color: statusColor('replied') },
    { label: 'Pending', value: stats.pendingLeads, color: statusColor('pending') },
    { label: 'Unresponsive', value: stats.unresponsiveLeads, color: statusColor('unresponsive') },
    { label: 'Pending Video Approval', value: stats.pendingApprovalVideo, color: statusColor('pending_approval_video') },
    { label: 'Paid', value: stats.paidLeads, color: statusColor('paid') },
    { label: 'Waiting Product', value: stats.waitingProduct, color: statusColor('waiting_product') },
    { label: 'Product Received', value: stats.productReceived, color: statusColor('product_received') },
    { label: 'Waiting Thank You', value: stats.waitingThankyou, color: statusColor('waiting_thankyou') },
    { label: 'Thank You Received', value: stats.thankyouReceived, color: statusColor('thankyou_received') },
    { label: 'Done', value: stats.doneLeads, color: statusColor('done') },
  ];
  return items.map((i) => `
    <div class="pill" style="border-color:${i.color};color:${i.color}">
      <span class="pill-num">${i.value}</span> ${escapeHtml(i.label)}
    </div>`).join('');
}

function buildPendingCards(pending, key) {
  if (!pending.length) return '<div class="empty-state">No replies waiting for approval.</div>';
  return pending.map((item) => `
    <div class="action-card">
      <div class="action-meta">
        <span class="badge" style="background:${item.channel === 'sms' ? '#8B5CF6' : '#3B82F6'}">${channelLabel(item.channel)}</span>
        <span>${escapeHtml(item.display_name || item.external_id)}</span>
        <span class="dim">${new Date(item.created_at).toLocaleString()}</span>
      </div>
      <div class="incoming-bubble">${escapeHtml(item.inbound_body)}</div>
      <form method="post" action="/dashboard-action" class="action-form">
        <input type="hidden" name="key" value="${escapeHtml(key)}" />
        <input type="hidden" name="id" value="${item.id}" />
        <textarea name="edited_reply" class="reply-input">${escapeHtml(item.draft_body)}</textarea>
        ${item.reasoning ? `<div class="reasoning">AI note: ${escapeHtml(item.reasoning)}</div>` : ''}
        <div class="action-btns">
          <button type="submit" name="action" value="approve" class="btn btn-primary">Approve & Send</button>
          <button type="submit" name="action" value="reject" class="btn btn-ghost">Reject</button>
        </div>
      </form>
    </div>
  `).join('');
}

function buildInterventionRows(interventions, key) {
  if (!interventions.length) return '<tr><td colspan="5" class="empty-cell">No intervention tickets.</td></tr>';
  return interventions.map((i) => `
    <tr>
      <td>${new Date(i.created_at).toLocaleString()}</td>
      <td><span class="status-dot" style="background:${i.status === 'open' ? '#EF4444' : '#22C55E'}"></span>${escapeHtml(i.status)}</td>
      <td>${escapeHtml(i.display_name || i.external_id || i.thread_id || '')}</td>
      <td>${escapeHtml(i.reason)}</td>
      <td>
        ${i.status === 'open' ? `
        <form method="post" action="/dashboard-action" style="display:inline">
          <input type="hidden" name="key" value="${escapeHtml(key)}" />
          <input type="hidden" name="action" value="resolve_intervention" />
          <input type="hidden" name="id" value="${i.id}" />
          <button type="submit" class="btn btn-sm btn-primary">Resolve</button>
        </form>` : ''}
      </td>
    </tr>
  `).join('');
}

function buildLeadRows(leads, key) {
  if (!leads.length) return '<tr><td colspan="7" class="empty-cell">No leads yet.</td></tr>';
  const statusOptions = [
    'new','messaged','replied','pending','unresponsive','pending_approval_video',
    'paid','waiting_product','product_received','waiting_thankyou','thankyou_received','done'
  ];
  return leads.map((lead) => `
    <tr>
      <td>${new Date(lead.created_at).toLocaleString()}</td>
      <td>
        <div class="lead-name">${escapeHtml(lead.display_name || lead.external_id || '')}</div>
        <div class="dim">${escapeHtml(lead.thread_id)}</div>
      </td>
      <td>${escapeHtml(lead.area || '')}</td>
      <td><span class="stage-pill" style="background:${statusColor(lead.status || lead.stage)}">${escapeHtml(stageLabel(lead.stage))}</span></td>
      <td>
        <form method="post" action="/dashboard-action" class="inline-form">
          <input type="hidden" name="key" value="${escapeHtml(key)}" />
          <input type="hidden" name="action" value="update_lead_status" />
          <input type="hidden" name="thread_id" value="${escapeHtml(lead.thread_id)}" />
          <select name="status" class="status-select" onchange="this.form.submit()">
            ${statusOptions.map((s) => `<option value="${s}" ${lead.status === s ? 'selected' : ''}>${escapeHtml(s.replace(/_/g,' '))}</option>`).join('')}
          </select>
        </form>
      </td>
      <td>${new Date(lead.updated_at).toLocaleString()}</td>
      <td>
        <div class="row-actions">
          ${(lead.channel === 'sms' || lead.channel === 'email') ? `
          <form method="post" action="/dashboard-action" style="display:inline">
            <input type="hidden" name="key" value="${escapeHtml(key)}" />
            <input type="hidden" name="action" value="force_ai_reply" />
            <input type="hidden" name="contact_id" value="${lead.contact_id || ''}" />
            <button type="submit" class="btn btn-sm btn-primary">Force AI reply</button>
          </form>` : ''}
          <form method="post" action="/dashboard-action" style="display:inline">
            <input type="hidden" name="key" value="${escapeHtml(key)}" />
            <input type="hidden" name="action" value="request_intervention" />
            <input type="hidden" name="lead_id" value="${lead.id}" />
            <input type="hidden" name="contact_id" value="${lead.contact_id || ''}" />
            <input type="hidden" name="reason" value="Requested from dashboard" />
            <button type="submit" class="btn btn-sm btn-ghost">Intervene</button>
          </form>
        </div>
      </td>
    </tr>
  `).join('');
}

function buildVideoRows(jobs) {
  if (!jobs.length) return '<tr><td colspan="7" class="empty-cell">No video jobs yet.</td></tr>';
  return jobs.map((j) => `
    <tr>
      <td>${new Date(j.created_at).toLocaleString()}</td>
      <td>${escapeHtml(j.display_name || j.external_id || j.listing_id || '')}</td>
      <td><span class="stage-pill" style="background:${statusColor(j.status)}">${escapeHtml(j.status)}</span></td>
      <td>${escapeHtml(j.photo_indices || '')}</td>
      <td>${formatMoney(j.cost)}</td>
      <td>${j.file_path ? `<a href="/${escapeHtml(j.file_path)}" target="_blank">file</a>` : '-'}</td>
      <td>${new Date(j.updated_at).toLocaleString()}</td>
    </tr>
  `).join('');
}

function buildActivityRows(messages) {
  if (!messages.length) return '<tr><td colspan="6" class="empty-cell">No recent activity.</td></tr>';
  return messages.map((m) => `
    <tr>
      <td>${new Date(m.created_at).toLocaleString()}</td>
      <td><span class="stage-pill" style="background:${m.direction === 'inbound' ? '#3B82F6' : '#10B981'}">${escapeHtml(m.direction)}</span></td>
      <td>${escapeHtml(channelLabel(m.channel))}</td>
      <td>${escapeHtml(formatActor(m))}</td>
      <td>${escapeHtml(m.subject || '')}</td>
      <td class="body-cell">${escapeHtml(m.body)}</td>
    </tr>
  `).join('');
}

function buildPaymentRows(payments) {
  if (!payments.length) return '<tr><td colspan="5" class="empty-cell">No payments recorded.</td></tr>';
  return payments.map((p) => `
    <tr>
      <td>${new Date(p.created_at).toLocaleString()}</td>
      <td>${escapeHtml(p.package_name || '')}</td>
      <td>${formatMoney((p.amount || 0) / 100)}</td>
      <td><span class="stage-pill" style="background:${p.status === 'COMPLETED' ? '#10B981' : '#F59E0B'}">${escapeHtml(p.status || '')}</span></td>
      <td>${escapeHtml(p.customer_email || '')}</td>
    </tr>
  `).join('');
}

function renderDashboard({ stats, pending, recentMessages, airbnbLeads, payments, videoJobs, interventions, key }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LuxStudios — Command Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --bg:#0b0c10;--surface:#15161a;--surface2:#1c1d23;--border:#2a2c35;
      --text:#f4f4f5;--muted:#9ca3af;--dim:#6b7280;
      --primary:#8b5cf6;--primary2:#6366f1;--accent:#C8A96E;
      --green:#10B981;--red:#EF4444;--blue:#3B82F6;--cyan:#22D3EE;--orange:#F59E0B;
      font-family:'Inter',system-ui,sans-serif;font-size:14px;color:var(--text);background:var(--bg);
    }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { min-height:100vh; display:flex; }
    a { color:inherit; text-decoration:none; }
    .sidebar { width:240px; background:var(--surface); border-right:1px solid var(--border); display:flex; flex-direction:column; position:fixed; inset:0 auto 0 0; z-index:50; }
    .brand { display:flex; align-items:center; gap:12px; padding:24px; border-bottom:1px solid var(--border); }
    .logo { width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg,var(--primary),var(--primary2)); display:grid; place-items:center; font-weight:700; }
    .brand-text { font-weight:600; font-size:16px; letter-spacing:0.02em; }
    .brand-text span { display:block; font-size:11px; color:var(--muted); font-weight:400; }
    .nav { padding:16px 12px; display:flex; flex-direction:column; gap:4px; flex:1; }
    .nav-item { display:flex; align-items:center; gap:12px; padding:12px; border-radius:10px; color:var(--muted); font-size:13px; font-weight:500; transition:.15s; cursor:pointer; }
    .nav-item:hover, .nav-item.active { background:var(--surface2); color:var(--text); }
    .nav-icon { width:20px; text-align:center; }
    .main { margin-left:240px; flex:1; min-width:0; }
    header { height:68px; background:rgba(11,12,16,0.85); backdrop-filter:blur(12px); border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; padding:0 32px; position:sticky; top:0; z-index:40; }
    .header-title { font-size:18px; font-weight:600; }
    .header-actions { display:flex; align-items:center; gap:12px; }
    .search { background:var(--surface2); border:1px solid var(--border); border-radius:10px; padding:8px 14px; color:var(--text); width:240px; outline:none; }
    .search::placeholder { color:var(--dim); }
    .btn { border:none; border-radius:10px; padding:10px 18px; font-size:13px; font-weight:600; cursor:pointer; transition:.15s; }
    .btn-primary { background:linear-gradient(135deg,var(--primary),var(--primary2)); color:white; }
    .btn-primary:hover { filter:brightness(1.1); }
    .btn-ghost { background:transparent; border:1px solid var(--border); color:var(--muted); }
    .btn-ghost:hover { border-color:var(--primary); color:var(--text); }
    .btn-sm { padding:6px 12px; font-size:12px; }
    .content { padding:28px 32px 48px; display:flex; flex-direction:column; gap:28px; }
    .hero { position:relative; border-radius:20px; padding:40px; background:linear-gradient(120deg,#1c0f3a 0%,#2d1b69 40%,#1c1d23 100%); border:1px solid var(--border); overflow:hidden; display:flex; justify-content:space-between; align-items:center; }
    .hero::before { content:''; position:absolute; inset:0; background:radial-gradient(circle at 80% 20%,rgba(139,92,246,0.25),transparent 40%); pointer-events:none; }
    .hero-content { position:relative; z-index:1; }
    .hero-label { font-size:12px; text-transform:uppercase; letter-spacing:0.15em; color:var(--muted); margin-bottom:10px; }
    .hero-value { font-size:56px; font-weight:700; line-height:1; margin-bottom:8px; }
    .hero-sub { color:var(--muted); font-size:14px; }
    .hero-art { width:260px; height:160px; position:relative; }
    .orb { position:absolute; border-radius:50%; filter:blur(1px); }
    .orb-1 { width:90px; height:90px; background:linear-gradient(135deg,#a78bfa,#6366f1); top:20px; right:70px; }
    .orb-2 { width:50px; height:50px; background:linear-gradient(135deg,#f472b6,#db2777); top:70px; right:150px; }
    .orb-3 { width:30px; height:30px; background:linear-gradient(135deg,#60a5fa,#3b82f6); top:30px; right:20px; }
    .card { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:24px; }
    .card-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; }
    .card-title { font-size:15px; font-weight:600; }
    .card-sub { font-size:12px; color:var(--muted); }
    .stats-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(170px,1fr)); gap:14px; }
    .stat-card { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px; }
    .stat-label { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--muted); margin-bottom:10px; }
    .stat-value { font-size:30px; font-weight:700; line-height:1; }
    .stat-sub { margin-top:6px; font-size:11px; color:var(--dim); }
    .section-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:24px; }
    @media(max-width:1200px){ .section-grid { grid-template-columns:1fr; } }
    .funnel-row { display:grid; grid-template-columns:90px 1fr; align-items:center; gap:14px; margin-bottom:12px; }
    .funnel-label { font-size:12px; color:var(--muted); }
    .funnel-bar-wrap { height:28px; background:var(--surface2); border-radius:8px; overflow:hidden; }
    .funnel-bar { height:100%; border-radius:8px; display:flex; align-items:center; padding-left:10px; font-size:11px; font-weight:700; color:white; transition:width 1s ease; }
    .pill-row { display:flex; flex-wrap:wrap; gap:10px; }
    .pill { border:1px solid var(--border); border-radius:999px; padding:8px 14px; font-size:12px; color:var(--muted); display:flex; align-items:center; gap:8px; }
    .pill-num { font-weight:700; color:var(--text); }
    .stage-pill { display:inline-block; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:600; color:white; text-transform:capitalize; }
    .badge { color:white; font-size:10px; font-weight:700; padding:3px 8px; border-radius:6px; text-transform:uppercase; }
    .action-card { background:var(--surface2); border:1px solid var(--border); border-radius:12px; padding:16px; margin-bottom:12px; }
    .action-meta { display:flex; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap; }
    .incoming-bubble { background:var(--surface); border-radius:10px; padding:12px; margin-bottom:12px; font-size:13px; line-height:1.5; white-space:pre-wrap; }
    .reply-input { width:100%; min-height:80px; background:var(--bg); border:1px solid var(--border); border-radius:10px; padding:12px; color:var(--text); font-family:inherit; font-size:13px; resize:vertical; }
    .reasoning { font-size:11px; color:var(--dim); margin:8px 0; }
    .action-form { margin-top:10px; }
    .action-btns { display:flex; gap:10px; margin-top:10px; }
    .empty-state { color:var(--dim); padding:24px; text-align:center; font-size:13px; }
    .table-wrap { overflow-x:auto; border:1px solid var(--border); border-radius:12px; }
    table { width:100%; border-collapse:collapse; font-size:12px; }
    th, td { padding:12px; text-align:left; border-bottom:1px solid var(--border); vertical-align:top; }
    th { background:var(--surface2); color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:0.05em; font-weight:600; position:sticky; top:0; }
    tr:last-child td { border-bottom:none; }
    .body-cell { max-width:400px; white-space:pre-wrap; word-break:break-word; color:var(--muted); }
    .empty-cell { text-align:center; color:var(--dim); padding:24px; }
    .dim { color:var(--dim); font-size:12px; }
    .lead-name { font-weight:500; }
    .status-select { background:var(--bg); border:1px solid var(--border); color:var(--text); border-radius:8px; padding:6px 10px; font-size:12px; }
    .row-actions { display:flex; gap:8px; flex-wrap:wrap; }
    .status-dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:6px; }
    .inline-form { display:inline; }
    .live-dot { width:8px; height:8px; border-radius:50%; background:var(--green); box-shadow:0 0 0 0 rgba(16,185,129,0.5); animation:pulse 2s infinite; display:inline-block; margin-right:8px; }
    @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,0.5);} 50%{box-shadow:0 0 0 6px rgba(16,185,129,0);} }
    .footer { padding:20px 32px; color:var(--dim); font-size:12px; border-top:1px solid var(--border); }
  </style>
</head>
<body>
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">L</div>
      <div class="brand-text">LuxStudios<span>Command Center</span></div>
    </div>
    <nav class="nav">
      <div class="nav-item active"><span class="nav-icon">🏠</span> Dashboard</div>
      <div class="nav-item"><span class="nav-icon">👥</span> Leads</div>
      <div class="nav-item"><span class="nav-icon">🎬</span> Videos</div>
      <div class="nav-item"><span class="nav-icon">💰</span> Revenue</div>
      <div class="nav-item"><span class="nav-icon">⚙️</span> Settings</div>
    </nav>
  </aside>

  <main class="main">
    <header>
      <div class="header-title">Dashboard</div>
      <div class="header-actions">
        <input type="text" class="search" placeholder="Search leads, messages..." />
        <span style="font-size:12px;color:var(--muted)"><span class="live-dot"></span>Live</span>
        <a href="/dashboard?key=${escapeHtml(key)}" class="btn btn-ghost">Refresh</a>
      </div>
    </header>

    <div class="content">
      <section class="hero">
        <div class="hero-content">
          <div class="hero-label">Total Revenue Generated</div>
          <div class="hero-value" style="background:linear-gradient(90deg,#fff,var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent">${formatMoney(stats.revenue.total)}</div>
          <div class="hero-sub">${stats.revenue.payments} payment${stats.revenue.payments !== 1 ? 's' : ''} · ${stats.roi}% ROI · ${escapeHtml(stats.totalLeads)} total leads</div>
        </div>
        <div class="hero-art">
          <div class="orb orb-1"></div>
          <div class="orb orb-2"></div>
          <div class="orb orb-3"></div>
        </div>
      </section>

      <section>
        <div class="card-header">
          <div><div class="card-title">Lead Pipeline</div><div class="card-sub">Every stage of the lead lifecycle</div></div>
        </div>
        <div class="stats-grid">
          ${statCard('Total Leads', stats.totalLeads, 'All Airbnb leads', '#C8A96E')}
          ${statCard('Messaged', stats.messagedLeads, 'Outreach sent', '#C8A96E')}
          ${statCard('Pending Replies', stats.pendingReplies, 'Need your approval', '#F59E0B')}
          ${statCard('Open Interventions', stats.openInterventions, 'Need human help', '#EF4444')}
          ${statCard('Inbound Messages', stats.messages.inbound, 'Host / customer messages', '#3B82F6')}
          ${statCard('Outbound Messages', stats.messages.outbound, 'AI / you replies', '#10B981')}
        </div>
      </section>

      <div class="section-grid">
        <section class="card">
          <div class="card-header"><div class="card-title">Conversion Funnel</div></div>
          <div class="funnel-stages">${buildFunnel(stats)}</div>
        </section>
        <section class="card">
          <div class="card-header"><div class="card-title">Lead Status Breakdown</div></div>
          <div class="pill-row">${buildStatusPills(stats)}</div>
        </section>
      </div>

      <section class="card">
        <div class="card-header">
          <div><div class="card-title">Revenue & Cost Breakdown</div><div class="card-sub">ROI, AI spend and video production costs</div></div>
        </div>
        <div class="stats-grid">
          ${statCard('Total Revenue', formatMoney(stats.revenue.total), `${stats.revenue.payments} payments`, '#10B981')}
          ${statCard('Total Costs', formatMoney(stats.costs.total), 'AI + video production', '#EF4444')}
          ${statCard('ROI', stats.roi + '%', 'Revenue vs costs', '#C8A96E')}
          ${statCard('AI Cost', formatMoney(stats.costs.aiTotal), `${stats.costs.aiCalls} calls`, '#8B5CF6')}
          ${statCard('Video Cost', formatMoney(stats.costs.videoTotal), `${stats.costs.videoCompleted} made`, '#F59E0B')}
          ${statCard('Pending Videos', stats.costs.videoPending, 'In production queue', '#F472B6')}
          ${statCard('Videos Sent', stats.costs.videoSent, 'Delivered to clients', '#3B82F6')}
          ${statCard('Videos Received', stats.costs.videoReceived, 'Confirmed by client', '#22C55E')}
        </div>
      </section>

      <div class="section-grid">
        <section class="card">
          <div class="card-header"><div class="card-title">Pending Replies — Need Approval</div></div>
          ${buildPendingCards(pending, key)}
        </section>
        <section class="card">
          <div class="card-header"><div class="card-title">Human Intervention Tickets</div></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Created</th><th>Status</th><th>Contact / Lead</th><th>Reason</th><th>Action</th></tr></thead>
              <tbody>${buildInterventionRows(interventions, key)}</tbody>
            </table>
          </div>
        </section>
      </div>

      <section class="card">
        <div class="card-header"><div class="card-title">Lead Control Center</div><div class="card-sub">Update status, force an AI reply, or request intervention</div></div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Created</th><th>Contact</th><th>Area</th><th>Stage</th><th>Status</th><th>Updated</th><th>Actions</th></tr>
            </thead>
            <tbody>${buildLeadRows(airbnbLeads, key)}</tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-header"><div class="card-title">Video Production Jobs</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Created</th><th>Lead</th><th>Status</th><th>Photos</th><th>Cost</th><th>File</th><th>Updated</th></tr></thead>
            <tbody>${buildVideoRows(videoJobs)}</tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-header"><div class="card-title">Recent Activity</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Direction</th><th>Channel</th><th>Contact</th><th>Subject</th><th>Body</th></tr></thead>
            <tbody>${buildActivityRows(recentMessages)}</tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-header"><div class="card-title">Payments</div></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Package</th><th>Amount</th><th>Status</th><th>Customer</th></tr></thead>
            <tbody>${buildPaymentRows(payments)}</tbody>
          </table>
        </div>
      </section>
    </div>

    <footer class="footer">LuxStudios Command Center · Auto-refresh every 30s · Updated ${new Date().toLocaleString()}</footer>
  </main>

  <script>
    setTimeout(() => location.reload(), 30000);
  </script>
</body>
</html>`;
}

module.exports = { renderDashboard };
