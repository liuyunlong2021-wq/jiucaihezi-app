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
