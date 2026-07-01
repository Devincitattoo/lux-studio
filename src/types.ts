export type CommunicationChannel = 'email' | 'sms' | 'platform';
export type LeadStatus = 'new' | 'contacted' | 'replied' | 'converted' | 'ignored';

export interface Lead {
  id: string;
  source: string;
  name: string;
  location: string;
  listingUrl: string;
  email: string;
  phone: string;
  propertySize: string;
  budgetRange: string;
  status: LeadStatus;
  discoveredAt: string;
  lastContactedAt?: string;
  lastReply?: string;
  convertedAt?: string;
  paymentIntentId?: string;
  paymentStatus?: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'canceled' | 'succeeded';
  videoRequestId?: string;
  videoUrl?: string;
  videoGeneratedAt?: string;
  notes?: string;
}

export interface Pitch {
  leadId: string;
  channel: CommunicationChannel;
  subject: string;
  body: string;
  createdAt: string;
  sent: boolean;
}

export interface CommunicationEvent {
  id: string;
  leadId: string;
  channel: CommunicationChannel;
  direction: 'outbound' | 'inbound';
  message: string;
  timestamp: string;
}

export interface WorkflowMetrics {
  cyclesRun: number;
  discovered: number;
  pitched: number;
  replies: number;
  converted: number;
  videosCreated: number;
  errors: number;
}

export interface WorkflowState {
  leads: Lead[];
  communications: CommunicationEvent[];
  metrics: WorkflowMetrics;
}

export interface WorkflowConfig {
  discoveryIntervalMinutes: number;
  replyCheckIntervalMinutes: number;
  maxLeadsPerRun: number;
  sendChannels: CommunicationChannel[];
  sourceAreas: string[];
  dryRun: boolean;
  testMode: boolean;
  stripeSecretKey?: string;
  useLiveDiscovery?: boolean;
  useLiveMessaging?: boolean;
  useLiveReplies?: boolean;
  leadSourceProvider?: 'google-places' | 'apify-airbnb' | 'mock';
  leadSourceApiKey?: string;
  apifyToken?: string;
  apifyActorId?: string;
  apifyTaskId?: string;
  apifyDatasetId?: string;
  apifyInput?: string;
  apifyRunTimeoutMs?: number;
  sendgridApiKey?: string;
  sendgridSender?: string;
  replySourceUrl?: string;
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  landingPageUrl?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioSender?: string;
  airbnbApiToken?: string;
  airbnbBusinessProfileId?: string;
  mcpServerUrl?: string;
  mcpApiKey?: string;
  liveDashboardUrl?: string;
  useVideoGeneration?: boolean;
  higgsfieldApiKey?: string;
  higgsfieldProjectId?: string;
  higgsfieldModel?: string;
  higgsfieldCallbackUrl?: string;
}
