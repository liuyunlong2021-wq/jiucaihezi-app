import { corsHeaders } from './cors.js';
import { GatewayError, toErrorPayload } from './errors.js';

export function jsonResponse(data, status = 200, request = null, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

export async function readJson(request) {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new GatewayError('JSON 请求体格式错误', 400, 'invalid_json');
  }
}

export function errorResponse(error, request) {
  const payload = toErrorPayload(error);
  return jsonResponse(payload, payload.status, request);
}

export function notFound(request) {
  return jsonResponse({ success: false, code: 'not_found', message: '接口不存在' }, 404, request);
}

export function routeMethod(request, handlers) {
  const handler = handlers[request.method.toUpperCase()];
  if (!handler) return jsonResponse({ success: false, code: 'method_not_allowed', message: '请求方法不支持' }, 405, request, { Allow: Object.keys(handlers).join(', ') });
  return handler();
}
