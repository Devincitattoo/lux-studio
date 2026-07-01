import sgMail from '@sendgrid/mail';
import { randomUUID } from 'crypto';
import { CommunicationChannel, CommunicationEvent, Lead, WorkflowConfig } from './types.js';

interface GooglePlacesTextSearchResult {
  place_id: string;
  name: string;
  formatted_address?: string;
  types?: string[];
}

interface GooglePlaceDetails {
  formatted_phone_number?: string;
  website?: string;
}

interface ApifyDatasetItem {
  id?: string;
  title?: string;
  url?: string;
  listingUrl?: string;
  placeUrl?: string;
  address?: string;
  location?: string;
  city?: string;
  neighborhood?: string;
  price?: string | number;
  roomType?: string;
  type?: string;
  hostName?: string;
  hostEmail?: string;
  contactEmail?: string;
  phone?: string;
  contactPhone?: string;
  bedrooms?: number;
  beds?: number;
}

interface GooglePlaceDetails {
  formatted_phone_number?: string;
  website?: string;
}

function normalizeEmail(source: string, fallbackId: string): string {
  try {
    const domain = new URL(source).hostname.replace(/^www\./, '');
    return `info@${domain}`;
  } catch {
    return `lead-${fallbackId}@live-data.example.com`;
  }
}

function mapPlaceToLead(result: GooglePlacesTextSearchResult, details: GooglePlaceDetails): Lead {
  const placeId = result.place_id;
  const listingUrl = details.website ?? `https://maps.google.com/?q=place_id:${placeId}`;
  const email = details.website ? normalizeEmail(details.website, placeId) : `lead-${placeId}@live-data.example.com`;

  return {
    id: `google-places-${placeId}`,
    source: 'google-places',
    name: result.name,
    location: result.formatted_address ?? 'Unknown location',
    listingUrl,
    email,
    phone: details.formatted_phone_number ?? '+1-800-000-0000',
    propertySize: 'Luxury vacation rental',
    budgetRange: 'Contact for pricing',
    status: 'new',
    discoveredAt: new Date().toISOString(),
    notes: 'Discovered from Google Places live integration.'
  };
}

async function fetchGooglePlacesTextSearch(query: string, apiKey: string): Promise<GooglePlacesTextSearchResult[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  url.searchParams.set('query', query);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('type', 'lodging');
  url.searchParams.set('language', 'en');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Google Places text search failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return Array.isArray(json.results) ? json.results : [];
}

async function fetchGooglePlaceDetails(placeId: string, apiKey: string): Promise<GooglePlaceDetails> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('fields', 'formatted_phone_number,website');

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Google Place details failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  return json.result ?? {};
}

async function fetchApifyDatasetItems(config: WorkflowConfig): Promise<ApifyDatasetItem[]> {
  if (!config.apifyToken) {
    throw new Error('APIFY_TOKEN is required for Apify dataset discovery.');
  }
  if (!config.apifyDatasetId) {
    return [];
  }

  const url = new URL(`https://api.apify.com/v2/datasets/${config.apifyDatasetId}/items`);
  url.searchParams.set('limit', String(config.maxLeadsPerRun * 2));

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.apifyToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Apify dataset fetch failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as ApifyDatasetItem[];
}

