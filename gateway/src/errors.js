export class GatewayError extends Error {
  constructor(message, status = 500, code = 'gateway_error') {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message = '请求参数错误') {
  return new GatewayError(message, 400, 'bad_request');
}

export function unauthorized(message = '请先登录') {
  return new GatewayError(message, 401, 'unauthorized');
}

export function upstreamError(message = '上游服务暂时不可用') {
  return new GatewayError(message, 502, 'upstream_error');
}

export function toErrorPayload(error) {
  const status = Number(error && error.status || 500);
  return {
    success: false,
    code: error && error.code || 'gateway_error',
    message: error && error.message || '服务异常',
    status
  };
}

