import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Order } from '@/lib/store'
import {
  NO_OUTSIDE_CALLS,
  REPO_ROOT,
  defaultStore,
  fastForward,
  filesWritten,
  forbidOutsideClients,
  outsideCalls,
  request,
  sandbox,
} from './harness'

// The public demo: ARIA_DEMO_WRITES=replay, on a host that holds no key. A reviewer
// can fire a template brief, greenlight it and accept it. Everything shown comes
// from runs that were recorded earlier and are part of the repository
// (public/demo-state.json and public/media). No external client is ever called.
//
// What "the recorded content" is, is read from the snapshot here, not copied in.

type Recorded = Pick<
  Order,
  'id' | 'title' | 'status' | 'revision' | 'createdAt' | 'drafts' | 'duels' | 'ranking' | 'winnerAgentId' | 'videoFile' | 'posterFile'
>
const snapshot = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'public', 'demo-state.json'), 'utf8')) as {
  templates: { title: string }[]
  state: { orders: Recorded[] }
}

/** The run a template replays: the oldest one that was delivered without a revision. */
function recordingOf(title: string): Recorded {
  const runs = snapshot.state.orders
    .filter((o) => o.title === title && o.status === 'delivered' && o.revision === 0)
    .sort((a, b) => a.createdAt - b.createdAt)
  if (!runs[0]) throw new Error(`the snapshot has no recorded run for "${title}"`)
  return runs[0]
}

/** The templates of the snapshot. Each one has a recorded run. */
const TITLES = snapshot.templates.map((t) => t.title)

/** The one sentence a reviewer reads when the replay demo refuses something. */
const REASON = {
  custom: 'Replay demo: custom briefs are off, so fire one of the template briefs instead.',
  override: 'Replay demo: only the jury pick has recorded footage, so an override cannot be shown.',
  revise: 'Replay demo: revisions are off, because a revision needs a new render.',
}

const api = {
  state: () => import('@/app/api/state/route'),
  orders: () => import('@/app/api/orders/route'),
  greenlight: () => import('@/app/api/greenlight/route'),
  review: () => import('@/app/api/review/route'),
}

async function getState() {
  const res = await (await api.state()).GET(request('/api/state', { method: 'GET' }))
  return (await res.json()) as { templates: { title: string }[]; state: { orders: Order[]; revenue: number } }
}

async function post(route: 'orders' | 'greenlight' | 'review', body: Record<string, unknown>) {
  return (await api[route]()).POST(request(`/api/${route}`, { body }))
}

/** A replay demo with simulated time, and with every external client set to throw. */
async function replayDemo() {
  sandbox({ demoWrites: 'replay' })
  vi.useFakeTimers()
  const guard = await forbidOutsideClients()
  return { st: await defaultStore(), guard }
}

/** Fire a template the way the studio does: by its index in the list the server sent. */
async function fire(title: string): Promise<Order> {
  const { templates } = await getState()
  const index = templates.findIndex((t) => t.title === title)
  expect(index, `the template "${title}" is offered`).toBeGreaterThanOrEqual(0)
  const res = await post('orders', { template: index })
  expect(res.status).toBe(200)
  const { id } = (await res.json()) as { id: string }
  const o = (await defaultStore()).getStore().state.orders.find((x) => x.id === id)
  if (!o) throw new Error('the new order is not in the store')
  return o
}

async function fireToGate(title: string) {
  const o = await fire(title)
  await fastForward(() => o.status === 'greenlight')
  return o
}

async function fireToReview(title: string) {
  const o = await fireToGate(title)
  expect((await post('greenlight', { orderId: o.id })).status).toBe(200)
  await fastForward(() => o.status === 'review')
  return o
}

afterEach(() => {
  vi.useRealTimers()
})

