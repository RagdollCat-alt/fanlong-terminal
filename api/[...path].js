import https from 'node:https';

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

function sendUpstream(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const upstreamRequest = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method,
      headers: Object.fromEntries(headers.entries()),
      family: 4,
      servername: url.hostname,
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
    }, (upstreamResponse) => {
      const chunks = [];
      upstreamResponse.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      upstreamResponse.on('end', () => resolve({
        status: upstreamResponse.statusCode || 502,
        headers: upstreamResponse.headers,
        body: Buffer.concat(chunks),
      }));
    });
    upstreamRequest.setTimeout(20000, () => {
      const timeoutError = new Error('Upstream request timed out');
      timeoutError.code = 'ETIMEDOUT';
      upstreamRequest.destroy(timeoutError);
    });
    upstreamRequest.on('error', reject);
    if (body) upstreamRequest.write(body);
    upstreamRequest.end();
  });
}

function requestPath(request) {
  const requestUrl = new URL(request.url, 'https://terminal.rpg0707.com');
  return `${requestUrl.pathname}${requestUrl.search}`;
}

export default async function handler(request, response) {
  try {
    const headers = new Headers();
    for (const name of REQUEST_HEADERS) {
      const value = request.headers[name];
      if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    headers.set('x-forwarded-host', request.headers.host || 'terminal.rpg0707.com');
    headers.set('x-forwarded-proto', 'https');

    const method = String(request.method || 'GET').toUpperCase();
    const target = new URL(`${UPSTREAM_ORIGIN}${requestPath(request)}`);
    const body = ['GET', 'HEAD'].includes(method) ? undefined : await readBody(request);
    const upstream = await sendUpstream(target, method, headers, body);

    response.status(upstream.status);
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers[name];
      if (value) response.setHeader(name, value);
    }
    const cookies = upstream.headers['set-cookie'] || [];
    if (cookies.length) response.setHeader('set-cookie', cookies);
    response.setHeader('cache-control', 'private, no-store, max-age=0');
    response.send(upstream.body);
  } catch (error) {
    console.error('API upstream request failed', error?.code || error?.message);
    const timedOut = error?.code === 'ETIMEDOUT';
    response.status(timedOut ? 504 : 502).json({
      ok: false,
      code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      message: timedOut ? '服务器响应超时，请稍后重试' : '服务器暂时无法连接，请稍后重试',
      data: null,
      requestId: request.headers['x-request-id'] || null,
    });
  }
}
