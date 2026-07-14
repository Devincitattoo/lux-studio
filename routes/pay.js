const square = require('../lib/square');

async function handlePayRequest(env, packageKey) {
  return square.createPaymentLink(env, packageKey);
}

module.exports = { handlePayRequest };
