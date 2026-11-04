import {
  type AuthInfo,
  getOAuthProtectedResourceMetadataUrl,
  OAuthError,
  OAuthErrorCode,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import { createRemoteJWKSet, type JWTVerifyGetKey, errors as joseErrors, jwtVerify } from 'jose';
import type { OAuthConfig } from './config.js';

/**
 * Hosted mode: this server is an OAuth 2.1 resource server (MCP authorization spec,
 * RFC 9728). Supabase Auth's OAuth 2.1 server is the authorization server — it registers
 * clients, signs the user in on the app's consent page and issues the access tokens.
 */

/** Failures that are the token's fault; every other error means the key set is unreachable. */
const TOKEN_ERRORS = [
  joseErrors.JWTExpired,
  joseErrors.JWTClaimValidationFailed,
  joseErrors.JWTInvalid,
  joseErrors.JWSInvalid,
  joseErrors.JWSSignatureVerificationFailed,
  joseErrors.JOSEAlgNotAllowed,
  joseErrors.JOSENotSupported,
  joseErrors.JWKSNoMatchingKey,
  joseErrors.JWKSMultipleMatchingKeys,
];

const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource';
const AUTHORIZATION_SERVER_PATH = '/.well-known/oauth-authorization-server';
const DISCOVERY_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=3600',
};

/**
 * Verifies Supabase access tokens locally against the project's JWKS. Only tokens that
 * Supabase issued to an OAuth client (`client_id` claim) are accepted: a browser session
 * token copied out of the app is not a grant the user gave to an agent.
 */
export function supabaseTokenVerifier(
  oauth: Pick<OAuthConfig, 'issuer' | 'jwksUrl'>,
  keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(oauth.jwksUrl)),
): OAuthTokenVerifier {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let claims: Record<string, unknown>;
      try {
        ({ payload: claims } = await jwtVerify(token, keys, {
          issuer: oauth.issuer,
          audience: 'authenticated',
          algorithms: ['ES256', 'RS256'],
          requiredClaims: ['sub', 'exp'],
        }));
      } catch (error) {
        if (TOKEN_ERRORS.some((type) => error instanceof type)) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token');
        }
        // Anything else is the key set failing to load (network, 5xx, 429, timeout): an outage.
        // Answering invalid_token here would make clients drop a good token and sign in again.
        throw new OAuthError(OAuthErrorCode.ServerError, 'Token keys unavailable');
      }
      const clientId = claims.client_id;
      if (typeof clientId !== 'string' || clientId === '') {
        throw new OAuthError(
          OAuthErrorCode.InvalidToken,
          'Token was not issued to an OAuth client',
        );
      }
      const scope = typeof claims.scope === 'string' ? claims.scope : '';
      return {
        token,
        clientId,
        scopes: scope.split(' ').filter(Boolean),
        expiresAt: claims.exp as number,
      };
    },
  };
}

export function protectedResourceMetadataUrl(oauth: Pick<OAuthConfig, 'resourceUrl'>): string {
  return getOAuthProtectedResourceMetadataUrl(oauth.resourceUrl);
}

function document(request: Request, body: unknown, status = 200): Response {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...DISCOVERY_HEADERS,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'mcp-protocol-version, authorization, content-type',
      },
    });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD, OPTIONS' } });
  }
  const text = JSON.stringify(body);
  return new Response(request.method === 'HEAD' ? null : text, {
    status,
    headers:
      status === 200 ? DISCOVERY_HEADERS : { 'content-type': DISCOVERY_HEADERS['content-type'] },
  });
}

/**
 * Serves the discovery documents: RFC 9728 protected resource metadata (path-aware and at
 * the root), and the issuer's RFC 8414 metadata for clients from before RFC 9728 that look
 * for it on the MCP origin. Returns undefined for any other path.
 */
export function createDiscovery(oauth: OAuthConfig, fetchImpl: typeof fetch = fetch) {
  const resourceMetadata = {
    resource: oauth.resourceUrl.href,
    authorization_servers: [oauth.issuer],
    bearer_methods_supported: ['header'],
    resource_name: 'ManaWG',
    resource_documentation: 'https://github.com/Abuarchiv/manawg-mcp#readme',
  };
  const resourcePath = new URL(protectedResourceMetadataUrl(oauth)).pathname;
  let issuerMetadata: Promise<unknown> | undefined;

  function loadIssuerMetadata(): Promise<unknown> {
    issuerMetadata ??= fetchImpl(oauth.metadataUrl, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`issuer metadata ${response.status}`);
      }
      return response.json();
    });
    // Only a success is kept; the next request retries a failed fetch.
    issuerMetadata.catch(() => {
      issuerMetadata = undefined;
    });
    return issuerMetadata;
  }

  return async (request: Request, pathname: string): Promise<Response | undefined> => {
    if (pathname === resourcePath || pathname === PROTECTED_RESOURCE_PATH) {
      return document(request, resourceMetadata);
    }
    if (pathname === AUTHORIZATION_SERVER_PATH) {
      try {
        return document(request, await loadIssuerMetadata());
      } catch {
        return document(request, { error: 'temporarily_unavailable' }, 503);
      }
    }
    return undefined;
  };
}
