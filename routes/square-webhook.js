const db = require('../lib/db');
const square = require('../lib/square');

async function handleWebhook(env, body, signature) {
  const isValid = await square.verifyWebhook(env, body, signature);
  if (!isValid) {
    throw new Error('Invalid Square webhook signature');
  }

  const bodyString = Buffer.isBuffer(body) ? body.toString() : String(body || '');
  const event = JSON.parse(bodyString);
  const eventType = event.type || '';

  if (eventType === 'payment.created' || eventType === 'payment.updated') {
    const payment = event.data?.object?.payment || {};
    const orderId = payment.order_id || '';
    const packageName = payment.note || '';

    db.recordPayment(env, {
      squarePaymentId: payment.id || '',
      squareOrderId: orderId,
      packageName,
      amount: payment.amount_money ? Number(payment.amount_money.amount) : null,
      currency: payment.amount_money?.currency || 'USD',
      customerEmail: payment.buyer_email_address || '',
      status: payment.status || '',
      rawEvent: JSON.stringify(event),
    });
  }

  return event;
}

module.exports = { handleWebhook };
