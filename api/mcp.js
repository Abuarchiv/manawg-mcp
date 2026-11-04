// Vercel Function: every path is rewritten here (vercel.json); routing happens in src/http.ts.
import { handleRequest } from '../dist/vercel.js';

export const GET = handleRequest;
export const HEAD = handleRequest;
export const POST = handleRequest;
export const DELETE = handleRequest;
export const OPTIONS = handleRequest;
