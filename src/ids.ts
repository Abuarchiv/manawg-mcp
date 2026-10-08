const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBER_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isMemberToken(value: unknown): value is string {
  return typeof value === 'string' && MEMBER_TOKEN_PATTERN.test(value);
}
