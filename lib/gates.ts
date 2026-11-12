import type { OrderStatus } from './store'

// The order lifecycle has two human gates. Every action a human can trigger on an
// order is legal from a few statuses only, and this table is the single place
// that says which. The store enforces it. The routes use it to answer 404 or 409.

export type GateAction = 'greenlight' | 'approve' | 'revise' | 'resume'

export const LEGAL_FROM: Record<GateAction, readonly OrderStatus[]> = {
  /** Gate 1: fund the render. */
  greenlight: ['greenlight'],
  /** Gate 2: accept the cut, which settles the order. */
  approve: ['review'],
  /** Gate 2: send it back with notes, which renders again. */
  revise: ['review'],
  /** Fetch the result of a render that was interrupted (producing) or failed (review). */
  resume: ['producing', 'review'],
}

export function canApply(status: OrderStatus, action: GateAction): boolean {
  return LEGAL_FROM[action].includes(status)
}

export type Refusal =
  | { http: 404; error: 'order not found'; action: GateAction }
  | { http: 409; error: 'illegal state'; action: GateAction; status: OrderStatus }

/** Why `action` may not run on this order right now, or null when it may. */
export function refusal(order: { status: OrderStatus } | undefined, action: GateAction): Refusal | null {
  if (!order) return { http: 404, error: 'order not found', action }
  if (!canApply(order.status, action)) return { http: 409, error: 'illegal state', action, status: order.status }
  return null
}
