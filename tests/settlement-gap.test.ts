import { describe, expect, it, vi } from 'vitest'
import { orderAt, outsideCalls } from './harness'

// H2, a known gap that this change does not fix (planning/03-decisions.md, D-03).
// approveOrder() marks the order delivered and books the revenue before the
// settlement transfer has resolved. When the transfer fails, the books keep the
// money and the invoice says "simulated settlement".

async function approveWithFailingTransfer() {
  const chain = await import('@/lib/chain')
  vi.mocked(chain.chainEnabled).mockReturnValue(true)
  vi.mocked(chain.settleUsdc).mockRejectedValue(new Error('buyer wallet USDC balance too low'))
  const { st, o } = await orderAt('review')
  st.approveOrder(o.id)
  // the failure reaches the invoice once the transfer promise has settled
  await vi.waitFor(() => expect(o.invoice?.ref).toContain('live tx failed'))
  return { st, o }
}

describe('settlement (H2, known gap)', () => {
  // A plain test over the same setup, so the expected failure below cannot pass
  // because its setup broke.
  it('a failed transfer is recorded on the invoice', async () => {
    const { o } = await approveWithFailingTransfer()
    expect(o.invoice?.ref).toContain('buyer wallet USDC balance too low')
    expect((await outsideCalls()).settlement).toBe(1)
  })

  // Written as the behaviour we want. It fails today, and `it.fails` reports that
  // as a pass. The day H2 is fixed this test starts failing: turn it into a plain
  // `it` in the same commit.
  it.fails('KNOWN GAP: a failed transfer should not leave revenue booked', async () => {
    const { st } = await approveWithFailingTransfer()
    expect(st.getStore().state.revenue).toBe(0)
  })
})
