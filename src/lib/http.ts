import { NextResponse } from "next/server";

/**
 * Shared JSON error helper for API routes. Keeps the response shape
 * (`{ error, ...extras }`) consistent so the frontend can rely on a single
 * discriminated union. Do NOT put upstream error text here — sanitize at the
 * call site first. See ADR 0004 §Logging.
 */
export function jsonError(
  status: number,
  error: string,
  extras?: Record<string, unknown>,
  init?: ResponseInit,
): NextResponse {
  return NextResponse.json({ error, ...(extras ?? {}) }, { status, ...(init ?? {}) });
}
