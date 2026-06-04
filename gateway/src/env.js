import { GatewayError } from './errors.js';

export const NEWAPI_ADMIN_TOKEN_ENV_NAMES = [
  'NEWAPI_ADMIN_ACCESS_TOKEN',
  'NEWAPI_ADMIN_TOKEN',
  'NEWAPI_ADMIN_KEY',
  'NEWAPI_API_KEY'
];

export function readFirstEnv(env, names, fallback = '') {
  for (const name of Array.isArray(names) ? names : [names]) {
    const value = env && env[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

export function requireEnv(env, names, message) {
  const value = readFirstEnv(env, names);
  if (!value) throw new GatewayError(message || '服务端环境变量未配置', 500, 'missing_env');
  return value;
}

export function trimBaseUrl(value, fallback = '') {
  return String(value || fallback || '').replace(/\/+$/, '');
}

export function newApiConfig(env) {
  return {
    baseUrl: trimBaseUrl(readFirstEnv(env, ['NEWAPI_BASE_URL', 'NEW_API_BASE_URL', 'NEWAPI_API_URL'], 'https://api.jiucaihezi.studio')),
    token: requireEnv(env, NEWAPI_ADMIN_TOKEN_ENV_NAMES, 'NewAPI 服务端令牌未配置')
  };
}

