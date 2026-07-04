const PACKAGES = { Essential: 799, Signature: 1399, Estate: 2000, avg: 1199 };

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ));
}

function channelLabel(channel) {
  if (channel === 'sms') return 'SMS';
  if (channel === 'email') return 'Email';
  if (channel === 'email_forward') return 'Email Forward';
  if (channel === 'airbnb') return 'Airbnb';
  return channel || 'Unknown';
}

async function supabase(env, query) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${query}`, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      Accept: 'application/json',
    },
  });
  return response.json();
}

async function getStats(env) {
  const [leads, contacts, messageCounts, pendingRows, activityRows] = await Promise.all([
    supabase(env, 'airbnb_leads?select=id,thread_id,listing_id,area,stage,contact_id,created_at,updated_at&order=created_at.desc&limit=500'),
    supabase(env, 'reply_assistant_contacts?select=id,channel,external_id,display_name,created_at&order=created_at.desc&limit=500'),
    supabase(env, 'reply_assistant_messages?select=id,direction,created_at&order=created_at.desc&limit=5000'),
    supabase(env, 'reply_assistant_pending_replies?select=id,status,contact_id,inbound_message_id,draft_body,reasoning,created_at,resolved_at&order=created_at.desc&limit=500'),
    supabase(env, 'reply_assistant_messages?select=id,contact_id,direction,body,subject,provider_sid,created_at,reply_assistant_contacts(channel,external_id,display_name)&order=created_at.desc&limit=500'),
  ]);

  const stages = { outreach_sent: 0, pitched: 0, closing: 0, purchased: 0, video_sent: 0, done: 0 };
  for (const lead of (leads || [])) stages[lead.stage] = (stages[lead.stage] || 0) + 1;

  const purchased = (stages.purchased || 0) + (stages.video_sent || 0) + (stages.done || 0);
  const totalLeads = (leads || []).length;
  const revenue = purchased * PACKAGES.avg;
  const convRate = totalLeads > 0 ? ((purchased / totalLeads) * 100).toFixed(1) : '0.0';

  const byChannel = {};
  const contactById = new Map();
  for (const contact of (contacts || [])) {
    byChannel[contact.channel] = (byChannel[contact.channel] || 0) + 1;
    contactById.set(contact.id, contact);
  }

  const outbound = (messageCounts || []).filter((message) => message.direction === 'outbound').length;
  const inbound = (messageCounts || []).filter((message) => message.direction === 'inbound').length;
  const pendingCount = (pendingRows || []).filter((row) => row.status === 'pending').length;

  const activity = (activityRows || []).map((row) => ({
    id: row.id,
    created_at: row.created_at,
    direction: row.direction || '',
    channel: row.reply_assistant_contacts?.channel || '',
    external_id: row.reply_assistant_contacts?.external_id || '',
    display_name: row.reply_assistant_contacts?.display_name || '',
    contact_id: row.contact_id || '',
    subject: row.subject || '',
    provider_sid: row.provider_sid || '',
    body: row.body || '',
  }));

  const pending = (pendingRows || []).map((row) => {
    const contact = contactById.get(row.contact_id) || {};
    return {
      id: row.id,
      status: row.status || '',
      created_at: row.created_at,
      resolved_at: row.resolved_at || '',
      contact_id: row.contact_id || '',
      inbound_message_id: row.inbound_message_id || '',
      channel: contact.channel || '',
      external_id: contact.external_id || '',
      display_name: contact.display_name || '',
      draft_body: row.draft_body || '',
      reasoning: row.reasoning || '',
    };
  });

  const leadsWithContact = (leads || []).map((lead) => {
    const contact = contactById.get(lead.contact_id) || {};
    return {
      id: lead.id,
      stage: lead.stage || '',
      area: lead.area || '',
      thread_id: lead.thread_id || '',
      listing_id: lead.listing_id || '',
      contact_id: lead.contact_id || '',
      created_at: lead.created_at,
      updated_at: lead.updated_at,
      channel: contact.channel || '',
      external_id: contact.external_id || '',
      display_name: contact.display_name || '',
    };
  });

  return {
    totalLeads,
    stages,
    purchased,
    revenue,
    convRate,
    byChannel,
    outbound,
    inbound,
    pendingCount,
    activityPreview: activity.slice(0, 12),
    activity,
    pending,
    leads: leadsWithContact,
    contacts: contacts || [],
    sampleSizes: {
      contacts: (contacts || []).length,
      leads: (leads || []).length,
      messageCounts: (messageCounts || []).length,
      messagesDetailed: activity.length,
      pending: pending.length,
    },
    ts: new Date().toISOString(),
  };
}

function buildFunnel(stats) {
  const stages = stats.stages;
  const total = stats.totalLeads || 1;
  const rows = [
    { label: 'Outreach', css: 'bar-outreach', count: stages.outreach_sent || 0 },
    { label: 'Pitched', css: 'bar-pitched', count: stages.pitched || 0 },
    { label: 'Closing', css: 'bar-closing', count: stages.closing || 0 },
    { label: 'Purchased', css: 'bar-purchased', count: stages.purchased || 0 },
    { label: 'Delivered', css: 'bar-done', count: (stages.video_sent || 0) + (stages.done || 0) },
  ];
  return rows.map((row) => {
    const pct = Math.max(4, Math.round((row.count / total) * 100));
    return `<div class="funnel-row">
      <div class="funnel-label">${row.label}</div>
      <div class="funnel-bar-wrap"><div class="funnel-bar ${row.css}" data-w="${pct}%" style="width:0%"></div></div>
      <div class="funnel-count">${row.count}</div>
    </div>`;
  }).join('');
}

function buildFeed(messages) {
  if (!messages || messages.length === 0) {
    return '<div style="color:var(--dim);font-size:13px;padding:24px 0;text-align:center">Waiting for activity...</div>';
  }
  return messages.map((message) => {
    const direction = message.direction === 'inbound' ? 'in' : 'out';
    const label = message.direction === 'inbound' ? 'INBOUND' : 'OUTBOUND';
    const body = escapeHtml(message.body).slice(0, 180);
    const time = new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="feed-item">
      <span class="feed-dir dir-${direction}">${label}</span>
      <div class="feed-body">${body}</div>
      <div class="feed-time">${time}</div>
    </div>`;
  }).join('');
}

