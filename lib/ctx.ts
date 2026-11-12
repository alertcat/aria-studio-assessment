import { storeFor, type TenantStore } from './store'
import { tenantFromRequest, keyFromRequest, tenantIdFor, demoWrites, PILOT } from './tenant'
import type { Refusal } from './gates'
import { REPLAY_REASONS } from './replay'

/** Resolve the tenant store for a request. In pilot mode an unauthenticated request gets null. */
export function storeForRequest(req: Request): TenantStore | null {
  const t = tenantFromRequest(req)
  if (!t) return null
  return storeFor(t)
}

export function unauthorized(msg = PILOT ? 'login required' : 'no tenant') {
  return Response.json({ error: msg }, { status: 401 })
}

/** The HTTP answer when the transition table refuses an order action: 404 or 409. */
export function refused(r: Refusal): Response {
  const { http, ...body } = r
  return Response.json(body, { status: http })
}

export const READ_ONLY_REASON = 'Demo mode is read-only: writes need ARIA_DEMO_WRITES=1 on the server.'

let warnedDemoWrites = false

/**
 * First statement of every route that writes or spends. Demo mode has no login, so
 * every caller is the default tenant and renders run on the server's key. What it
 * accepts depends on ARIA_DEMO_WRITES:
 *
 * - unset or anything unknown: read-only, every write is refused
 * - "replay": the keyless public demo, where only routes that pass `openInReplay` go on
 * - "1": every write, for a machine the operator controls
 *
 * Pilot mode has its own login and is not affected.
 *
 * Returns the refusal, or null when the request may go on. It runs before the store
 * is created, so a refused request touches nothing. `allow` names the methods of the
 * same route that still work (RFC 9110, 10.2.1).
 */
export function readOnlyDemo(allow = '', openInReplay = false): Response | null {
  if (PILOT) return null
  const mode = demoWrites()
  if (mode === 'on') {
    if (!warnedDemoWrites) {
      warnedDemoWrites = true
      console.warn('[demo] ARIA_DEMO_WRITES=1: every caller can write and spend the server keys. Use it only on a machine you control.')
    }
    return null
  }
  if (mode === 'replay') return openInReplay ? null : replayRefusal(REPLAY_REASONS.closed, allow)
  return Response.json({ error: 'read-only demo', reason: READ_ONLY_REASON }, { status: 405, headers: { Allow: allow } })
}

/** True in the keyless public demo. The three routes it opens use this for their own rule. */
export function inReplay(): boolean {
  return !PILOT && demoWrites() === 'replay'
}

/** A write the replay demo does not offer: 405 with one reason sentence, like the read-only refusal. */
export function replayRefusal(reason: string, allow = ''): Response {
  return Response.json({ error: 'replay demo', reason }, { status: 405, headers: { Allow: allow } })
}

/**
 * For routes that spend the customer's balance. In pilot mode the key must be in
 * the Authorization header and must belong to the cookie's tenant; it is used for
 * this request only and never stored. Demo mode returns no key (server key applies).
 */
export function spendKey(req: Request, st: TenantStore): { key?: string; error?: Response } {
  if (!PILOT) return {}
  const key = keyFromRequest(req)
  if (!key) return { error: Response.json({ error: 'key required' }, { status: 401 }) }
  if (tenantIdFor(key) !== st.tenant.id) {
    return { error: Response.json({ error: 'key does not match this session' }, { status: 403 }) }
  }
  return { key }
}
