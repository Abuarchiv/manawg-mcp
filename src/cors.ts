export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/**
 * Answer to a CORS preflight. Clients add headers of their own (the 2.x SDK sends `mcp-method`
 * and `mcp-name`), so the preflight allows whatever it asks for.
 */
export function preflightResponse(request: Request, allowMethods: string): Response {
  const requestedHeaders = request.headers.get('access-control-request-headers');
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-methods': allowMethods,
      ...(requestedHeaders && { 'access-control-allow-headers': requestedHeaders }),
      'access-control-max-age': '600',
      vary: 'access-control-request-headers',
    },
  });
}
