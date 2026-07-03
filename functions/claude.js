const Anthropic = require('@anthropic-ai/sdk');

const DRAFT_REPLY_TOOL = {
  name: 'draft_reply',
  description: 'Draft a reply to the incoming message and classify whether it is safe to send automatically.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'The reply text to send, written in the persona described in the system prompt.' },
      classification: {
        type: 'string',
        enum: ['routine', 'needs_review'],
        description:
          "'routine' only if the reply is low-stakes, factual/predictable, and matches the persona's stated auto-reply boundaries exactly. 'needs_review' for anything involving money, scheduling changes, complaints, disputes, personal/emotional topics, legal matters, or any ambiguity about what the sender wants.",
      },
      reasoning: { type: 'string', description: 'One sentence on why this classification was chosen.' },
    },
    required: ['reply', 'classification', 'reasoning'],
  },
};

const PERSONA_BY_CHANNEL = {
  sms: 'persona',
  email: 'persona-email',
};

async function draftReply(context, { history, incomingBody, channel = 'sms' }) {
  const personaModule = PERSONA_BY_CHANNEL[channel] || PERSONA_BY_CHANNEL.sms;
  const persona = require(Runtime.getFunctions()[personaModule].path);
  const client = new Anthropic({ apiKey: context.ANTHROPIC_API_KEY });
  const model = context.CLAUDE_MODEL || 'claude-sonnet-5';

  const conversation = history
    .map((m) => `${m.direction === 'inbound' ? 'Them' : 'You'}: ${m.body}`)
    .join('\n');

  const userPrompt = [
    conversation ? `Conversation so far:\n${conversation}\n` : '',
    `New incoming message: "${incomingBody}"`,
    '',
    'Draft a reply and classify it using the draft_reply tool.',
  ].join('\n');

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: persona,
    tools: [DRAFT_REPLY_TOOL],
    tool_choice: { type: 'tool', name: 'draft_reply' },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a draft_reply tool call');

  return toolUse.input;
}

module.exports = { draftReply };
