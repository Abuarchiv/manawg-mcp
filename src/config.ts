const DEFAULT_TIMEOUT_MS = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export type AppConfig = {
  baseUrl: string;
  wgCode: string;
  memberId: string;
  memberToken: string;
  timeoutMs: number;
};

function required(env: NodeJS.ProcessEnv, name: string, errorMessage = `${name} is required`): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(errorMessage);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const baseUrlValue = required(env, 'MANAWG_BASE_URL');
  let baseUrl: URL;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    throw new Error('MANAWG_BASE_URL must be an absolute http or https URL');
  }
  if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
    throw new Error('MANAWG_BASE_URL must be an absolute http or https URL');
  }

  const wgCode = required(env, 'MANAWG_WG_CODE');
  const memberId = required(env, 'MANAWG_MEMBER_ID', 'Invalid configuration');
  if (!UUID_PATTERN.test(memberId)) {
    throw new Error('Invalid configuration');
  }

  const memberToken = required(env, 'MANAWG_MEMBER_TOKEN', 'Invalid configuration');
  if (!MEMBER_TOKEN_PATTERN.test(memberToken)) {
    throw new Error('Invalid configuration');
  }

  return {
    baseUrl: baseUrl.href.replace(/\/+$/, ''),
    wgCode,
    memberId,
    memberToken,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}
