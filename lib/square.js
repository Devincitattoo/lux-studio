const { SquareClient, SquareEnvironment, WebhooksHelper } = require('square');
const { v4: uuidv4 } = require('uuid');

const PACKAGES = {
  essential: { name: 'Lux Studio Essential Package', amount: 79900 },
  signature: { name: 'Lux Studio Signature Package', amount: 139900 },
  estate: { name: 'Lux Studio Estate Package', amount: 200000 },
};

function getClient(env) {
  const accessToken = env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) throw new Error('SQUARE_ACCESS_TOKEN is not configured');

  return new SquareClient({
    token: accessToken,
    environment: env.SQUARE_ENVIRONMENT === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
  });
}

function getBaseUrl(env) {
  return env.BASE_URL || `http://localhost:${env.PORT || 3000}`;
}

async function createPaymentLink(env, packageKey) {
  const pkg = PACKAGES[packageKey.toLowerCase()];
  if (!pkg) throw new Error(`Unknown package: ${packageKey}`);

  const storedUrl = env[`PAY_LINK_${packageKey.toUpperCase()}`];
  if (storedUrl) {
    return {
      url: storedUrl,
      paymentLinkId: null,
      orderId: null,
      packageKey: packageKey.toLowerCase(),
      amount: pkg.amount,
    };
  }

  const locationId = env.SQUARE_LOCATION_ID;
  if (!locationId) throw new Error('SQUARE_LOCATION_ID is not configured');

  const currency = env.SQUARE_CURRENCY || 'USD';
  const client = getClient(env);
  const response = await client.checkout.paymentLinks.create({
    idempotencyKey: uuidv4(),
    quickPay: {
      name: pkg.name,
      priceMoney: {
        amount: BigInt(pkg.amount),
        currency,
      },
      locationId,
    },
    checkoutOptions: {
      redirectUrl: `${getBaseUrl(env)}/payment-success`,
    },
  });

  if (response.errors) {
    throw new Error(response.errors.map((e) => e.detail || e.message).join('; '));
  }

  const paymentLink = response.paymentLink;
  return {
    url: paymentLink.url,
    paymentLinkId: paymentLink.id,
    orderId: paymentLink.orderId,
    packageKey: packageKey.toLowerCase(),
    amount: pkg.amount,
  };
}

async function verifyWebhook(env, body, signature) {
  const signatureKey = env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) throw new Error('SQUARE_WEBHOOK_SIGNATURE_KEY is not configured');

  const notificationUrl = `${getBaseUrl(env)}/square-webhook`;
  return WebhooksHelper.verifySignature({
    requestBody: Buffer.isBuffer(body) ? body.toString() : String(body || ''),
    signatureHeader: signature,
    signatureKey,
    notificationUrl,
  });
}

module.exports = { PACKAGES, createPaymentLink, verifyWebhook };
