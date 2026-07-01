import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { discoverLiveLeads, fetchLiveReplies, requestVideoGenerationForLead, sendLiveMessage } from './liveIntegrations.js';
import { CommunicationChannel, Lead, WorkflowConfig, WorkflowState, CommunicationEvent } from './types.js';

const now = (): string => new Date().toISOString();

function createStripeClient(config: WorkflowConfig): Stripe | null {
  if (!config.stripeSecretKey) {
    return null;
  }

  return new Stripe(config.stripeSecretKey, { apiVersion: '2022-11-15' });
}

async function createPaymentIntentForLead(lead: Lead, config: WorkflowConfig): Promise<{ id: string; status: string } | null> {
  const stripe = createStripeClient(config);
  if (!stripe) {
    return null;
  }

  const amount = lead.budgetRange.includes('$799') ? 79900 : 140000;
  const description = `Premium Airbnb flythrough video for ${lead.propertySize} in ${lead.location}`;

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    description,
    metadata: {
      leadId: lead.id,
      leadName: lead.name,
      location: lead.location
    }
  });

  return { id: paymentIntent.id, status: paymentIntent.status };
}

function createSampleLead(source: string, location: string, index: number): Lead {
  const propertySize = index % 2 === 0 ? '7-bedroom estate' : '5-bedroom villa';
  const budgetRange = index % 2 === 0 ? '$1,400 - $2,000' : '$799 - $1,350';
  const email = `owner${index + 1}@luxlistings.example.com`;
  const phone = `+1-555-01${String(index + 1).padStart(2, '0')}`;

  return {
    id: randomUUID(),
    source,
    name: `Owner ${index + 1}`,
    location,
    listingUrl: `https://airbnb.example.com/listing/${source.replace(/[^a-z0-9]/gi, '').toLowerCase()}-${index + 1}`,
    email,
    phone,
    propertySize,
    budgetRange,
    status: 'new',
    discoveredAt: now(),
    notes: 'High-end vacation property with lifestyle marketing appeal.'
  };
}

export async function discoverLeads(state: WorkflowState, config: WorkflowConfig): Promise<Lead[]> {
  const existingUrls = new Set(state.leads.map((lead) => lead.listingUrl));
  let discovered: Lead[] = [];

  if (config.useLiveDiscovery) {
    console.log('Live discovery enabled; fetching leads from provider:', config.leadSourceProvider);
    discovered = await discoverLiveLeads(config);
  } else {
    console.warn('Live discovery is disabled. To fetch real leads, set LIVE_DISCOVERY=true and provide the proper live source credentials.');
    const sources = config.sourceAreas.slice(0, config.maxLeadsPerRun);
    discovered = sources
      .map((area, index) => createSampleLead('airbnb-scrape', area, index))
      .slice(0, config.maxLeadsPerRun);
  }

  const uniqueLeads = discovered.filter((lead) => !existingUrls.has(lead.listingUrl)).slice(0, config.maxLeadsPerRun);
  if (uniqueLeads.length === 0) {
    return [];
  }

  state.leads.push(...uniqueLeads);
  state.metrics.discovered += uniqueLeads.length;
  return uniqueLeads;
}

export function createPitchForLead(lead: Lead, channel: CommunicationChannel): CommunicationEvent {
  const subject = `Luxury video flythrough offer for your ${lead.propertySize}`;
  const body = `Hi ${lead.name},

I specialize in converting elite properties like yours in ${lead.location} into premium bookings with cinematic video flythroughs. I can create a high-end walk-through video that attracts higher-paying Airbnb guests and justifies a $799–$2,000 production investment.

Would you like a quick proposal based on your ${lead.propertySize}?`
    .trim();

  const videoNote = lead.videoUrl ? `\n\nPreview your custom sample: ${lead.videoUrl}` : '';

  return {
    id: randomUUID(),
    leadId: lead.id,
    channel,
    direction: 'outbound',
    message: `${subject}\n\n${body}${videoNote}`,
    timestamp: now()
  };
}

