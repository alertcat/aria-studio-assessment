import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  NO_OUTSIDE_CALLS,
  REPO_ROOT,
  filesWritten,
  forbidOutsideClients,
  outsideCalls,
  pilotSession,
  request,
  sandbox,
  storesCreated,
} from './harness'

// H0. Demo mode has no login, so it must refuse writes unless the operator opts in
// with ARIA_DEMO_WRITES=1. Pilot mode keeps its own login and must not change.
//
// Nobody maintains a list of routes here. The cases come from the app directory:
// every route file is imported, and every write method it exports becomes a case.
// A route added tomorrow is tested tomorrow. The only hand-written lists are the
// exemptions and the routes that the replay demo opens, each entry with its reason.
//
// ARIA_DEMO_WRITES has three tiers: unset (read-only), "replay" (a keyless public
// demo that opens three writes) and "1" (everything, for a machine you control).

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const

/** Write handlers that may stay open in read-only demo mode, and why. */
const EXEMPT: Record<string, string> = {
  'POST /api/login': 'demo mode has no login, it answers { ok: true, demo: true } and touches nothing',
  'POST /api/logout': 'it only clears the session cookie in its own response',
}

/**
 * Write handlers that the replay demo opens, and what each one is for. Every other
 * write handler must stay closed in replay mode. tests/replay.test.ts covers what
 * these three accept and refuse.
 */
const REPLAY_OPEN: Record<string, string> = {
  'POST /api/orders': 'fires one of the template briefs that have a recorded run',
  'POST /api/greenlight': 'Gate 1: plays the recorded render of the jury pick',
  'POST /api/review': 'Gate 2: acceptance only',
}
const REPLAY_CLOSED_REASON = 'Replay demo: only template briefs, greenlight and acceptance are open.'

type RouteContext = { params: Promise<Record<string, string>> }
type RouteModule = Partial<Record<string, (req: Request, ctx: RouteContext) => Promise<Response> | Response>>
type Handler = {
  /** for example "POST /api/orders" */
  id: string
  method: string
  url: string
  /** import specifier, for example "@/app/api/orders/route" */
  spec: string
  params: Record<string, string>
}

/** Every route file under app/, relative, with forward slashes. */
function routeFiles(): string[] {
  return (fs.readdirSync(path.join(REPO_ROOT, 'app'), { recursive: true }) as string[])
    .map((file) => file.replace(/\\/g, '/'))
    .filter((file) => /(^|\/)route\.(ts|tsx|js|jsx|mjs)$/.test(file))
    .sort()
}

async function load(spec: string): Promise<RouteModule> {
  return (await import(/* @vite-ignore */ spec)) as RouteModule
}

async function discover(): Promise<Handler[]> {
  sandbox() // the imports below also run in a throwaway directory
  const found: Handler[] = []
  for (const file of routeFiles()) {
    const params: Record<string, string> = {}
    const segments = path.posix
      .dirname(file)
      .split('/')
      .filter((segment) => !/^\(.*\)$/.test(segment)) // route groups are not part of the URL
      .map((segment) => {
        const dynamic = /^\[+(?:\.\.\.)?(.+?)\]+$/.exec(segment)
        if (!dynamic) return segment
        params[dynamic[1]] = 'x'
        return 'x'
      })
    const url = '/' + segments.join('/')
    const spec = `@/app/${file.replace(/\.[a-z]+$/, '')}`
    const mod = await load(spec)
    for (const method of WRITE_METHODS) {
      if (typeof mod[method] === 'function') found.push({ id: `${method} ${url}`, method, url, spec, params })
    }
  }
  return found
}

const handlers = await discover()
const guarded = handlers.filter((h) => !(h.id in EXEMPT))
const exempt = handlers.filter((h) => h.id in EXEMPT).map((h) => ({ ...h, reason: EXEMPT[h.id] }))

/** Call a handler the way Next.js would. The module is imported fresh, because the mode is read at import. */
async function call(h: Handler, headers: Record<string, string> = {}): Promise<Response> {
  const mod = await load(h.spec)
  return mod[h.method]!(request(h.url, { method: h.method, headers }), { params: Promise.resolve(h.params) })
}

