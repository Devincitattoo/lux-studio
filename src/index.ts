import { config } from './config.js';
import { StateStore } from './state.js';
import { buildRunSummary, checkReplies, dispatchPitches, discoverLeads, validateRun } from './workflow.js';

const stateStore = new StateStore();

async function runDiscoveryCycle(): Promise<void> {
  const state = await stateStore.load();
  console.log('Starting discovery cycle...');

  try {
    const discovered = await discoverLeads(state, config);
    const pitched = await dispatchPitches(state, config);
    state.metrics.cyclesRun += 1;

    const verification = validateRun(state);
    if (!verification.success) {
      state.metrics.errors += 1;
      console.error('Verification issues:', verification.issues.join('; '));
    }

    if (config.dryRun) {
      console.log('Dry run enabled; state changes are not persisted.');
    } else {
      await stateStore.save(state);
    }

    console.log(`Discovery cycle complete. discovered=${discovered.length}, pitched=${pitched.length}`);
    console.log(buildRunSummary(state));
  } catch (error) {
    console.error('Discovery cycle failed:', error);
  }
}

async function runReplyCycle(): Promise<void> {
  const state = await stateStore.load();
  console.log('Starting reply check cycle...');

  try {
    const replies = await checkReplies(state, config);
    if (replies.length === 0) {
      console.log('No new replies were captured this cycle.');
    } else {
      console.log(`Captured ${replies.length} reply(s).`);
    }

    const verification = validateRun(state);
    if (!verification.success) {
      state.metrics.errors += 1;
      console.error('Verification issues:', verification.issues.join('; '));
    }

    if (config.dryRun) {
      console.log('Dry run enabled; state changes are not persisted.');
    } else {
      await stateStore.save(state);
    }

    console.log(buildRunSummary(state));
  } catch (error) {
    console.error('Reply check cycle failed:', error);
  }
}

async function start(): Promise<void> {
  console.log('Starting Lux Studio workflow. Dry run:', config.dryRun);

  await runDiscoveryCycle();
  await runReplyCycle();

  if (process.env.RUN_ONCE === 'true') {
    console.log('RUN_ONCE is enabled; exiting after one pass.');
    return;
  }

  const discoveryIntervalMs = config.discoveryIntervalMinutes * 60 * 1000;
  const replyIntervalMs = config.replyCheckIntervalMinutes * 60 * 1000;

  setInterval(async () => {
    await runDiscoveryCycle();
  }, discoveryIntervalMs);

  setInterval(async () => {
    await runReplyCycle();
  }, replyIntervalMs);

  process.on('SIGINT', async () => {
    console.log('\nReceived interrupt. Saving state and exiting...');
    const state = await stateStore.load();
    if (config.dryRun) {
      console.log('Dry run enabled; state changes are not persisted.');
    } else {
      await stateStore.save(state);
      console.log('State saved successfully.');
    }
    console.log(buildRunSummary(state));
    process.exit(0);
  });
}

start().catch((error) => {
  console.error('Workflow startup failed:', error);
  process.exit(1);
});
