// Deploys this project to Twilio Serverless (Twilio Functions) using the
// Twilio REST API directly — no `twilio-cli` serverless plugin required.
//
// Usage: TWILIO_SID=AC... TWILIO_TOKEN=... node deploy.js

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');

const SID = process.env.TWILIO_SID;
const TOKEN = process.env.TWILIO_TOKEN;
if (!SID || !TOKEN) {
  console.error('Set TWILIO_SID and TWILIO_TOKEN env vars before running this script.');
  process.exit(1);
}

const BASE = 'https://serverless.twilio.com/v1';
const AUTH = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');

async function api(method, url, { form, json } = {}) {
  const headers = { Authorization: AUTH };
  let body;
  if (form) {
    body = form; // FormData sets its own multipart Content-Type
  } else if (json) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(json);
  }
  const res = await fetch(url.startsWith('http') ? url : `${BASE}${url}`, { method, headers, body });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status}: ${text}`);
  }
  return data;
}

const SERVICE_UNIQUE_NAME = 'reply-assistant';
const ENVIRONMENT_UNIQUE_NAME = 'production';

const FUNCTIONS = [
  { file: 'sms.js', name: 'sms', routePath: '/sms', visibility: 'protected' },
  { file: 'email-inbound.js', name: 'email-inbound', routePath: '/email-inbound', visibility: 'public' },
  { file: 'dashboard.js', name: 'dashboard', routePath: '/dashboard', visibility: 'public' },
  { file: 'dashboard-action.js', name: 'dashboard-action', routePath: '/dashboard-action', visibility: 'public' },
  { file: 'db.js', name: 'db', routePath: '/db', visibility: 'private' },
  { file: 'claude.js', name: 'claude', routePath: '/claude', visibility: 'private' },
  { file: 'sendgrid.js', name: 'sendgrid', routePath: '/sendgrid', visibility: 'private' },
  { file: 'dashboard-view.js', name: 'dashboard-view', routePath: '/dashboard-view', visibility: 'private' },
  { file: 'persona.js', name: 'persona', routePath: '/persona', visibility: 'private' },
  { file: 'persona-email.js', name: 'persona-email', routePath: '/persona-email', visibility: 'private' },
];

const ENV_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SECRET_KEY',
  'ANTHROPIC_API_KEY',
  'CLAUDE_MODEL',
  'TWILIO_PHONE_NUMBER',
  'DASHBOARD_SECRET',
  'AUTO_SEND_ENABLED',
  'SENDGRID_API_KEY',
  'FROM_EMAIL',
  'FORWARD_EMAIL',
];

async function findOrCreateService() {
  const list = await api('GET', '/Services?PageSize=50');
  const existing = list.services.find((s) => s.unique_name === SERVICE_UNIQUE_NAME);
  if (existing) {
    console.log(`Using existing service ${existing.sid}`);
    return existing;
  }
  const created = await api('POST', '/Services', {
    json: { UniqueName: SERVICE_UNIQUE_NAME, FriendlyName: 'Reply Assistant', IncludeCredentials: 'true' },
  });
  console.log(`Created service ${created.sid}`);
  return created;
}

async function findOrCreateEnvironment(serviceSid) {
  const list = await api('GET', `/Services/${serviceSid}/Environments?PageSize=50`);
  const existing = list.environments.find((e) => e.unique_name === ENVIRONMENT_UNIQUE_NAME);
  if (existing) {
    console.log(`Using existing environment ${existing.sid}`);
    return existing;
  }
  const created = await api('POST', `/Services/${serviceSid}/Environments`, {
    json: { UniqueName: ENVIRONMENT_UNIQUE_NAME },
  });
  console.log(`Created environment ${created.sid}`);
  return created;
}

async function syncVariables(serviceSid, envSid) {
  const list = await api('GET', `/Services/${serviceSid}/Environments/${envSid}/Variables?PageSize=50`);
  const existingByKey = Object.fromEntries(list.variables.map((v) => [v.key, v]));

  for (const key of ENV_VARS) {
    const value = process.env[key];
    if (value === undefined) {
      console.warn(`Skipping ${key} — not set in .env`);
      continue;
    }
    if (existingByKey[key]) {
      await api('POST', `/Services/${serviceSid}/Environments/${envSid}/Variables/${existingByKey[key].sid}`, {
        json: { Value: value },
      });
    } else {
      await api('POST', `/Services/${serviceSid}/Environments/${envSid}/Variables`, {
        json: { Key: key, Value: value },
      });
    }
  }
  console.log(`Synced ${ENV_VARS.length} environment variables`);
}

async function findOrCreateFunction(serviceSid, friendlyName) {
  const list = await api('GET', `/Services/${serviceSid}/Functions?PageSize=50`);
  const existing = list.functions.find((f) => f.friendly_name === friendlyName);
  if (existing) return existing;
  return api('POST', `/Services/${serviceSid}/Functions`, { json: { FriendlyName: friendlyName } });
}

async function uploadFunctionVersion(serviceSid, functionSid, fn) {
  const content = fs.readFileSync(path.join(__dirname, 'functions', fn.file), 'utf8');
  const form = new FormData();
  form.append('Path', fn.routePath);
  form.append('Visibility', fn.visibility);
  form.append('Content', new Blob([content], { type: 'application/javascript' }), fn.file);

  const version = await api(
    'POST',
    `https://serverless-upload.twilio.com/v1/Services/${serviceSid}/Functions/${functionSid}/Versions`,
    { form }
  );
  console.log(`Uploaded ${fn.routePath} (${fn.visibility}) -> version ${version.sid}`);
  return version;
}

async function createBuild(serviceSid, functionVersionSids) {
  const dependencies = JSON.stringify([
    { name: '@anthropic-ai/sdk', version: '0.32.1' },
    { name: '@supabase/supabase-js', version: '2.110.0' },
  ]);

  const form = new FormData();
  for (const sid of functionVersionSids) form.append('FunctionVersions', sid);
  form.append('Dependencies', dependencies);

  const build = await api('POST', `/Services/${serviceSid}/Builds`, { form });
  console.log(`Created build ${build.sid}, waiting for it to complete...`);

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const status = await api('GET', `/Services/${serviceSid}/Builds/${build.sid}/Status`);
    console.log(`  build status: ${status.status}`);
    if (status.status === 'completed') return build;
    if (status.status === 'failed') throw new Error(`Build failed: ${JSON.stringify(status)}`);
  }
  throw new Error('Timed out waiting for build to complete');
}

async function deploy(serviceSid, envSid, buildSid) {
  const deployment = await api('POST', `/Services/${serviceSid}/Environments/${envSid}/Deployments`, {
    json: { BuildSid: buildSid },
  });
  console.log(`Created deployment ${deployment.sid}`);
  return deployment;
}

async function main() {
  const service = await findOrCreateService();
  const env = await findOrCreateEnvironment(service.sid);

  await syncVariables(service.sid, env.sid);

  const versionSids = [];
  for (const fn of FUNCTIONS) {
    const fnResource = await findOrCreateFunction(service.sid, fn.name);
    const version = await uploadFunctionVersion(service.sid, fnResource.sid, fn);
    versionSids.push(version.sid);
  }

  const build = await createBuild(service.sid, versionSids);
  await deploy(service.sid, env.sid, build.sid);

  const finalEnv = await api('GET', `/Services/${service.sid}/Environments/${env.sid}`);
  console.log('\nDeployed. Domain:', finalEnv.domain_name);
  for (const fn of FUNCTIONS) {
    if (fn.visibility !== 'private') {
      console.log(`  https://${finalEnv.domain_name}${fn.routePath}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
