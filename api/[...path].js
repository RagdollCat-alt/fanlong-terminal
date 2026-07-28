const UPSTREAM_ORIGIN = 'https://fanlong-api.huaian.cloud';
const REQUEST_HEADERS = [
  'accept',
  'content-type',
  'cookie',
  'idempotency-key',
  'origin',
  'user-agent',
  'x-csrf-token',
  'x-request-id',
];
const RESPONSE_HEADERS = [
  'cache-control',
  'content-disposition',
  'content-type',
  'etag',
  'last-modified',
  'x-request-id',
];

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function requestPath(request) {
  const requestUrl = new URL(request.url, 'https://terminal.rpg0707.com');
  return `${requestUrl.pathname}${requestUrl.search}`;
}

export default async function handler(request, response) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const headers = new Headers();
    for (const name of REQUEST_HEADERS) {
      const value = request.headers[name];
      if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    headers.set('x-forwarded-host', request.headers.host || 'terminal.rpg0707.com');
    headers.set('x-forwarded-proto', 'https');

    const method = String(request.method || 'GET').toUpperCase();
    const upstream = await fetch(`${UPSTREAM_ORIGIN}${requestPath(request)}`, {
      method,
      headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : await readBody(request),
      redirect: 'manual',
      signal: controller.signal,
    });

    response.status(upstream.status);
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) response.setHeader(name, value);
    }
    const combinedCookie = upstream.headers.get('set-cookie') || '';
    const cookies = typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : combinedCookie.split(/,(?=\s*[^;,=\s]+=[^;,]+)/).filter(Boolean);
    if (cookies.length) response.setHeader('set-cookie', cookies);
    response.setHeader('cache-control', 'private, no-store, max-age=0');
    response.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    response.status(timedOut ? 504 : 502).json({
      ok: false,
      code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      message: timedOut ? '服务器响应超时，请稍后重试' : '服务器暂时无法连接，请稍后重试',
      data: null,
      requestId: request.headers['x-request-id'] || null,
    });
  } finally {
    clearTimeout(timeout);
  }
}