export async function dispatchPitches(state: WorkflowState, config: WorkflowConfig): Promise<CommunicationEvent[]> {
  const outbound: CommunicationEvent[] = [];
  const pendingLeads = state.leads.filter((lead) => lead.status === 'new');

  for (const lead of pendingLeads) {
    if (config.useVideoGeneration) {
      const videoInfo = await requestVideoGenerationForLead(lead, config);
      if (videoInfo.videoRequestId) {
        lead.videoRequestId = videoInfo.videoRequestId;
      }
      if (videoInfo.videoUrl) {
        lead.videoUrl = videoInfo.videoUrl;
        lead.videoGeneratedAt = videoInfo.videoGeneratedAt;
        state.metrics.videosCreated += 1;
        console.log(`Generated video preview for lead ${lead.id}: ${videoInfo.videoUrl}`);
      } else {
        console.log(`Requested video generation for lead ${lead.id} (request ${videoInfo.videoRequestId}).`);
      }
    }

    const index = config.sendChannels.length > 0 ? lead.id.length % config.sendChannels.length : 0;
    const channel = (config.sendChannels[index] ?? 'email') as CommunicationChannel;
    const communication = createPitchForLead(lead, channel);
    outbound.push(communication);
    state.communications.push(communication);
    lead.status = 'contacted';
    lead.lastContactedAt = now();

    if (config.useLiveMessaging) {
      if (!config.sendgridApiKey || !config.sendgridSender) {
        throw new Error('LIVE_MESSAGING is enabled, but SENDGRID_API_KEY or SENDGRID_SENDER is not set. Fill in SendGrid credentials to send live emails.');
      }
      const sent = await sendLiveMessage(communication, lead, config);
      console.log(sent ? `Live message sent to ${lead.email}` : `Live messaging failed for ${lead.email}`);
    }

    const paymentIntent = await createPaymentIntentForLead(lead, config);
    if (paymentIntent) {
      lead.paymentIntentId = paymentIntent.id;
      lead.paymentStatus = paymentIntent.status as Lead['paymentStatus'];
      console.log(`Created Stripe PaymentIntent ${paymentIntent.id} for lead ${lead.id}`);
    } else {
      console.log(`Stripe key missing: skipping payment intent for lead ${lead.id}`);
    }
  }

  state.metrics.pitched += outbound.length;
  return outbound;
}

function shouldReply(lead: Lead, config: WorkflowConfig): boolean {
  if (config.testMode) {
    return lead.status === 'contacted';
  }
  return lead.status === 'contacted' && Math.random() > 0.6;
}

export async function checkReplies(state: WorkflowState, config: WorkflowConfig): Promise<CommunicationEvent[]> {
  const replies: CommunicationEvent[] = [];
  const contactedLeads = state.leads.filter((lead) => lead.status === 'contacted');

  if (config.useLiveReplies) {
    if (!config.replySourceUrl) {
      throw new Error('LIVE_REPLIES is enabled, but REPLY_SOURCE_URL is not set. Fill in a live reply endpoint to capture inbound messages.');
    }
    console.log('Live replies enabled; polling reply source:', config.replySourceUrl);
    const liveReplies = await fetchLiveReplies(config);
    for (const candidate of liveReplies) {
      const lead = state.leads.find((item) => item.id === candidate.leadId && item.status === 'contacted');
      if (!lead) {
        continue;
      }

      const reply: CommunicationEvent = {
        id: randomUUID(),
        leadId: lead.id,
        channel: candidate.channel,
        direction: 'inbound',
        message: candidate.message,
        timestamp: now()
      };

      state.communications.push(reply);
      replies.push(reply);
      lead.status = 'replied';
      lead.lastReply = now();
      state.metrics.replies += 1;

      if (config.testMode || Math.random() > 0.5) {
        lead.status = 'converted';
        lead.convertedAt = now();
        state.metrics.converted += 1;
      }
    }

    return replies;
  }

  for (const lead of contactedLeads) {
    if (!shouldReply(lead, config)) {
      continue;
    }

    const message = `Hi, I saw your proposal and I am interested in a premium video flythrough for my ${lead.propertySize}. Please send details and pricing.`;
    const reply: CommunicationEvent = {
      id: randomUUID(),
      leadId: lead.id,
      channel: 'platform',
      direction: 'inbound',
      message,
      timestamp: now()
    };

    state.communications.push(reply);
    replies.push(reply);
    lead.status = 'replied';
    lead.lastReply = now();
    state.metrics.replies += 1;

    if (config.testMode || Math.random() > 0.5) {
      lead.status = 'converted';
      lead.convertedAt = now();
      state.metrics.converted += 1;
    }
  }

  return replies;
}

export function validateRun(state: WorkflowState): { success: boolean; issues: string[] } {
  const issues: string[] = [];
  const ids = new Set<string>();

  for (const lead of state.leads) {
    if (ids.has(lead.id)) {
      issues.push(`Duplicate lead id detected: ${lead.id}`);
    }
    ids.add(lead.id);
    if (!lead.email || !lead.listingUrl || !lead.name) {
      issues.push(`Incomplete lead record for ${lead.id}`);
    }
  }

  if (state.metrics.discovered < 0) {
    issues.push('Discovered count is negative.');
  }

  return { success: issues.length === 0, issues };
}

export function buildRunSummary(state: WorkflowState): string {
  return [
    `cyclesRun=${state.metrics.cyclesRun}`,
    `discovered=${state.metrics.discovered}`,
    `pitched=${state.metrics.pitched}`,
    `replies=${state.metrics.replies}`,
    `converted=${state.metrics.converted}`,
    `videosCreated=${state.metrics.videosCreated}`,
    `errors=${state.metrics.errors}`
  ].join(', ');
}