describe('replay demo: what a reviewer can do', () => {
  it('offers exactly the templates that have a recorded run', async () => {
    await replayDemo()
    const { templates } = await getState()
    expect(TITLES.length).toBeGreaterThan(0)
    expect(templates.map((t) => t.title)).toEqual(TITLES)
  })

  it('leaves the template list alone outside replay mode', async () => {
    sandbox({ demoWrites: true })
    const { templates } = await getState()
    const { TEMPLATES } = await import('@/lib/store')
    expect(templates).toEqual(TEMPLATES)
  })

  it.each(TITLES)('walks "%s" through both gates on recorded content, with every client forbidden', async (title) => {
    const { st, guard } = await replayDemo()
    const rec = recordingOf(title)

    const o = await fire(title)
    expect(['inbox', 'concepting']).toContain(o.status)
    expect(o.drafts).toEqual([])

    // concepts and jury arrive after a short delay that a reviewer can watch
    const toGate = await fastForward(() => o.status === 'greenlight')
    expect(toGate).toBeGreaterThanOrEqual(2000)
    expect(toGate).toBeLessThanOrEqual(15000)
    expect(o.drafts.map((d) => [d.agentId, d.concept])).toEqual(rec.drafts.map((d) => [d.agentId, d.concept]))
    expect(o.duels).toEqual(rec.duels)
    expect(o.ranking.map((r) => [r.agentId, r.wins])).toEqual(rec.ranking.map((r) => [r.agentId, r.wins]))
    o.ranking.forEach((r, i) => expect(r.score).toBeCloseTo(rec.ranking[i].score, 6))

    // Gate 1: the jury pick, which is the concept the recorded cut was rendered from
    expect(o.ranking[0].agentId).toBe(rec.winnerAgentId)
    expect((await post('greenlight', { orderId: o.id, agentId: o.ranking[0].agentId })).status).toBe(200)
    expect(o.status).toBe('producing')
    expect(o.videoFile).toBeUndefined()
    const toReview = await fastForward(() => o.status === 'review')
    expect(toReview).toBeGreaterThanOrEqual(1000)
    expect(toReview).toBeLessThanOrEqual(10000)
    expect(o.videoFile).toBe(rec.videoFile)
    expect(o.posterFile).toBe(rec.posterFile)
    for (const file of [rec.videoFile, rec.posterFile]) {
      expect(fs.existsSync(path.join(REPO_ROOT, 'public', String(file))), `${file} is in the repository`).toBe(true)
    }

    // Gate 2: acceptance settles on paper only, even if chain keys were present
    expect((await post('review', { orderId: o.id, action: 'approve' })).status).toBe(200)
    expect(o.status).toBe('delivered')
    expect(o.invoice?.ref).toContain('simulated settlement')
    expect(st.getStore().state.revenue).toBe(o.amountUsd)

    // the event log says that this was a replay
    expect(st.getStore().state.events.some((e) => e.orderId === o.id && /recorded/i.test(e.text))).toBe(true)

    // nothing left the process and nothing reached the disk
    await vi.advanceTimersByTimeAsync(2000)
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
    expect(guard.escrowWatchStarts()).toBe(0)
    expect(filesWritten()).toEqual([])
  })
})

describe('replay demo: what stays closed', () => {
  it.each([
    ['a custom brief', { client: 'Acme', title: 'My own brief', brief: 'Make it pop.', amountUsd: 500 }],
    ['an empty request', {}],
    ['a template index that is not offered', { template: 99 }],
  ])('refuses %s with one clear reason and creates nothing', async (_name, body) => {
    const { st } = await replayDemo()
    const res = await post('orders', body)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
    expect(await res.json()).toEqual({ error: 'replay demo', reason: REASON.custom })
    expect(st.getStore().state.orders).toEqual([])
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })

  it('refuses a revision with a reason and leaves the cut at the gate', async () => {
    await replayDemo()
    const o = await fireToReview(TITLES[0])
    const res = await post('review', { orderId: o.id, action: 'revise', feedback: 'again' })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
    expect(await res.json()).toEqual({ error: 'replay demo', reason: REASON.revise })
    expect(o.status).toBe('review')
    expect(o.revision).toBe(0)
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })

  it('refuses an override of the jury pick, because only the pick has footage', async () => {
    await replayDemo()
    const o = await fireToGate(TITLES[0])
    const res = await post('greenlight', { orderId: o.id, agentId: o.ranking[1].agentId })
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
    expect(await res.json()).toEqual({ error: 'replay demo', reason: REASON.override })
    expect(o.status).toBe('greenlight')
    expect(o.winnerAgentId).toBeUndefined()
  })

  it('ignores render options at the gate: the recorded cut is what it is', async () => {
    await replayDemo()
    const o = await fireToGate(TITLES[0])
    const res = await post('greenlight', {
      orderId: o.id,
      talentId: 'mira',
      spec: { model: 'seedance-2-0-pro', resolution: '4k', duration: 15, ratio: '16:9' },
    })
    expect(res.status).toBe(200)
    await fastForward(() => o.status === 'review')
    const { DEFAULT_SPEC } = await import('@/lib/models')
    expect(o.winnerAgentId).toBe(o.ranking[0].agentId)
    expect(o.talentId).toBeUndefined()
    expect(o.spec).toMatchObject(DEFAULT_SPEC)
    expect(o.videoFile).toBe(recordingOf(TITLES[0]).videoFile)
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })

  it('still follows the transition table', async () => {
    const { st } = await replayDemo()
    const o = await fireToGate(TITLES[0])

    const early = await post('review', { orderId: o.id, action: 'approve' })
    expect(early.status).toBe(409)
    expect(await early.json()).toEqual({ error: 'illegal state', action: 'approve', status: 'greenlight' })

    expect((await post('greenlight', { orderId: o.id })).status).toBe(200)
    expect((await post('greenlight', { orderId: o.id })).status).toBe(409)
    await fastForward(() => o.status === 'review')
    expect((await post('review', { orderId: o.id, action: 'approve' })).status).toBe(200)
    expect((await post('review', { orderId: o.id, action: 'approve' })).status).toBe(409)
    expect((await post('greenlight', { orderId: 'ord_missing' })).status).toBe(404)
    expect(st.getStore().state.revenue).toBe(o.amountUsd)
    expect(st.getStore().state.delivered).toBe(1)
  })
})

