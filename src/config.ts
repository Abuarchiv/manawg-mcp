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

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
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
  const memberId = required(env, 'MANAWG_MEMBER_ID');
  if (!UUID_PATTERN.test(memberId)) {
    throw new Error('MANAWG_MEMBER_ID must be a UUID');
  }

  const memberToken = required(env, 'MANAWG_MEMBER_TOKEN');
  if (!MEMBER_TOKEN_PATTERN.test(memberToken)) {
    throw new Error('MANAWG_MEMBER_TOKEN must be 64 hexadecimal characters');
  }

  return {
    baseUrl: baseUrl.href.replace(/\/+$/, ''),
    wgCode,
    memberId,
    memberToken,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}
