import { describe, expect, test } from 'vitest';
import { config } from './config.js';
import { StateStore } from './state.js';
import { buildRunSummary, checkReplies, dispatchPitches, discoverLeads, validateRun } from './workflow.js';

const testState = async () => {
  const store = new StateStore('data/test-state.json');
  await store.save({
    leads: [],
    communications: [],
    metrics: {
      cyclesRun: 0,
      discovered: 0,
      pitched: 0,
      replies: 0,
      converted: 0,
      videosCreated: 0,
      errors: 0
    }
  });
  return store;
};

describe('workflow', () => {
  test('discovers new leads and updates metrics', async () => {
    const store = await testState();
    const state = await store.load();
    const discovered = await discoverLeads(state, config);

    expect(discovered.length).toBeLessThanOrEqual(config.maxLeadsPerRun);
    expect(state.leads.length).toBe(discovered.length);
    expect(state.metrics.discovered).toBe(discovered.length);
  });

  test('dispatches pitches for discovered leads', async () => {
    const store = await testState();
    const state = await store.load();
    await discoverLeads(state, config);
    const outbound = await dispatchPitches(state, config);

    expect(outbound.length).toBe(state.leads.length);
    expect(state.leads.every((lead) => lead.status === 'contacted')).toBe(true);
    expect(state.metrics.pitched).toBe(outbound.length);
  });

  test('simulates replies and conversion in test mode', async () => {
    const originalTestMode = config.testMode;
    config.testMode = true;

    const store = await testState();
    const state = await store.load();
    await discoverLeads(state, config);
    await dispatchPitches(state, config);
    const replies = await checkReplies(state, config);

    expect(replies.length).toBeGreaterThan(0);
    expect(state.leads.some((lead) => lead.status === 'converted')).toBe(true);
    expect(state.metrics.replies).toBe(replies.length);
    expect(state.metrics.converted).toBeGreaterThanOrEqual(0);

    config.testMode = originalTestMode;
  });

  test('validates stored state successfully', async () => {
    const store = await testState();
    const state = await store.load();
    await discoverLeads(state, config);
    const result = validateRun(state);

    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('builds a summary string', async () => {
    const store = await testState();
    const state = await store.load();
    await discoverLeads(state, config);
    await dispatchPitches(state, config);
    state.metrics.cyclesRun = 1;

    const summary = buildRunSummary(state);
    expect(summary).toContain('cyclesRun=1');
    expect(summary).toContain('discovered=');
  });
});
