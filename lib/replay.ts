import snapshot from '../public/demo-state.json'
import type { Draft, Duel } from './store'

// The public demo (ARIA_DEMO_WRITES=replay) runs on a host that holds no key. It
// replays runs that were recorded earlier and are part of the repository: the
// concepts, the jury verdicts and the finished media in public/demo-state.json
// and public/media. This module is the only place that reads that recording.

/** Orders kept in memory in replay mode. Beyond this the oldest is dropped. */
export const REPLAY_MAX_ORDERS = 20

/** The simulated render moves in five steps of this length. */
export const REPLAY_RENDER_STEP_MS = 900

/** The sentence a visitor reads when the replay demo refuses something. One per rule. */
export const REPLAY_REASONS = {
  closed: 'Replay demo: only template briefs, greenlight and acceptance are open.',
  custom: 'Replay demo: custom briefs are off, so fire one of the template briefs instead.',
  override: 'Replay demo: only the jury pick has recorded footage, so an override cannot be shown.',
  revise: 'Replay demo: revisions are off, because a revision needs a new render.',
} as const

export type Recording = {
  title: string
  drafts: Draft[]
  duels: Duel[]
  videoFile: string
  posterFile?: string
}

type RecordedOrder = Recording & {
  status: string
  revision: number
  createdAt: number
  winnerAgentId?: string
  ranking: { agentId: string }[]
}

// A run can be replayed when it was delivered without a revision and the human
// greenlit the jury's pick. Then the recorded cut belongs to the concept that
// ranks first, which is the one concept a visitor can greenlight in replay mode.
const recordings: RecordedOrder[] = (snapshot.state.orders as unknown as RecordedOrder[])
  .filter(
    (o) =>
      o.status === 'delivered' &&
      o.revision === 0 &&
      !!o.videoFile &&
      !!o.winnerAgentId &&
      o.winnerAgentId === o.ranking[0]?.agentId,
  )
  .sort((a, b) => a.createdAt - b.createdAt)

/** The recorded run that is replayed for a brief with this title: the oldest one that qualifies. */
export function recordingFor(title: string): Recording | undefined {
  return recordings.find((r) => r.title === title)
}
