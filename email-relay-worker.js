export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const url = new URL(request.url);
    const key = url.searchParams.get('key') || '';

    const incoming = await request.formData();
    const params = new URLSearchParams();
    for (const field of ['from', 'to', 'subject', 'text']) {
      const value = incoming.get(field);
      if (value) params.set(field, value.toString());
    }

    const targetUrl = `https://reply-assistant-1231.twil.io/email-inbound?key=${encodeURIComponent(key)}`;
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    return new Response(await response.text(), { status: response.status });
  },
};
