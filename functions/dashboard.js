// Not .protected.js: this is loaded by a human in a browser, not signed by Twilio.
// Access is gated by a shared-secret query param instead (?key=...) — see DASHBOARD_SECRET.
exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/html');

  if (!context.DASHBOARD_SECRET || event.key !== context.DASHBOARD_SECRET) {
    response.setStatusCode(403);
    response.setBody('Forbidden — missing or incorrect ?key=');
    return callback(undefined, response);
  }

  const { listPendingReplies, listRecentMessages } = require(Runtime.getFunctions()['db'].path);
  const { renderDashboard } = require(Runtime.getFunctions()['dashboard-view'].path);

  try {
    const [pending, recentMessages] = await Promise.all([listPendingReplies(context), listRecentMessages(context, 30)]);
    response.setBody(renderDashboard({ pending, recentMessages, key: event.key }));
  } catch (err) {
    console.error('Failed to load dashboard:', err);
    response.setStatusCode(500);
    response.setBody('Something went wrong loading the queue.');
  }

  callback(undefined, response);
};
