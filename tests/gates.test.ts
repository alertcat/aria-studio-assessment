import { describe, expect, it, vi } from 'vitest'
import type { OrderStatus, TenantStore } from '@/lib/store'
import {
  NO_OUTSIDE_CALLS,
  holdRenders,
  idle,
  orderAt,
  outsideCalls,
  pilotSession,
  request,
  sandbox,
  settle,
} from './harness'

// H1. Each human-triggered action on an order is legal from a few statuses only.
// This table is the specification, written by hand on purpose. The store has to
// agree with it cell by cell, and the stories below show why each rule exists.

const STATUSES: OrderStatus[] = ['inbox', 'concepting', 'jury', 'greenlight', 'producing', 'review', 'revising', 'delivered']

const LEGAL_FROM = {
  greenlight: ['greenlight'], // Gate 1: fund the render
  approve: ['review'], // Gate 2: accept and settle
  revise: ['review'], // Gate 2: send back, which renders again
  resume: ['producing', 'review'], // fetch the result of an interrupted or failed render
} as const satisfies Record<string, readonly OrderStatus[]>

type Action = keyof typeof LEGAL_FROM
const ACTIONS = Object.keys(LEGAL_FROM) as Action[]

const act: Record<Action, (st: TenantStore, orderId: string) => unknown> = {
  greenlight: (st, id) => st.greenlightOrder(id),
  approve: (st, id) => st.approveOrder(id),
  revise: (st, id) => st.runRevision(id, 'test notes'),
  resume: (st, id) => st.resumeRender(id),
}

const books = (st: TenantStore) => JSON.stringify([st.getStore().state, st.getStore().agents])

/**
 * An order that has everything any action could ask for: concepts, a ranking, a
 * winner, and an upstream task with no clip yet. Then its status is forced, so the
 * status check is the only thing between the action and its effect.
 */
async function orderForcedTo(status: OrderStatus) {
  const { st, o } = await orderAt('greenlight')
  o.winnerAgentId = o.ranking[0].agentId
  o.videoTaskId = 'task_forced'
  o.videoInterrupted = true
  o.status = status
  vi.clearAllMocks() // forget the calls made while preparing
  return { st, o }
}

describe('transition table: every action from every status', () => {
  const cells = ACTIONS.flatMap((action) =>
    STATUSES.map((status) => ({ action, status, legal: (LEGAL_FROM[action] as readonly OrderStatus[]).includes(status) })),
  )

  it.each(cells.filter((c) => !c.legal))('$action from $status is refused and changes nothing', async ({ action, status }) => {
    const { st, o } = await orderForcedTo(status)
    const before = books(st)
    await act[action](st, o.id)
    await settle()
    expect(o.status).toBe(status)
    expect(books(st)).toBe(before)
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })

  it.each(cells.filter((c) => c.legal))('$action from $status is accepted', async ({ action, status }) => {
    const { st, o } = await orderForcedTo(status)
    const before = books(st)
    await act[action](st, o.id)
    if (action === 'greenlight') await vi.waitFor(() => expect(o.status).toBe('review'))
    expect(books(st)).not.toBe(before)
  })
})