describe('route discovery', () => {
  it('finds write handlers in the app directory', () => {
    // a broken walk would produce zero cases and a green run
    expect(routeFiles().length).toBeGreaterThan(0)
    expect(guarded.length).toBeGreaterThan(0)
  })

  it('has no stale exemption', () => {
    const ids = handlers.map((h) => h.id)
    for (const id of Object.keys(EXEMPT)) expect(ids, `${id} is exempt, but no such handler exists`).toContain(id)
  })

  it('has no stale replay entry', () => {
    const ids = guarded.map((h) => h.id)
    for (const id of Object.keys(REPLAY_OPEN)) expect(ids, `${id} is open in replay, but no such handler exists`).toContain(id)
  })
})

describe.each(guarded)('$id', (h) => {
  it('demo mode, default: refused with 405, an Allow header and a reason, and nothing happens', async () => {
    const res = await call(h)
    expect(res.status).toBe(405)
    // Allow names the read methods this route really exports, and only those
    const mod = await load(h.spec)
    expect(res.headers.get('allow')).toBe(READ_METHODS.filter((m) => typeof mod[m] === 'function').join(', '))
    const body = await res.json()
    expect(body.error).toBe('read-only demo')
    expect(body.reason).toBe('Demo mode is read-only: writes need ARIA_DEMO_WRITES=1 on the server.')
    expect(storesCreated()).toBe(0)
    expect(filesWritten()).toEqual([])
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })

  it('demo mode, ARIA_DEMO_WRITES=1: not refused', async () => {
    sandbox({ demoWrites: true })
    const res = await call(h)
    expect(res.status).not.toBe(405)
  })

  it('demo mode, ARIA_DEMO_WRITES=replay: closed unless listed in REPLAY_OPEN, and no client is called', async () => {
    sandbox({ demoWrites: 'replay' })
    await forbidOutsideClients()
    const res = await call(h)
    const body = await res.json().catch(() => ({}))
    if (h.id in REPLAY_OPEN) {
      // the route is reachable: whatever it says to an empty request, it is not the route-level refusal
      expect(body.reason).not.toBe(REPLAY_CLOSED_REASON)
      expect(body.error).not.toBe('read-only demo')
    } else {
      expect(res.status).toBe(405)
      const mod = await load(h.spec)
      expect(res.headers.get('allow')).toBe(READ_METHODS.filter((m) => typeof mod[m] === 'function').join(', '))
      expect(body).toEqual({ error: 'replay demo', reason: REPLAY_CLOSED_REASON })
      expect(storesCreated()).toBe(0)
    }
    expect(filesWritten()).toEqual([])
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })

  it('pilot mode, no session: 401 as before', async () => {
    sandbox({ pilot: true })
    const res = await call(h)
    expect(res.status).toBe(401)
    expect(storesCreated()).toBe(0)
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })

  it('pilot mode, logged in: not refused', async () => {
    sandbox({ pilot: true })
    const res = await call(h, await pilotSession())
    expect([401, 403, 405]).not.toContain(res.status)
  })
})

describe.each(exempt)('$id (exempt: $reason)', (h) => {
  it('demo mode, default: stays open and has no side effect', async () => {
    const res = await call(h)
    expect(res.status).toBe(200)
    expect(storesCreated()).toBe(0)
    expect(filesWritten()).toEqual([])
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })

  it('demo mode, ARIA_DEMO_WRITES=replay: stays open and has no side effect', async () => {
    sandbox({ demoWrites: 'replay' })
    await forbidOutsideClients()
    const res = await call(h)
    expect(res.status).toBe(200)
    expect(storesCreated()).toBe(0)
    expect(filesWritten()).toEqual([])
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })
})

describe('the ARIA_DEMO_WRITES switch', () => {
  it.each(['0', 'true', 'yes', 'on', ' 1', '1 ', ''])('the value %j does not enable writes', async (value) => {
    vi.stubEnv('ARIA_DEMO_WRITES', value)
    const res = await call(guarded[0])
    expect(res.status).toBe(405)
  })

  it.each(['REPLAY', 'Replay', ' replay', 'replay ', 'replay1', 'record'])(
    'the value %j is not the replay tier: every write stays closed, read-only',
    async (value) => {
      vi.stubEnv('ARIA_DEMO_WRITES', value)
      for (const h of guarded) {
        const res = await call(h)
        expect(res.status, h.id).toBe(405)
        expect((await res.json()).error, h.id).toBe('read-only demo')
      }
    },
  )

  it('logs one warning when it is on, however many writes follow', async () => {
    sandbox({ demoWrites: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await call(guarded[0])
    await call(guarded[0])
    const about = warn.mock.calls.filter((args) => String(args[0]).includes('ARIA_DEMO_WRITES'))
    expect(about).toHaveLength(1)
  })
})
