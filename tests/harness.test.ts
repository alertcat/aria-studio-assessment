import os from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { APP_ENV, NO_OUTSIDE_CALLS, filesWritten, orderAt, outsideCalls, sandbox, storesCreated } from './harness'

// The other test files rely on these guarantees. If one of them breaks, fix the
// harness before trusting any other result.

describe('test harness', () => {
  it('has no network', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow('network is disabled in tests')
  })

  it('removes every variable documented in .env.example from the environment', () => {
    expect(APP_ENV).toContain('ARIA_MODE')
    expect(APP_ENV).toContain('RENDER_API_KEY')
    expect(APP_ENV).toContain('CHAIN_BUYER_PK')
    // DATA_ROOT is the one variable the sandbox sets itself
    for (const name of APP_ENV.filter((n) => n !== 'DATA_ROOT')) expect(process.env[name], name).toBeUndefined()
  })

  it('starts every test in demo mode, in a throwaway directory', async () => {
    const { PILOT, defaultTenant } = await import('@/lib/tenant')
    expect(PILOT).toBe(false)
    expect(process.cwd().startsWith(os.tmpdir())).toBe(true)
    expect(defaultTenant().dataDir.startsWith(os.tmpdir())).toBe(true)
    expect(defaultTenant().mediaDir.startsWith(os.tmpdir())).toBe(true)
    expect(String(process.env.DATA_ROOT).startsWith(os.tmpdir())).toBe(true)
    expect(filesWritten()).toEqual([])
    expect(storesCreated()).toBe(0)
  })

  it('can switch a test to pilot mode', async () => {
    sandbox({ pilot: true })
    const { PILOT } = await import('@/lib/tenant')
    expect(PILOT).toBe(true)
  })

  it('does not leak the mode into the next test', async () => {
    const { PILOT } = await import('@/lib/tenant')
    expect(PILOT).toBe(false)
    expect(process.env.ARIA_MODE).toBeUndefined()
  })

  it('runs the whole pipeline on canned answers, without a model, a render or a transfer', async () => {
    const { o } = await orderAt('delivered')
    expect(o.drafts).toHaveLength(3)
    expect(o.duels).toHaveLength(6)
    expect(o.invoice?.ref).toContain('simulated settlement')
    // 3 concepts and 6 duels went through the mocked wrapper, 1 render and 1 poster through the mocked clients
    expect(await outsideCalls()).toEqual({ ...NO_OUTSIDE_CALLS, llm: 9, render: 1, poster: 1 })
  })

  it('part 1 of 2: a test changes a mock and leaves calls behind', async () => {
    const video = await import('@/lib/video')
    vi.mocked(video.generateVideo).mockImplementation(async () => {
      throw new Error('this implementation must not reach the next test')
    })
    const { o } = await orderAt('review')
    expect(o.videoFile).toBeUndefined()
    expect((await outsideCalls()).render).toBe(1)
  })

  it('part 2 of 2: the next test gets clean mocks with their default behaviour', async () => {
    expect(await outsideCalls()).toEqual(NO_OUTSIDE_CALLS)
    const { o } = await orderAt('review')
    expect(o.videoFile).toBeDefined()
    expect((await outsideCalls()).render).toBe(1)
  })
})
