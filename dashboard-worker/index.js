const PACKAGES = { Essential: 799, Signature: 1399, Estate: 2000, avg: 1199 };

async function supabase(env, query) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${query}`, {
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      Accept: 'application/json',
    },
  });
  return res.json();
}

async function getStats(env) {
  const [leads, contacts, messages, pending, activity] = await Promise.all([
    supabase(env, 'airbnb_leads?select=stage,created_at,area'),
    supabase(env, 'reply_assistant_contacts?select=channel'),
    supabase(env, 'reply_assistant_messages?select=direction,created_at&order=created_at.desc&limit=200'),
    supabase(env, 'reply_assistant_pending_replies?select=status'),
    supabase(env, 'reply_assistant_messages?select=direction,body,created_at&order=created_at.desc&limit=20'),
  ]);

  const stages = { outreach_sent: 0, pitched: 0, closing: 0, purchased: 0, video_sent: 0, done: 0 };
  for (const l of (leads || [])) stages[l.stage] = (stages[l.stage] || 0) + 1;

  const purchased = (stages.purchased || 0) + (stages.video_sent || 0) + (stages.done || 0);
  const totalLeads = (leads || []).length;
  const revenue = purchased * PACKAGES.avg;
  const convRate = totalLeads > 0 ? ((purchased / totalLeads) * 100).toFixed(1) : '0.0';

  const byChannel = {};
  for (const c of (contacts || [])) byChannel[c.channel] = (byChannel[c.channel] || 0) + 1;

  const outbound = (messages || []).filter(m => m.direction === 'outbound').length;
  const inbound = (messages || []).filter(m => m.direction === 'inbound').length;

  return {
    totalLeads,
    stages,
    purchased,
    revenue,
    convRate,
    byChannel,
    outbound,
    inbound,
    pendingCount: (pending || []).filter(p => p.status === 'pending').length,
    activity: (activity || []).slice(0, 12),
    ts: new Date().toISOString(),
  };
}

const HTML = (stats) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>LuxStudios — Command Center</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#080808;--surface:#0f1012;--surface2:#161719;--border:#222326;
  --gold:#C8A96E;--gold2:#E8D5A3;--gold-glow:rgba(200,169,110,0.15);
  --text:#F5F5F5;--muted:#888;--dim:#444;
  --green:#4ADE80;--red:#F87171;--blue:#60A5FA;
  font-family:'Inter',system-ui,sans-serif;
  font-size:15px;color:var(--text);background:var(--bg);
}
body{min-height:100vh;overflow-x:hidden}

/* ── HEADER ── */
header{
  display:flex;align-items:center;justify-content:space-between;
  padding:20px 36px;border-bottom:1px solid var(--border);
  background:linear-gradient(180deg,#0f0f0f 0%,transparent 100%);
  position:sticky;top:0;z-index:100;backdrop-filter:blur(12px);
}
.wordmark{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:300;letter-spacing:0.12em;color:var(--gold2)}
.wordmark span{color:var(--muted);font-size:13px;font-family:'Inter',sans-serif;font-weight:300;margin-left:10px;letter-spacing:0.05em}
.live-badge{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;color:var(--green);letter-spacing:0.08em;text-transform:uppercase}
.pulse{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(74,222,128,0.4)}50%{opacity:.7;box-shadow:0 0 0 6px rgba(74,222,128,0)}}
.last-update{font-size:11px;color:var(--dim);margin-left:16px}

/* ── LAYOUT ── */
.page{padding:32px 36px;display:grid;gap:24px}

/* ── HERO REVENUE ── */
.hero{
  text-align:center;padding:48px 24px 36px;
  border:1px solid var(--border);border-radius:16px;
  background:radial-gradient(ellipse 60% 80% at 50% 100%, var(--gold-glow) 0%, transparent 70%), var(--surface);
  position:relative;overflow:hidden;
}
.hero::before{
  content:'';position:absolute;inset:0;
  background:repeating-linear-gradient(0deg,transparent,transparent 39px,var(--border) 40px),
             repeating-linear-gradient(90deg,transparent,transparent 39px,var(--border) 40px);
  opacity:0.18;pointer-events:none;
}
.hero-label{font-size:11px;font-weight:500;letter-spacing:0.2em;text-transform:uppercase;color:var(--gold);margin-bottom:16px}
.hero-num{
  font-family:'Cormorant Garamond',serif;font-size:clamp(64px,10vw,120px);
  font-weight:300;color:var(--gold2);line-height:1;
  text-shadow:0 0 80px rgba(200,169,110,0.4);
  font-variant-numeric:tabular-nums;
}
.hero-sub{margin-top:12px;font-size:13px;color:var(--muted);letter-spacing:0.06em}

/* ── STAT CARDS ── */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.stat{
  background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:24px;position:relative;overflow:hidden;transition:border-color .3s;
}
.stat:hover{border-color:var(--gold)}
.stat-label{font-size:11px;font-weight:500;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
.stat-value{font-size:36px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
.stat-sub{font-size:12px;color:var(--muted);margin-top:8px}
.stat-accent{position:absolute;bottom:0;left:0;right:0;height:2px}
.gold-bar{background:linear-gradient(90deg,transparent,var(--gold),transparent)}
.green-bar{background:linear-gradient(90deg,transparent,var(--green),transparent)}
.blue-bar{background:linear-gradient(90deg,transparent,var(--blue),transparent)}

/* ── MIDDLE ROW ── */
.mid-row{display:grid;grid-template-columns:1fr 380px;gap:24px}

/* ── FUNNEL ── */
.funnel-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px}
.card-title{font-size:11px;font-weight:500;letter-spacing:0.16em;text-transform:uppercase;color:var(--gold);margin-bottom:24px}
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

/* ── ACTIVITY FEED ── */
.feed-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px;overflow:hidden}
.feed-list{display:flex;flex-direction:column;gap:0}
.feed-item{
  padding:12px 0;border-bottom:1px solid var(--border);
  animation:slideIn .4s ease;opacity:1;
}
.feed-item:last-child{border-bottom:none}
@keyframes slideIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}
.feed-dir{display:inline-block;font-size:9px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;padding:2px 7px;border-radius:4px;margin-bottom:5px}
.dir-in{background:rgba(96,165,250,0.15);color:var(--blue)}
.dir-out{background:rgba(200,169,110,0.15);color:var(--gold)}
.feed-body{font-size:12px;color:var(--muted);line-height:1.5;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.feed-time{font-size:10px;color:var(--dim);margin-top:4px}

/* ── CHANNEL GRID ── */
.channels{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.channel-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center}
.channel-icon{font-size:24px;margin-bottom:8px}
.channel-name{font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.channel-count{font-size:28px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--gold2)}

/* ── GOLD TEXT ── */
.gold{color:var(--gold)}
.green{color:var(--green)}

/* ── RESPONSIVE ── */
@media(max-width:900px){
  .stats-grid{grid-template-columns:repeat(2,1fr)}
  .mid-row{grid-template-columns:1fr}
  header{padding:16px 20px}
  .page{padding:20px}
}
</style>
</head>
<body>

<header>
  <div class="wordmark">LUXSTUDIOS <span>COMMAND CENTER</span></div>
  <div style="display:flex;align-items:center;gap:24px">
    <div class="live-badge"><div class="pulse"></div>LIVE</div>
    <div class="last-update" id="ts">—</div>
  </div>
</header>

<div class="page">

  <!-- HERO REVENUE -->
  <div class="hero">
    <div class="hero-label">Total Revenue Generated</div>
    <div class="hero-num" id="revenue" data-target="${stats.revenue}">$0</div>
    <div class="hero-sub">${stats.purchased} closed deal${stats.purchased !== 1 ? 's' : ''} · ${stats.convRate}% conversion rate · avg $${PACKAGES.avg.toLocaleString()} per sale</div>
  </div>

  <!-- STAT CARDS -->
  <div class="stats-grid">
    <div class="stat">
      <div class="stat-label">Total Leads</div>
      <div class="stat-value gold" id="s-leads" data-target="${stats.totalLeads}">0</div>
      <div class="stat-sub">Airbnb hosts contacted</div>
      <div class="stat-accent gold-bar"></div>
    </div>
    <div class="stat">
      <div class="stat-label">Active Conversations</div>
      <div class="stat-value" id="s-active" data-target="${(stats.stages.pitched || 0) + (stats.stages.closing || 0)}">0</div>
      <div class="stat-sub">In sales funnel now</div>
      <div class="stat-accent blue-bar"></div>
    </div>
    <div class="stat">
      <div class="stat-label">Messages Sent</div>
      <div class="stat-value" id="s-sent" data-target="${stats.outbound}">0</div>
      <div class="stat-sub">${stats.inbound} received</div>
      <div class="stat-accent gold-bar"></div>
    </div>
    <div class="stat">
      <div class="stat-label">Purchases</div>
      <div class="stat-value green" id="s-purchased" data-target="${stats.purchased}">0</div>
      <div class="stat-sub">${stats.convRate}% close rate</div>
      <div class="stat-accent green-bar"></div>
    </div>
  </div>

  <!-- FUNNEL + FEED -->
  <div class="mid-row">
    <div class="funnel-card">
      <div class="card-title">Conversion Funnel</div>
      <div class="funnel-stages" id="funnel">
        ${buildFunnel(stats)}
      </div>
    </div>
    <div class="feed-card">
      <div class="card-title">Live Activity</div>
      <div class="feed-list" id="feed">
        ${buildFeed(stats.activity)}
      </div>
    </div>
  </div>

  <!-- CHANNELS -->
  <div class="channels">
    <div class="channel-card">
      <div class="channel-icon">🏠</div>
      <div class="channel-name">Airbnb</div>
      <div class="channel-count">${stats.totalLeads}</div>
    </div>
    <div class="channel-card">
      <div class="channel-icon">💬</div>
      <div class="channel-name">SMS</div>
      <div class="channel-count">${stats.byChannel?.sms || 0}</div>
    </div>
    <div class="channel-card">
      <div class="channel-icon">✉️</div>
      <div class="channel-name">Email</div>
      <div class="channel-count">${stats.byChannel?.email || 0}</div>
    </div>
  </div>

</div>

<script>
// ── Counter animation ──
function animateCount(el, target, prefix='', suffix='', duration=1800) {
  const start = Date.now();
  const isFloat = String(target).includes('.');
  function tick() {
    const p = Math.min((Date.now() - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 4);
    const val = target * ease;
    el.textContent = prefix + (isFloat ? val.toFixed(1) : Math.floor(val).toLocaleString()) + suffix;
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = prefix + (isFloat ? target.toFixed(1) : target.toLocaleString()) + suffix;
  }
  requestAnimationFrame(tick);
}

window.addEventListener('DOMContentLoaded', () => {
  animateCount(document.getElementById('revenue'), ${stats.revenue}, '$', '', 2200);
  animateCount(document.getElementById('s-leads'), ${stats.totalLeads}, '', '', 1400);
  animateCount(document.getElementById('s-active'), ${(stats.stages.pitched || 0) + (stats.stages.closing || 0)}, '', '', 1400);
  animateCount(document.getElementById('s-sent'), ${stats.outbound}, '', '', 1400);
  animateCount(document.getElementById('s-purchased'), ${stats.purchased}, '', '', 1400);

  // Animate funnel bars
  setTimeout(() => {
    document.querySelectorAll('.funnel-bar[data-w]').forEach(b => {
      b.style.width = b.dataset.w;
    });
  }, 300);

  // Timestamp
  document.getElementById('ts').textContent = 'Updated ' + new Date('${stats.ts}').toLocaleTimeString();
});

// ── Auto-refresh every 30s ──
setTimeout(() => location.reload(), 30000);
</script>
</body>
</html>`;

