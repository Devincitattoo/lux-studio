const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';

const db = require('./db');
const smsPersona = require('./persona');
const emailPersona = require('./persona-email');

const PERSONA_BY_CHANNEL = {
  sms: smsPersona,
  email: emailPersona,
};

function extractJson(text) {
  const cleaned = String(text || '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('No JSON object found in Venice response');
  }
  return cleaned.slice(firstBrace, lastBrace + 1);
}

function estimateTokens(text) {
  // Rough fallback when the API does not report usage
  return Math.ceil(String(text || '').length / 4);
}

function computeCost(env, usage, promptText, replyText, model) {
  const inputCostPer1M = parseFloat(env.AI_INPUT_COST_PER_1M || '0.25');
  const outputCostPer1M = parseFloat(env.AI_OUTPUT_COST_PER_1M || '0.75');

  let promptTokens = usage?.prompt_tokens || 0;
  let completionTokens = usage?.completion_tokens || 0;
  let totalTokens = usage?.total_tokens || 0;

  if (!promptTokens && !completionTokens && !totalTokens) {
    promptTokens = estimateTokens(promptText);
    completionTokens = estimateTokens(replyText);
    totalTokens = promptTokens + completionTokens;
  }

  const cost = (promptTokens / 1_000_000) * inputCostPer1M + (completionTokens / 1_000_000) * outputCostPer1M;
  return { promptTokens, completionTokens, totalTokens, cost };
}

async function draftReply(env, { history, incomingBody, channel = 'sms', contactId }) {
  const apiKey = env.VENICE_API_KEY;
  if (!apiKey) throw new Error('VENICE_API_KEY is not configured');

  const persona = PERSONA_BY_CHANNEL[channel] || PERSONA_BY_CHANNEL.sms;
  const model = env.VENICE_MODEL || 'venice-uncensored';

  const systemPrompt = `${persona}

You must respond with a single JSON object containing exactly these keys:
- "reply": string, the reply text to send
- "classification": either "routine" or "needs_review"
- "reasoning": one sentence explaining the classification

Do not include markdown code fences, explanation, or any text outside the JSON object.`;

  const conversation = history
    .map((m) => `${m.direction === 'inbound' ? 'Them' : 'You'}: ${m.body}`)
    .join('\n');

  const userPrompt = [
    conversation ? `Conversation so far:\n${conversation}\n` : '',
    `New incoming message: "${incomingBody}"`,
    '',
    'Respond with JSON only.',
  ].join('\n');

  const res = await fetch(`${VENICE_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      response_format: { type: 'json_object' },
      venice_parameters: { include_venice_system_prompt: false },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Venice API failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonText = extractJson(content);
  const parsed = JSON.parse(jsonText);

  if (!parsed.reply || !parsed.classification) {
    throw new Error('Venice response missing reply or classification');
  }

  const usage = data.usage || {};
  const { promptTokens, completionTokens, totalTokens, cost } = computeCost(
    env,
    usage,
    `${systemPrompt}\n${userPrompt}`,
    parsed.reply,
    model
  );

  try {
    db.recordAiUsage(env, {
      contactId,
      channel,
      model,
      promptTokens,
      completionTokens,
      totalTokens,
      cost,
    });
  } catch (logErr) {
    console.error('Failed to record AI usage cost:', logErr);
  }

  return {
    reply: String(parsed.reply),
    classification: parsed.classification === 'routine' ? 'routine' : 'needs_review',
    reasoning: String(parsed.reasoning || ''),
    cost,
    tokens: { prompt: promptTokens, completion: completionTokens, total: totalTokens },
  };
}

module.exports = { draftReply };