function buildMessageRows(messages) {
  if (!messages || messages.length === 0) {
    return '<tr><td colspan="10" class="empty-cell">No message activity found.</td></tr>';
  }
  return messages.map((message) => `<tr>
    <td>${escapeHtml(new Date(message.created_at).toLocaleString())}</td>
    <td>${escapeHtml(channelLabel(message.channel))}</td>
    <td>${escapeHtml(message.direction)}</td>
    <td>${escapeHtml(message.display_name || message.external_id || 'Unknown')}</td>
    <td>${escapeHtml(message.external_id)}</td>
    <td>${escapeHtml(message.subject)}</td>
    <td>${escapeHtml(message.provider_sid)}</td>
    <td>${escapeHtml(message.contact_id)}</td>
    <td>${escapeHtml(message.id)}</td>
    <td class="body-cell">${escapeHtml(message.body)}</td>
  </tr>`).join('');
}

function buildPendingRows(pending) {
  if (!pending || pending.length === 0) {
    return '<tr><td colspan="11" class="empty-cell">No pending reply records found.</td></tr>';
  }
  return pending.map((row) => `<tr>
    <td>${escapeHtml(new Date(row.created_at).toLocaleString())}</td>
    <td>${escapeHtml(row.status)}</td>
    <td>${escapeHtml(channelLabel(row.channel))}</td>
    <td>${escapeHtml(row.display_name || row.external_id || 'Unknown')}</td>
    <td>${escapeHtml(row.external_id)}</td>
    <td>${escapeHtml(row.contact_id)}</td>
    <td>${escapeHtml(row.id)}</td>
    <td>${escapeHtml(row.inbound_message_id)}</td>
    <td>${escapeHtml(row.resolved_at ? new Date(row.resolved_at).toLocaleString() : '')}</td>
    <td class="body-cell">${escapeHtml(row.draft_body)}</td>
    <td class="body-cell">${escapeHtml(row.reasoning)}</td>
  </tr>`).join('');
}

