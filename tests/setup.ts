import { afterAll, beforeEach, vi } from 'vitest'
import { APP_ENV, cleanupSandboxes, sandbox } from './harness'

// Runs before every test file and makes the suite hermetic by construction:
// no network, no real key, no real data directory, no paid client.
// tests/harness.test.ts proves each of these points.

// 1. Nothing leaks in from the developer's shell.
for (const name of APP_ENV) delete process.env[name]

// 2. Every external client the store uses is replaced, for every test file.
//    The network itself is closed in sandbox(), as a backstop for clients not listed here.
vi.mock('@/lib/llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm')>()
  const noModel = async (): Promise<string> => {
    throw new Error('LLM calls are mocked in tests')
  }
  return {
    ...actual, // keeps cacheKey, a pure function
    chatDirector: vi.fn(noModel),
    chatOpenAI: vi.fn(noModel),
    chatClaude: vi.fn(noModel),
    chatGateway: vi.fn(noModel),
    // Same contract as the real wrapper, but it never calls `live`: every director
    // and judge answers with the canned fallback, instantly.
    reliable: vi.fn(async (_key: string, _live: () => Promise<string>, fallback: () => string) => ({
      content: fallback(),
      cached: false,
    })),
  }
})

vi.mock('@/lib/video', () => ({
  generateVideo: vi.fn(async () => {}),
  fetchVideoResult: vi.fn(async () => ({ status: 'running' as const, progress: 0 })),
}))

vi.mock('@/lib/image', () => ({ generateImage: vi.fn(async () => {}) }))

vi.mock('@/lib/chain', () => ({
  chainEnabled: vi.fn(() => false),
  settleUsdc: vi.fn(async (): Promise<{ hash: string; url: string; usdc: string }> => {
    throw new Error('settlement is mocked in tests')
  }),
}))

vi.mock('@/lib/escrowWatch', () => ({ startEscrowWatch: vi.fn() }))

// 3. Every test starts in a throwaway directory, in demo mode, with clean mocks.
//    A test that needs another mode calls sandbox() again as its first line.
beforeEach(() => {
  sandbox()
})

afterAll(cleanupSandboxes)