describe('why the table exists', () => {
  it('the happy path passes both gates and books the order once', async () => {
    const { st, o } = await orderAt('delivered')
    const { state } = st.getStore()
    expect(state.revenue).toBe(100)
    expect(state.delivered).toBe(1)
    expect(o.invoice?.id).toBe('INV-2026-0001')
    expect((await outsideCalls()).render).toBe(1)
  })

  it('no render before greenlight', async () => {
    const { st, o } = await orderAt('greenlight')
    vi.clearAllMocks()
    st.approveOrder(o.id)
    await st.runRevision(o.id, 'skip the gate')
    await st.resumeRender(o.id)
    await settle()
    expect(o.status).toBe('greenlight')
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
  })

  it('no settlement before acceptance', async () => {
    const chain = await import('@/lib/chain')
    vi.mocked(chain.chainEnabled).mockReturnValue(true)
    vi.mocked(chain.settleUsdc).mockResolvedValue({ hash: '0xtest', url: 'https://example.invalid/tx', usdc: '1.00' })
    const { st, o } = await orderAt('review')
    expect(o.invoice).toBeUndefined()
    expect(st.getStore().state.revenue).toBe(0)
    expect((await outsideCalls()).settlement).toBe(0)
    st.approveOrder(o.id)
    expect(vi.mocked(chain.settleUsdc)).toHaveBeenCalledExactlyOnceWith(100)
  })

  it('a delivered order accepts no further action', async () => {
    const { st, o } = await orderAt('delivered')
    const { state } = st.getStore()
    const invoice = o.invoice?.id
    st.greenlightOrder(o.id)
    st.approveOrder(o.id)
    await st.runRevision(o.id, 'one more round')
    await st.resumeRender(o.id)
    st.approveOrder(o.id) // books a second invoice if the revision above went through
    await settle()
    expect(o.status).toBe('delivered')
    expect(o.revision).toBe(0)
    expect(o.invoice?.id).toBe(invoice)
    expect(state.revenue).toBe(100)
    expect(state.delivered).toBe(1)
    expect((await outsideCalls()).render).toBe(1)
  })

  it.each(['failed', 'completed'] as const)(
    'an order delivered without footage stays delivered when resume finds the old task %s',
    async (upstream) => {
      const video = await import('@/lib/video')
      vi.mocked(video.generateVideo).mockImplementation(async (_prompt, _dest, _onProgress, opts) => {
        opts?.onTask?.('task_1')
        throw new Error('render task failed upstream')
      })
      vi.mocked(video.fetchVideoResult).mockResolvedValue({ status: upstream, progress: 0 })
      const { st, o } = await orderAt('delivered') // accepted with the concept and poster only
      expect(o.videoFile).toBeUndefined()
      expect(o.videoTaskId).toBe('task_1')
      await st.resumeRender(o.id)
      expect(o.status).toBe('delivered')
      expect(st.getStore().state.revenue).toBe(100)
      expect((await outsideCalls()).resume).toBe(0)
    },
  )

  it('an order with a render in flight accepts no further action', async () => {
    const hold = await holdRenders()
    const { st, o } = await orderAt('greenlight')
    st.greenlightOrder(o.id)
    expect(o.status).toBe('producing')
    expect(hold.started()).toBe(1)

    st.greenlightOrder(o.id)
    st.approveOrder(o.id)
    void st.runRevision(o.id, 'change it while it renders')
    const resumed = await st.resumeRender(o.id)
    await settle()

    expect(hold.started()).toBe(1) // no second render
    expect(resumed.ok).toBe(false)
    expect((await outsideCalls()).resume).toBe(0) // the running task is not fetched behind its back
    expect(o.status).toBe('producing')
    expect(o.revision).toBe(0)
    expect(o.invoice).toBeUndefined()

    hold.release()
    await vi.waitFor(() => expect(o.status).toBe('review'))
    expect(hold.started()).toBe(1)
  })

  it('a repeated greenlight takes effect once', async () => {
    const { st, o } = await orderAt('greenlight')
    st.greenlightOrder(o.id)
    st.greenlightOrder(o.id)
    await vi.waitFor(() => expect(o.status).toBe('review'))
    st.greenlightOrder(o.id)
    await settle()
    expect(o.status).toBe('review')
    expect((await outsideCalls()).render).toBe(1)
    // the winner's reputation: 10 at start, +2 for one greenlight
    expect(st.getStore().agents.find((a) => a.id === o.winnerAgentId)?.reputation).toBe(12)
  })

  it('a repeated approve takes effect once', async () => {
    const chain = await import('@/lib/chain')
    vi.mocked(chain.chainEnabled).mockReturnValue(true)
    vi.mocked(chain.settleUsdc).mockResolvedValue({ hash: '0xtest', url: 'https://example.invalid/tx', usdc: '1.00' })
    const { st, o } = await orderAt('review')
    st.approveOrder(o.id)
    st.approveOrder(o.id)
    await settle()
    const { state } = st.getStore()
    expect(state.revenue).toBe(100)
    expect(state.delivered).toBe(1)
    expect(o.invoice?.id).toBe('INV-2026-0001')
    expect((await outsideCalls()).settlement).toBe(1)
  })

  it('resume still fetches a render that timed out', async () => {
    const video = await import('@/lib/video')
    vi.mocked(video.generateVideo).mockImplementation(async (_prompt, _dest, _onProgress, opts) => {
      opts?.onTask?.('task_1')
      throw new Error('render timeout')
    })
    const { st, o } = await orderAt('greenlight')
    st.greenlightOrder(o.id)
    await vi.waitFor(() => expect(o.videoInterrupted).toBe(true))
    expect(o.status).toBe('producing')

    vi.mocked(video.fetchVideoResult).mockResolvedValue({ status: 'completed', progress: 100 })
    const resumed = await st.resumeRender(o.id)
    expect(resumed).toMatchObject({ ok: true, status: 'completed' })
    expect(o.status).toBe('review')
    expect(o.videoFile).toBeDefined()
  })

  it('resume sends a failed render back to the greenlight gate', async () => {
    const video = await import('@/lib/video')
    vi.mocked(video.generateVideo).mockImplementation(async (_prompt, _dest, _onProgress, opts) => {
      opts?.onTask?.('task_1')
      throw new Error('render task failed upstream')
    })
    const { st, o } = await orderAt('review') // at the gate with no footage
    vi.mocked(video.fetchVideoResult).mockResolvedValue({ status: 'failed', progress: 0 })
    const resumed = await st.resumeRender(o.id)
    expect(resumed).toMatchObject({ ok: true, status: 'failed' })
    expect(o.status).toBe('greenlight')
  })
})

