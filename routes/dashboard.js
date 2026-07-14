const db = require('../lib/db');
const { renderDashboard } = require('../lib/dashboard-view');

async function renderQueue(env, key) {
  const stats = db.getDashboardStats(env);
  const pending = db.listPendingReplies(env);
  const recentMessages = db.listRecentMessages(env, 30);
  const airbnbLeads = db.listAirbnbLeads(env, 100);
  const payments = db.listPayments(env, 50);
  const videoJobs = db.listVideoJobs(env, 50);
  const interventions = db.listInterventions(env, null, 50);
  return renderDashboard({
    stats,
    pending,
    recentMessages,
    airbnbLeads,
    payments,
    videoJobs,
    interventions,
    key,
  });
}

module.exports = { renderQueue };