describe('replay demo: memory only', () => {
  it('keeps the newest 20 orders and drops the oldest', async () => {
    const { st } = await replayDemo()
    const ids: string[] = []
    for (let i = 0; i < 23; i++) ids.push((await fire(TITLES[i % TITLES.length])).id)
    const kept = st.getStore().state.orders.map((o) => o.id)
    expect(kept).toHaveLength(20)
    expect(kept).toEqual(ids.slice(3).reverse())
  })

  it('a dropped order goes quiet: it adds no event and never reaches the gate', async () => {
    const { st } = await replayDemo()
    const first = await fire(TITLES[0])
    for (let i = 0; i < 20; i++) await fire(TITLES[0]) // pushes the first one out while its directors are still pitching
    const { state } = st.getStore()
    expect(state.orders.includes(first)).toBe(false)
    const eventsOfFirst = () => state.events.filter((e) => e.orderId === first.id).length
    const before = eventsOfFirst()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(eventsOfFirst()).toBeLessThanOrEqual(before)
    expect(first.status).not.toBe('greenlight')
    expect(first.ranking).toEqual([])
  })

  it('loads nothing from disk and writes nothing to disk', async () => {
    const dir = sandbox({ demoWrites: 'replay' })
    // a state file left on the host by an earlier run in another mode
    const stale = JSON.stringify({
      schema: 3,
      state: { orders: [{ id: 'ord_stale', title: 'stale', status: 'delivered', drafts: [], duels: [], ranking: [], createdAt: 1 }], events: [], revenue: 999, delivered: 9 },
      agents: [],
      seq: 10,
    })
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'data', 'state.json'), stale)
    vi.useFakeTimers()
    await forbidOutsideClients()

    const { state } = await getState()
    expect(state.orders).toEqual([])
    expect(state.revenue).toBe(0)

    const o = await fireToReview(TITLES[0])
    expect((await post('review', { orderId: o.id, action: 'approve' })).status).toBe(200)
    await vi.advanceTimersByTimeAsync(2000)
    expect(filesWritten()).toEqual(['data/state.json'])
    expect(fs.readFileSync(path.join(dir, 'data', 'state.json'), 'utf8')).toBe(stale)
  })
})

describe('replay demo: the store itself refuses what would need a client', () => {
  it('does not revise, resume, warm talents or register a portrait', async () => {
    const { st } = await replayDemo()
    const o = await fireToReview(TITLES[0])

    await st.runRevision(o.id, 'again')
    expect(o.status).toBe('review')
    expect(o.revision).toBe(0)

    // make the order look like one that has an upstream task to fetch
    const clip = o.videoFile
    o.videoFile = undefined
    o.videoTaskId = 'task_x'
    expect((await st.resumeRender(o.id)).ok).toBe(false)
    o.videoFile = clip

    expect(() => st.warm()).toThrow(/replay/i)
    await expect(st.addTalent({ blob: Buffer.from('not a portrait'), ext: 'png', name: 'Nobody' })).rejects.toThrow(/replay/i)

    await vi.advanceTimersByTimeAsync(2000)
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
    expect(filesWritten()).toEqual([])
  })
})