describe('the routes report a refusal instead of answering ok', () => {
  const routes = {
    greenlight: () => import('@/app/api/greenlight/route'),
    review: () => import('@/app/api/review/route'),
    resume: () => import('@/app/api/resume/route'),
  }
  type Route = keyof typeof routes
  const post = async (route: Route, body: Record<string, unknown>, headers?: Record<string, string>) =>
    (await routes[route]()).POST(request(`/api/${route}`, { body, headers }))

  const refusals: { name: string; at: 'greenlight' | 'review' | 'delivered'; route: Route; action: Action }[] = [
    { name: 'greenlight on an order that waits for acceptance', at: 'review', route: 'greenlight', action: 'greenlight' },
    { name: 'greenlight on a delivered order', at: 'delivered', route: 'greenlight', action: 'greenlight' },
    { name: 'approve before greenlight', at: 'greenlight', route: 'review', action: 'approve' },
    { name: 'approve on a delivered order', at: 'delivered', route: 'review', action: 'approve' },
    { name: 'revise before greenlight', at: 'greenlight', route: 'review', action: 'revise' },
    { name: 'revise on a delivered order', at: 'delivered', route: 'review', action: 'revise' },
    { name: 'resume before greenlight', at: 'greenlight', route: 'resume', action: 'resume' },
    { name: 'resume on a delivered order', at: 'delivered', route: 'resume', action: 'resume' },
  ]

  it.each(refusals)('$name: 409, and nothing changes', async ({ at, route, action }) => {
    sandbox({ demoWrites: true })
    const { st, o } = await orderAt(at)
    const before = books(st)
    const res = await post(route, { orderId: o.id, action, feedback: 'test notes' })
    await idle(st) // without the guard the route starts background work: let it end inside this test
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'illegal state', action, status: at })
    expect(books(st)).toBe(before)
  })

  it.each(ACTIONS)('%s on an unknown order: 404', async (action) => {
    sandbox({ demoWrites: true })
    const route: Route = action === 'greenlight' ? 'greenlight' : action === 'resume' ? 'resume' : 'review'
    const res = await post(route, { orderId: 'ord_missing', action })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'order not found', action })
  })

  it('legal calls still answer 200 and act: greenlight, revise, approve', async () => {
    sandbox({ demoWrites: true })
    const { st, o } = await orderAt('greenlight')

    expect((await post('greenlight', { orderId: o.id })).status).toBe(200)
    await idle(st)
    expect(o.status).toBe('review')

    expect((await post('review', { orderId: o.id, action: 'revise', feedback: 'tighter' })).status).toBe(200)
    await idle(st)
    expect(o.status).toBe('review')
    expect(o.revision).toBe(1)

    expect((await post('review', { orderId: o.id, action: 'approve' })).status).toBe(200)
    expect(o.status).toBe('delivered')
    expect((await outsideCalls()).render).toBe(2)
    expect(st.getStore().state.revenue).toBe(100)
  })

  it('a second greenlight request gets 409 while the first render runs', async () => {
    sandbox({ demoWrites: true })
    const hold = await holdRenders()
    const { o } = await orderAt('greenlight')
    expect((await post('greenlight', { orderId: o.id })).status).toBe(200)
    const second = await post('greenlight', { orderId: o.id })
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'illegal state', action: 'greenlight', status: 'producing' })
    expect(hold.started()).toBe(1)
    hold.release()
    await vi.waitFor(() => expect(o.status).toBe('review'))
  })

  it('pilot mode: a revision cannot start a second paid render while the first is in flight', async () => {
    sandbox({ pilot: true })
    const hold = await holdRenders()
    const headers = await pilotSession()
    const { POST: createOrder } = await import('@/app/api/orders/route')
    expect((await createOrder(request('/api/orders', { headers, body: { template: 0 } }))).status).toBe(200)

    const { storeForRequest } = await import('@/lib/ctx')
    const st = storeForRequest(request('/api/state', { method: 'GET', headers }))!
    const o = st.getStore().state.orders[0]
    await vi.waitFor(() => expect(o.status).toBe('greenlight'))

    expect((await post('greenlight', { orderId: o.id }, headers)).status).toBe(200)
    expect(o.status).toBe('producing')

    // the pilot "one job at a time" limit excludes the order itself, so only the status check can stop this
    const res = await post('review', { orderId: o.id, action: 'revise', feedback: 'again' }, headers)
    await settle()
    expect(res.status).toBe(409)
    expect(hold.started()).toBe(1)

    hold.release()
    await vi.waitFor(() => expect(o.status).toBe('review'))
  })
})
