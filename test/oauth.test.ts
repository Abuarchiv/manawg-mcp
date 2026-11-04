import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  errors as joseErrors,
  SignJWT,
} from 'jose';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { serverFactory } from '../src/app.js';
import { type AppConfig, loadConfig, type OAuthConfig } from '../src/config.js';
import { type RunningHttpServer, startHttpServer } from '../src/http.js';
import { supabaseTokenVerifier } from '../src/oauth.js';

// Hosted mode end to end over real HTTP: discovery documents, the bearer challenge, local JWT
// verification against a key set, and the verified token reaching the app as `Authorization`.

const ISSUER = 'https://project.supabase.co/auth/v1';
const RESOURCE = 'https://mcp.example.test/mcp';
const WG = 'K7Q2M9XD';

let privateKey: CryptoKey;
let jwk: JWK;
const cleanup: Array<() => Promise<void>> = [];

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256' };
});

afterEach(async () => {
  while (cleanup.length > 0) {
    await cleanup.pop()?.();
  }
});

function token(claims: Record<string, unknown> = {}, issuer = ISSUER, expiresIn = '1h') {
  return new SignJWT({ role: 'authenticated', client_id: 'agent-client', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setSubject('00000000-0000-4000-8000-0000000000aa')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(privateKey);
}

type Upstream = { url: string; authorization: string | null; cookie: string | null };

async function startHosted() {
  const config: AppConfig = loadConfig({
    MANAWG_BASE_URL: 'https://app.example.test',
    MANAWG_SUPABASE_URL: 'https://project.supabase.co',
    MANAWG_AUTH: 'oauth',
    MANAWG_TRANSPORT: 'http',
    MANAWG_PUBLIC_URL: RESOURCE,
  });
  const oauth = config.auth as OAuthConfig;
  const upstream: Upstream[] = [];
  const appFetch = vi.fn<typeof fetch>(async (input, init) => {
    const headers = new Headers(init?.headers);
    const url = String(input);
    upstream.push({
      url,
      authorization: headers.get('authorization'),
      cookie: headers.get('cookie'),
    });
    const body = url.endsWith('/api/wg/mine')
      ? { wgs: [{ id: 'w1', memberId: 'm1', name: 'WG', code: WG }] }
      : { items: [] };
    return Response.json(body);
  });
  const metadataFetch = vi.fn<typeof fetch>(async () =>
    Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize` }),
  );
  const running: RunningHttpServer = await startHttpServer({
    host: '127.0.0.1',
    port: 0,
    drainMs: 0,
    path: '/mcp',
    auth: {
      kind: 'oauth',
      oauth,
      verifier: supabaseTokenVerifier(oauth, createLocalJWKSet({ keys: [jwk] })),
      fetchImpl: metadataFetch,
    },
    createServer: serverFactory(config, appFetch),
  });
  cleanup.push(running.close);
  return { running, upstream, metadataFetch, base: running.url.replace(/\/mcp$/, '') };
}

function callTool(url: string, name: string, bearer?: string) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: {} },
    }),
  });
}

it('challenges an anonymous client with the protected resource metadata it needs', async () => {
  const { running, base } = await startHosted();

  const anonymous = await callTool(running.url, 'shopping_list');
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get('www-authenticate')).toContain(
    'resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
  );

  for (const path of [
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-protected-resource',
  ]) {
    const metadata = await fetch(`${base}${path}`);
    expect(metadata.status).toBe(200);
    expect(metadata.headers.get('access-control-allow-origin')).toBe('*');
    await expect(metadata.json()).resolves.toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
    });
  }
});

it('passes the issuer metadata through once and keeps health open', async () => {
  const { base, metadataFetch } = await startHosted();

  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/.well-known/oauth-authorization-server`);
    await expect(response.json()).resolves.toMatchObject({ issuer: ISSUER });
  }
  expect(metadataFetch).toHaveBeenCalledTimes(1);
  expect(metadataFetch.mock.calls[0]?.[0]).toBe(
    'https://project.supabase.co/.well-known/oauth-authorization-server/auth/v1',
  );

  const health = await fetch(`${base}/health`);
  await expect(health.json()).resolves.toMatchObject({ status: 'ok', auth: 'oauth' });
});

it('forwards a verified token to the app and resolves the only flat of the account', async () => {
  const { running, upstream } = await startHosted();
  const access = await token();

  const response = await callTool(running.url, 'shopping_list', access);
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain('isError":true');

  expect(upstream.map((entry) => entry.url)).toEqual([
    'https://app.example.test/api/wg/mine',
    `https://app.example.test/api/wg/${WG}/shopping`,
  ]);
  for (const entry of upstream) {
    expect(entry.authorization).toBe(`Bearer ${access}`);
    expect(entry.cookie).toBeNull();
  }
});

it.each([
  ['a browser session token without client_id', () => token({ client_id: undefined })],
  ['a token from another issuer', () => token({}, 'https://evil.example/auth/v1')],
  ['an expired token', () => token({}, ISSUER, '-1m')],
  ['garbage', async () => 'not-a-jwt'],
])('refuses %s before any app request', async (_label, makeToken) => {
  const { running, upstream } = await startHosted();

  const response = await callTool(running.url, 'shopping_list', await makeToken());

  expect(response.status).toBe(401);
  expect(response.headers.get('www-authenticate')).toContain('invalid_token');
  expect(upstream).toEqual([]);
});

it('reports an unreachable key set as a server error, not as a bad token', async () => {
  const oauth = loadConfig({
    MANAWG_BASE_URL: 'https://app.example.test',
    MANAWG_SUPABASE_URL: 'https://project.supabase.co',
    MANAWG_AUTH: 'oauth',
    MANAWG_TRANSPORT: 'http',
    MANAWG_PUBLIC_URL: RESOURCE,
  }).auth as OAuthConfig;
  const outage = Object.assign(async () => {
    throw new joseErrors.JOSEError('Expected 200 OK from the JSON Web Key Set HTTP response');
  }, {});
  const verifier = supabaseTokenVerifier(oauth, outage);

  await expect(verifier.verifyAccessToken(await token())).rejects.toMatchObject({
    code: 'server_error',
  });
});

it('answers a malformed Host header with 400 instead of crashing', async () => {
  const { running } = await startHosted();
  const { request } = await import('node:http');

  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(running.url, { method: 'GET', headers: { host: 'a b' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });

  expect(status).toBe(400);
  expect((await fetch(`${running.url.replace(/\/mcp$/, '')}/health`)).status).toBe(200);
});