function buildFunnel(stats) {
  const s = stats.stages;
  const total = stats.totalLeads || 1;
  const rows = [
    { key: 'outreach_sent', label: 'Outreach', cls: 'bar-outreach', count: s.outreach_sent || 0 },
    { key: 'pitched',       label: 'Pitched',  cls: 'bar-pitched',  count: s.pitched || 0 },
    { key: 'closing',       label: 'Closing',  cls: 'bar-closing',  count: s.closing || 0 },
    { key: 'purchased',     label: 'Purchased',cls: 'bar-purchased', count: s.purchased || 0 },
    { key: 'done',          label: 'Delivered',cls: 'bar-done',      count: (s.video_sent || 0) + (s.done || 0) },
  ];
  return rows.map(r => {
    const pct = Math.max(4, Math.round((r.count / total) * 100));
    return `<div class="funnel-row">
      <div class="funnel-label">${r.label}</div>
      <div class="funnel-bar-wrap">
        <div class="funnel-bar ${r.cls}" data-w="${pct}%" style="width:0%"></div>
      </div>
      <div class="funnel-count">${r.count}</div>
    </div>`;
  }).join('');
}

function buildFeed(msgs) {
  if (!msgs || msgs.length === 0) {
    return '<div style="color:var(--dim);font-size:13px;padding:24px 0;text-align:center">Waiting for activity...</div>';
  }
  return msgs.map(m => {
    const dir = m.direction === 'inbound' ? 'in' : 'out';
    const label = m.direction === 'inbound' ? 'HOST' : 'CLAUDE';
    const body = (m.body || '').replace(/</g, '&lt;').slice(0, 120);
    const time = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `<div class="feed-item">
      <span class="feed-dir dir-${dir}">${label}</span>
      <div class="feed-body">${body}</div>
      <div class="feed-time">${time}</div>
    </div>`;
  }).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/stats') {
      const stats = await getStats(env);
      return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }

    const stats = await getStats(env);
    return new Response(HTML(stats), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' },
    });
  },
};