async function runApifyTask(config: WorkflowConfig): Promise<ApifyDatasetItem[]> {
  if (!config.apifyToken) {
    throw new Error('APIFY_TOKEN is required for Apify task execution.');
  }
  if (!config.apifyTaskId) {
    throw new Error('APIFY_TASK_ID is required to run an Apify task.');
  }

  const taskUrl = new URL(`https://api.apify.com/v2/actor-tasks/${config.apifyTaskId}/run-sync`);
  taskUrl.searchParams.set('token', config.apifyToken);

  const response = await fetch(taskUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: config.apifyInput || '{}'
  });

  if (!response.ok) {
    throw new Error(`Apify task run failed: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  const datasetId = json.defaultDatasetId || json.datasetId;
  if (!datasetId) {
    throw new Error('Apify task run did not return a dataset ID.');
  }

  const datasetUrl = new URL(`https://api.apify.com/v2/datasets/${datasetId}/items`);
  datasetUrl.searchParams.set('limit', String(config.maxLeadsPerRun * 2));

  const datasetResponse = await fetch(datasetUrl.toString(), {
    headers: {
      Authorization: `Bearer ${config.apifyToken}`
    }
  });

  if (!datasetResponse.ok) {
    throw new Error(`Apify dataset fetch failed after task run: ${datasetResponse.status} ${datasetResponse.statusText}`);
  }

  return (await datasetResponse.json()) as ApifyDatasetItem[];
}

function mapApifyItemToLead(item: ApifyDatasetItem): Lead | null {
  const listingUrl = item.listingUrl ?? item.url ?? item.placeUrl;
  if (!listingUrl) {
    return null;
  }

  const leadId = item.id ?? randomUUID();
  const email = item.contactEmail ?? item.hostEmail ?? normalizeEmail(listingUrl, leadId);
  const phone = item.contactPhone ?? item.phone ?? '+1-800-000-0000';
  const bedrooms = item.bedrooms ?? item.beds ?? 1;
  const propertySize = `${bedrooms}-bedroom rental`;
  const budgetRange = typeof item.price === 'number' ? `$${item.price}` : item.price?.toString() ?? 'Contact for pricing';

  return {
    id: `apify-airbnb-${leadId}`,
    source: 'apify-airbnb',
    name: item.title ?? item.hostName ?? `Airbnb host ${leadId}`,
    location: item.location ?? item.address ?? item.city ?? item.neighborhood ?? 'Unknown location',
    listingUrl,
    email,
    phone,
    propertySize,
    budgetRange,
    status: 'new',
    discoveredAt: new Date().toISOString(),
    notes: 'Discovered from Apify Airbnb scraper.'
  };
}

export async function discoverLiveLeads(config: WorkflowConfig): Promise<Lead[]> {
  if (config.leadSourceProvider === 'apify-airbnb') {
    const items = config.apifyDatasetId ? await fetchApifyDatasetItems(config) : await runApifyTask(config);
    return items
      .map((item) => mapApifyItemToLead(item))
      .filter((lead): lead is Lead => lead !== null)
      .slice(0, config.maxLeadsPerRun);
  }

  if (config.leadSourceProvider === 'google-places') {
    if (!config.leadSourceApiKey) {
      throw new Error('APIFY or GOOGLE_PLACES configuration is required for live discovery.');
    }

    const discovered: Lead[] = [];
    const areas = config.sourceAreas.slice(0, config.maxLeadsPerRun);

    for (const area of areas) {
      if (discovered.length >= config.maxLeadsPerRun) {
        break;
      }

      const query = `luxury vacation rental ${area}`;
      try {
        const results = await fetchGooglePlacesTextSearch(query, config.leadSourceApiKey);
        for (const result of results) {
          if (discovered.length >= config.maxLeadsPerRun) {
            break;
          }

          const details = await fetchGooglePlaceDetails(result.place_id, config.leadSourceApiKey);
          discovered.push(mapPlaceToLead(result, details));
        }
      } catch (error) {
        console.warn('Live lead discovery failed:', error);
        break;
      }
    }

    return discovered;
  }

  return [];
}

export async function sendLiveMessage(event: CommunicationEvent, lead: Lead, config: WorkflowConfig): Promise<boolean> {
  if (!config.useLiveMessaging || !config.sendgridApiKey || !config.sendgridSender) {
    return false;
  }

  if (event.channel !== 'email') {
    return false;
  }

  sgMail.setApiKey(config.sendgridApiKey);
  const subject = event.message.split('\n')[0]?.slice(0, 80) || `Proposal for ${lead.name}`;

  try {
    await sgMail.send({
      to: lead.email,
      from: config.sendgridSender,
      subject,
      text: event.message
    });
    return true;
  } catch (error) {
    console.warn('SendGrid email send failed:', error);
    return false;
  }
}

interface HiggsfieldVideoResponse {
  requestId?: string;
  id?: string;
  videoUrl?: string;
  output?: {
    videoUrl?: string;
  };
}

export async function requestVideoGenerationForLead(lead: Lead, config: WorkflowConfig): Promise<Partial<Pick<Lead, 'videoRequestId' | 'videoUrl' | 'videoGeneratedAt'>>> {
  if (!config.useVideoGeneration) {
    return {};
  }

  if (!config.higgsfieldApiKey) {
    throw new Error('HIGGSFIELD_API_KEY is required for video generation.');
  }

  if (!config.higgsfieldProjectId) {
    throw new Error('HIGGSFIELD_PROJECT_ID is required for Higgsfield video generation.');
  }

  const endpoint = new URL(`https://api.higgsfield.ai/v1/projects/${config.higgsfieldProjectId}/runs`);
  const prompt = `Create a luxury promotional video flythrough for a high-end Airbnb-style property called ${lead.name} in ${lead.location}. The property is a ${lead.propertySize} asking ${lead.budgetRange}. Use cinematic visuals, premium interior shots, and a sophisticated tone.`;

  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.higgsfieldApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.higgsfieldModel,
      input: {
        prompt,
        asset: {
          listingUrl: lead.listingUrl,
          email: lead.email,
          phone: lead.phone,
          propertySize: lead.propertySize,
          budgetRange: lead.budgetRange
        }
      },
      callbackUrl: config.higgsfieldCallbackUrl || undefined
    })
  });

  if (!response.ok) {
    throw new Error(`Higgsfield video generation request failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as HiggsfieldVideoResponse;
  const videoUrl = json.videoUrl ?? json.output?.videoUrl;
  const requestId = json.requestId ?? json.id;

  return {
    videoRequestId: requestId,
    videoUrl,
    videoGeneratedAt: videoUrl ? new Date().toISOString() : undefined
  };
}

export async function fetchLiveReplies(config: WorkflowConfig): Promise<Array<{ leadId: string; message: string; channel: CommunicationChannel }>> {
  if (!config.replySourceUrl) {
    return [];
  }

  try {
    const response = await fetch(config.replySourceUrl);
    if (!response.ok) {
      console.warn('Live replies fetch failed:', response.status, response.statusText);
      return [];
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }

    return data
      .filter((item) => typeof item.leadId === 'string' && typeof item.message === 'string')
      .map((item) => ({
        leadId: item.leadId,
        message: item.message,
        channel: (item.channel ?? 'platform') as CommunicationChannel
      }));
  } catch (error) {
    console.warn('Live replies fetch error:', error);
    return [];
  }
}
