const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https?:\/\/tauri\.localhost(:\d+)?$/,
  /^tauri:\/\//,
  /^https:\/\/([a-z0-9-]+\.)?jiucaihezi\.studio$/,
  /^https:\/\/([a-z0-9-]+\.)?jiucaihezi[a-z0-9-]*\.pages\.dev$/
];

export function resolveOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (!origin) return '*';
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))
    ? origin
    : 'https://jiucaihezi.studio';
}

export function corsHeaders(request) {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(request),
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,Cookie,X-Requested-With,X-JC-Session,x-api-key,X-API-Key',
    'Vary': 'Origin'
  };
}

export function handleOptions(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request)
  });
}

/**
 * 去重响应头中重复的 Access-Control-Allow-Origin。
 * 上游 Nginx 可能在 add_header 和应用层各自设置了一次，导致 CORS 双头被浏览器拦截。
 */
export function dedupeCorsOrigin(headers) {
  const values = headers.getAll('Access-Control-Allow-Origin');
  if (values && values.length > 1) {
    const first = values[0];
    headers.delete('Access-Control-Allow-Origin');
    headers.set('Access-Control-Allow-Origin', first);
  }
  return headers;
}