function buildLeadRows(leads) {
  if (!leads || leads.length === 0) {
    return '<tr><td colspan="11" class="empty-cell">No lead rows found.</td></tr>';
  }
  return leads.map((lead) => `<tr>
    <td>${escapeHtml(new Date(lead.created_at).toLocaleString())}</td>
    <td>${escapeHtml(lead.stage)}</td>
    <td>${escapeHtml(lead.area)}</td>
    <td>${escapeHtml(lead.thread_id)}</td>
    <td>${escapeHtml(lead.listing_id)}</td>
    <td>${escapeHtml(channelLabel(lead.channel))}</td>
    <td>${escapeHtml(lead.display_name || lead.external_id || 'Unknown')}</td>
    <td>${escapeHtml(lead.external_id)}</td>
    <td>${escapeHtml(lead.contact_id)}</td>
    <td>${escapeHtml(lead.id)}</td>
    <td>${escapeHtml(lead.updated_at ? new Date(lead.updated_at).toLocaleString() : '')}</td>
  </tr>`).join('');
}

const HTML = (stats) => `<!DOCTYPE html>
<html lang="en">
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LuxStudios - Command Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#080808;--surface:#0f1012;--surface2:#161719;--border:#222326;
  --gold:#C8A96E;--gold2:#E8D5A3;--gold-glow:rgba(200,169,110,0.15);
  --text:#F5F5F5;--muted:#888;--dim:#444;--green:#4ADE80;--blue:#60A5FA;
  font-family:'Inter',system-ui,sans-serif;font-size:15px;color:var(--text);background:var(--bg);
}
body{min-height:100vh;overflow-x:hidden}
header{display:flex;align-items:center;justify-content:space-between;padding:20px 36px;border-bottom:1px solid var(--border);background:linear-gradient(180deg,#0f0f0f 0%,transparent 100%);position:sticky;top:0;z-index:100;backdrop-filter:blur(12px)}
.wordmark{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:300;letter-spacing:0.12em;color:var(--gold2)}
.wordmark span{color:var(--muted);font-size:13px;font-family:'Inter',sans-serif;font-weight:300;margin-left:10px;letter-spacing:0.05em}
.live-badge{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;color:var(--green);letter-spacing:0.08em;text-transform:uppercase}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(74,222,128,0.4)}50%{opacity:.7;box-shadow:0 0 0 6px rgba(74,222,128,0)}}
.last-update{font-size:11px;color:var(--dim);margin-left:16px}
.page{padding:32px 36px;display:grid;gap:24px}
.hero{text-align:center;padding:48px 24px 36px;border:1px solid var(--border);border-radius:16px;background:radial-gradient(ellipse 60% 80% at 50% 100%, var(--gold-glow) 0%, transparent 70%), var(--surface);position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 39px,var(--border) 40px),repeating-linear-gradient(90deg,transparent,transparent 39px,var(--border) 40px);opacity:0.18;pointer-events:none}
.hero-label{font-size:11px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold);margin-bottom:16px}
.hero-num{font-family:'Cormorant Garamond',serif;font-size:clamp(64px,10vw,120px);font-weight:300;color:var(--gold2);line-height:1;text-shadow:0 0 80px rgba(200,169,110,0.4);font-variant-numeric:tabular-nums}
.hero-sub{margin-top:12px;font-size:13px;color:var(--muted);letter-spacing:0.06em}
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;position:relative;overflow:hidden;transition:border-color .3s}
.stat:hover{border-color:var(--gold)}
.stat-label{font-size:11px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
.stat-value{font-size:36px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
.stat-sub{font-size:12px;color:var(--muted);margin-top:8px}
.stat-accent{position:absolute;bottom:0;left:0;right:0;height:2px}
.gold-bar{background:linear-gradient(90deg,transparent,var(--gold),transparent)}
.green-bar{background:linear-gradient(90deg,transparent,var(--green),transparent)}
.blue-bar{background:linear-gradient(90deg,transparent,var(--blue),transparent)}
.mid-row{display:grid;grid-template-columns:1fr 380px;gap:24px}
.funnel-card,.feed-card,.data-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px}
.card-title{font-size:11px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:var(--gold);margin-bottom:16px}
.funnel-stages{display:flex;flex-direction:column;gap:12px}
.funnel-row{display:grid;grid-template-columns:110px 1fr 48px;align-items:center;gap:14px}
.funnel-label{font-size:12px;color:var(--muted);text-align:right}
.funnel-bar-wrap{height:28px;background:var(--surface2);border-radius:6px;overflow:hidden}
.funnel-bar{height:100%;border-radius:6px;transition:width 1.2s cubic-bezier(.22,1,.36,1);display:flex;align-items:center;padding-left:10px;font-size:11px;font-weight:500;white-space:nowrap}
.bar-outreach{background:linear-gradient(90deg,#2A3A5C,#3B5BDB)}
.bar-pitched{background:linear-gradient(90deg,#2A4A3A,#2D9CDB)}
.bar-closing{background:linear-gradient(90deg,#4A3A1A,#F59E0B)}
.bar-purchased{background:linear-gradient(90deg,#1A4A2A,var(--gold))}
.bar-done{background:linear-gradient(90deg,#1A3A2A,var(--green))}
.funnel-count{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
.feed-list{display:flex;flex-direction:column;gap:0}
.feed-item{padding:12px 0;border-bottom:1px solid var(--border)}
.feed-item:last-child{border-bottom:none}
.feed-dir{display:inline-block;font-size:9px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;padding:2px 7px;border-radius:4px;margin-bottom:5px}
.dir-in{background:rgba(96,165,250,0.15);color:var(--blue)}
.dir-out{background:rgba(200,169,110,0.15);color:var(--gold)}
.feed-body{font-size:12px;color:var(--muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.feed-time{font-size:10px;color:var(--dim);margin-top:4px}
.channels{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.channel-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center}
.channel-icon{font-size:24px;margin-bottom:8px}
.channel-name{font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.channel-count{font-size:28px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--gold2)}
.table-wrap{overflow-x:auto;border:1px solid var(--border);border-radius:10px}
table{width:100%;border-collapse:collapse;font-size:12px;min-width:1200px}
th,td{text-align:left;vertical-align:top;padding:10px 8px;border-bottom:1px solid var(--border)}
th{position:sticky;top:0;background:var(--surface2);font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:var(--muted)}
.body-cell{white-space:pre-wrap;word-break:break-word;max-width:500px}
.empty-cell{text-align:center;color:var(--muted);padding:16px}
.meta-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.pill{border:1px solid var(--border);border-radius:999px;padding:6px 12px;font-size:12px;background:var(--surface2);color:var(--muted)}
.gold{color:var(--gold)} .green{color:var(--green)}
@media(max-width:1100px){.stats-grid{grid-template-columns:repeat(2,1fr)}.mid-row{grid-template-columns:1fr}.channels{grid-template-columns:repeat(2,1fr)}header{padding:16px 20px}.page{padding:20px}}
</style>
<body>
<header>
  <div class="wordmark">LUXSTUDIOS <span>COMMAND CENTER</span></div>
  <div style="display:flex;align-items:center;gap:24px">
    <div class="live-badge"><div class="pulse"></div>LIVE</div>
    <div class="last-update" id="ts">-</div>
  </div>
</header>

<div class="page">
  <div class="hero">
    <div class="hero-label">Total Revenue Generated</div>
    <div class="hero-num" id="revenue" data-target="${stats.revenue}">$0</div>
    <div class="hero-sub">${stats.purchased} closed deal${stats.purchased !== 1 ? 's' : ''} - ${stats.convRate}% conversion rate - avg $${PACKAGES.avg.toLocaleString()} per sale</div>
  </div>

  <div class="stats-grid">
    <div class="stat"><div class="stat-label">Total Leads</div><div class="stat-value gold" id="s-leads" data-target="${stats.totalLeads}">0</div><div class="stat-sub">Airbnb leads in table sample</div><div class="stat-accent gold-bar"></div></div>
    <div class="stat"><div class="stat-label">Active Conversations</div><div class="stat-value" id="s-active" data-target="${(stats.stages.pitched || 0) + (stats.stages.closing || 0)}">0</div><div class="stat-sub">Pitched + closing stages</div><div class="stat-accent blue-bar"></div></div>
    <div class="stat"><div class="stat-label">Messages Sampled</div><div class="stat-value" id="s-sent" data-target="${stats.outbound}">0</div><div class="stat-sub">${stats.inbound} inbound in sampled range</div><div class="stat-accent gold-bar"></div></div>
    <div class="stat"><div class="stat-label">Pending Replies</div><div class="stat-value green" id="s-pending" data-target="${stats.pendingCount}">0</div><div class="stat-sub">Queue size right now</div><div class="stat-accent green-bar"></div></div>
  </div>

  <div class="mid-row">
    <div class="funnel-card">
      <div class="card-title">Conversion Funnel</div>
      <div class="funnel-stages" id="funnel">${buildFunnel(stats)}</div>
    </div>
    <div class="feed-card">
      <div class="card-title">Live Activity</div>
      <div class="feed-list">${buildFeed(stats.activityPreview)}</div>
    </div>
  </div>

  <div class="channels">
    <div class="channel-card"><div class="channel-icon">🏠</div><div class="channel-name">Airbnb</div><div class="channel-count">${stats.byChannel?.airbnb || 0}</div></div>
    <div class="channel-card"><div class="channel-icon">💬</div><div class="channel-name">SMS</div><div class="channel-count">${stats.byChannel?.sms || 0}</div></div>
    <div class="channel-card"><div class="channel-icon">✉️</div><div class="channel-name">Email</div><div class="channel-count">${stats.byChannel?.email || 0}</div></div>
    <div class="channel-card"><div class="channel-icon">📬</div><div class="channel-name">Forward</div><div class="channel-count">${stats.byChannel?.email_forward || 0}</div></div>
  </div>

  <div class="data-card">
    <div class="card-title">Full Message Log (subcolumns restored)</div>
    <div class="meta-row">
      <div class="pill">Detailed rows: ${stats.sampleSizes.messagesDetailed}</div>
      <div class="pill">Count sample: ${stats.sampleSizes.messageCounts}</div>
      <div class="pill">API endpoint: /api/stats</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>When</th><th>Channel</th><th>Direction</th><th>Contact</th><th>External ID</th><th>Subject</th><th>Provider SID</th><th>Contact ID</th><th>Message ID</th><th>Body</th></tr>
        </thead>
        <tbody>${buildMessageRows(stats.activity)}</tbody>
      </table>
    </div>
  </div>

  <div class="data-card">
    <div class="card-title">Pending Reply Log</div>
    <div class="meta-row">
      <div class="pill">Rows: ${stats.sampleSizes.pending}</div>
      <div class="pill">Pending now: ${stats.pendingCount}</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Created</th><th>Status</th><th>Channel</th><th>Contact</th><th>External ID</th><th>Contact ID</th><th>Pending ID</th><th>Inbound Msg ID</th><th>Resolved</th><th>Draft</th><th>Reasoning</th></tr>
        </thead>
        <tbody>${buildPendingRows(stats.pending)}</tbody>
      </table>
    </div>
  </div>

  <div class="data-card">
    <div class="card-title">Lead Log</div>
    <div class="meta-row">
      <div class="pill">Rows: ${stats.sampleSizes.leads}</div>
      <div class="pill">Contacts sampled: ${stats.sampleSizes.contacts}</div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Created</th><th>Stage</th><th>Area</th><th>Thread ID</th><th>Listing ID</th><th>Channel</th><th>Contact</th><th>External ID</th><th>Contact ID</th><th>Lead ID</th><th>Updated</th></tr>
        </thead>
        <tbody>${buildLeadRows(stats.leads)}</tbody>
      </table>
    </div>
  </div>
</div>

<script>
function animateCount(el, target, prefix, suffix, duration) {
  const start = Date.now();
  const isFloat = String(target).includes('.');
  function tick() {
    const p = Math.min((Date.now() - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 4);
    const val = target * ease;
    el.textContent = prefix + (isFloat ? val.toFixed(1) : Math.floor(val).toLocaleString()) + suffix;
    if (p < 1) requestAnimationFrame(tick);
    if (p === 1) el.textContent = prefix + (isFloat ? target.toFixed(1) : target.toLocaleString()) + suffix;
  }
  requestAnimationFrame(tick);
}

window.addEventListener('DOMContentLoaded', () => {
  animateCount(document.getElementById('revenue'), ${stats.revenue}, '$', '', 2200);
  animateCount(document.getElementById('s-leads'), ${stats.totalLeads}, '', '', 1400);
  animateCount(document.getElementById('s-active'), ${(stats.stages.pitched || 0) + (stats.stages.closing || 0)}, '', '', 1400);
  animateCount(document.getElementById('s-sent'), ${stats.outbound}, '', '', 1400);
  animateCount(document.getElementById('s-pending'), ${stats.pendingCount}, '', '', 1400);
  setTimeout(() => {
    document.querySelectorAll('.funnel-bar[data-w]').forEach((bar) => { bar.style.width = bar.dataset.w; });
  }, 300);
  document.getElementById('ts').textContent = 'Updated ' + new Date('${stats.ts}').toLocaleTimeString();
});

setTimeout(() => location.reload(), 30000);
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stats = await getStats(env);
    if (url.pathname === '/api/stats') {
      return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(HTML(stats), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  },
};
