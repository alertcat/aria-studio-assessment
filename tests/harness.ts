import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, vi } from 'vitest'
import type { Order, TenantStore } from '@/lib/store'

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Every variable the app documents in .env.example. The setup file removes them all. */
export const APP_ENV: string[] = fs
  .readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8')
  .split(/\r?\n/)
  .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
  .filter((name): name is string => !!name)

export type Mode = { pilot?: boolean; demoWrites?: boolean }

const sandboxes: string[] = []
let current = ''

/**
 * A fresh world for one test: a temp directory as working directory and DATA_ROOT,
 * the chosen mode, a closed network, an empty store registry, a clean module graph
 * and mocks back to their defaults. The setup file runs it before every test in
 * demo mode. Call it again as the first line of a test that needs another mode.
 */
export function sandbox(mode: Mode = {}): string {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
  current = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-test-'))
  sandboxes.push(current)
  // lib/tenant.ts and lib/llm.ts place their files under process.cwd()
  vi.spyOn(process, 'cwd').mockReturnValue(current)
  vi.stubEnv('DATA_ROOT', path.join(current, 'data'))
  if (mode.pilot) vi.stubEnv('ARIA_MODE', 'pilot')
  if (mode.demoWrites) vi.stubEnv('ARIA_DEMO_WRITES', '1')
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network is disabled in tests')
    }),
  )
  // stores are cached on globalThis, which survives vi.resetModules()
  delete (globalThis as { __ariaStores?: unknown }).__ariaStores
  // PILOT is read once at import, so every test re-imports the app
  vi.resetModules()
  return current
}

/** Remove the sandboxes of this file. Waits out the store's 400 ms save timer first. */
export async function cleanupSandboxes() {
  await new Promise((resolve) => setTimeout(resolve, 450))
  for (const dir of sandboxes.splice(0)) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
}

// ---------- side-effect probes ----------

/** Files written under the current sandbox, relative, with forward slashes. */
export function filesWritten(): string[] {
  return (fs.readdirSync(current, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(current, path.join(entry.parentPath, entry.name)).replace(/\\/g, '/'))
    .sort()
}

/** How many tenant stores this process has created. */
export function storesCreated(): number {
  return (globalThis as { __ariaStores?: Map<string, unknown> }).__ariaStores?.size ?? 0
}

export const NO_OUTSIDE_CALLS = { fetch: 0, llm: 0, render: 0, resume: 0, poster: 0, settlement: 0 }

/** Calls to anything that costs money or leaves the process in production. */
export async function outsideCalls(): Promise<typeof NO_OUTSIDE_CALLS> {
  const [llm, video, image, chain] = await Promise.all([
    import('@/lib/llm'),
    import('@/lib/video'),
    import('@/lib/image'),
    import('@/lib/chain'),
  ])
  const count = (fn: unknown) => vi.mocked(fn as () => unknown).mock.calls.length
  return {
    fetch: count(fetch),
    llm: count(llm.reliable) + count(llm.chatDirector) + count(llm.chatOpenAI) + count(llm.chatClaude) + count(llm.chatGateway),
    render: count(video.generateVideo),
    resume: count(video.fetchVideoResult),
    poster: count(image.generateImage),
    settlement: count(chain.settleUsdc),
  }
}

// ---------- requests ----------

export function request(
  pathname: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const method = init.method ?? 'POST'
  return new Request(`http://localhost${pathname}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(init.body ?? {}),
  })
}

/**
 * Headers of a logged-in pilot caller: a signed tenant cookie and the matching key.
 * Built with the app's own functions. The key only has the right shape. It is not a
 * real key, and the network is closed anyway.
 */
export async function pilotSession(): Promise<Record<string, string>> {
  const tenant = await import('@/lib/tenant')
  const key = 'sk-' + 'test'.repeat(6)
  const cookie = tenant.tenantCookie(tenant.tenantIdFor(key)).split(';')[0]
  return { cookie, authorization: `Bearer ${key}` }
}

// ---------- orders ----------

/** The store that demo-mode routes use. It lives in the current sandbox. */
export async function defaultStore(): Promise<TenantStore> {
  const { storeFor } = await import('@/lib/store')
  return storeFor()
}

let orderNo = 0

/** Create an order and walk it through the mocked pipeline until it rests at `target`. */
export async function orderAt(
  target: 'inbox' | 'greenlight' | 'review' | 'delivered',
  amountUsd = 100,
): Promise<{ st: TenantStore; o: Order }> {
  const st = await defaultStore()
  const o = st.createOrder({ client: 'Test Client', title: `Test order ${++orderNo}`, brief: 'A test brief.', amountUsd })
  if (target === 'inbox') return { st, o }
  await st.runPipeline(o.id)
  expect(o.status).toBe('greenlight')
  if (target === 'greenlight') return { st, o }
  st.greenlightOrder(o.id)
  await vi.waitFor(() => expect(o.status).toBe('review'))
  if (target === 'review') return { st, o }
  st.approveOrder(o.id)
  expect(o.status).toBe('delivered')
  return { st, o }
}

/** Make renders hang until released, like a real render that takes minutes. */
export async function holdRenders() {
  const video = await import('@/lib/video')
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let tasks = 0
  vi.mocked(video.generateVideo).mockImplementation(async (_prompt, _dest, _onProgress, opts) => {
    opts?.onTask?.(`task_${++tasks}`)
    await held
  })
  return { release, started: () => vi.mocked(video.generateVideo).mock.calls.length }
}

/**
 * Wait until no order is in a transient status. Tests call this before asserting, so
 * work that was started by mistake finishes inside the test that caused it.
 */
export async function idle(st: TenantStore) {
  await vi.waitFor(() => expect(st.activeCount()).toBe(0))
}
