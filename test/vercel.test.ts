import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const OAUTH_ENV = {
  MANAWG_AUTH: 'oauth',
  MANAWG_BASE_URL: 'https://manawg.example',
  MANAWG_SUPABASE_URL: 'https://project.supabase.example',
  MANAWG_PUBLIC_URL: 'https://mcp.manawg.example/mcp',
};

beforeEach(() => {
  vi.resetModules();
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('MANAWG_')) vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function loadEntry(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return import('../src/vercel.js');
}

it('answers an unauthenticated MCP call with 401 and the resource metadata link', async () => {
  const { handleRequest } = await loadEntry(OAUTH_ENV);

  const response = await handleRequest(
    new Request('https://mcp.manawg.example/mcp', { method: 'POST', body: '{}' }),
  );
  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toContain(
    'resource_metadata="https://mcp.manawg.example/.well-known/oauth-protected-resource/mcp"',
  );

  const health = await handleRequest(new Request('https://mcp.manawg.example/health'));
  expect(health.status).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ auth: 'oauth', mcpPath: '/mcp' });
});

it('answers 500 config_error when the deployment is not configured for OAuth', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { handleRequest } = await loadEntry({ ...OAUTH_ENV, MANAWG_AUTH: 'session' });

  const response = await handleRequest(new Request('https://mcp.manawg.example/health'));
  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({ error: 'config_error' });
  expect(error).toHaveBeenCalledWith(expect.stringContaining('config_error:'));
});
