# Plan: gate harness for Aria Studio

Written by the build session on 2026-11-12, before any code change. Inputs: `00-recon-handoff.md`
and the assessment brief. Scope is fixed by the owner's decisions in section 3. Recon and this
plan took about 45 minutes, which leaves about 2 h 15 min of build time.

Correction, added at 16:05 the same day: that estimate was wrong. The session transcript shows
recon and plan took 17 minutes (15:10 to 15:27). I had no clock and guessed (miss M-11). The
task estimates in `02-tasks.md` were too high for the same reason. Actual times are listed there.

## 1. Hypotheses checked against the code

All three hold. Each was checked twice: by reading the code at the `baseline` tag (references
below), and by running a throwaway Vitest probe against the untouched baseline source from a
scratch directory outside the repo, with the LLM, render and chain modules mocked and a temp
data directory. The repo was not modified.

### H0. Demo mode has no write protection: holds, and the handoff's route list is incomplete

- `lib/tenant.ts:90-91`: `tenantFromRequest()` returns the default tenant for every request when
  `PILOT` is false.
- `lib/ctx.ts:20-21`: `spendKey()` returns no key in demo mode, so the server key applies
  (`lib/video.ts:12-16`, `lib/image.ts:12-13`, `lib/talent.ts:34-38`). LLM calls always use the
  server's keys (`lib/llm.ts:118`, `:153`, `:165`).
- Every mutating handler checks only that a store exists: `app/api/orders/route.ts:12-13`,
  `greenlight/route.ts:13-14`, `review/route.ts:13-14`, `prune/route.ts:9-10`,
  `reset/route.ts:7-8`, `playbook/route.ts:7-8`, `talent/upload/route.ts:13-14`.
- The rate limits are pilot-only (`app/api/orders/route.ts:14-27`), so demo mode has none.
- **Missing from the handoff:** `POST /api/resume` (`app/api/resume/route.ts:9-17`, mutates order
  state and downloads with the server key) and `POST /api/talent` (`app/api/talent/route.ts:13-19`,
  registers portraits upstream with the server key). There are 9 mutating handlers, not 7.
- Not mutating in demo mode: `login` (`app/api/login/route.ts:10`) and `logout` (clears a cookie).
- Limit of this check: the repo holds no logs of the incident. I can confirm that the code path
  matches the handoff's description, not the incident itself.

### H1. Revision ignores order state: holds, and `resume` has the same defect

- `lib/store.ts:727-730`: `runRevision()` checks that the order exists and has a winner (plus the
  key in pilot mode), then sets `revising` at `:732`.
- `app/api/review/route.ts:20-40`: the `revise` branch has no status check, and the route
  answers `{ ok: true }` whatever happened (`:44`).
- `app/api/review/route.ts:24` with `lib/store.ts:928-930`: `activeCount(orderId)` excludes the
  order itself, so the pilot "one job at a time" limit does not stop a second render of the
  same order.
- Double booking: `approveOrder()` (`lib/store.ts:811-859`) gives a re-approved order a new
  invoice id that overwrites the first (`:819-820`), adds revenue again (`:843`), counts it
  delivered again (`:844`), and starts a second transfer when chain settlement is on (`:828-831`).
- **Not in the handoff:** `resumeRender()` (`lib/store.ts:771-775`) has no status check either.
  It moves any order that has a task id and no clip to `review` (`:785`) or back to `greenlight`
  (`:795`). An order delivered without footage can therefore leave `delivered`, and the studio
  UI shows the button for it (`app/studio/page.tsx:1028-1031`, `:1064-1070`).
- Already guarded in the store: `greenlightOrder()` (`lib/store.ts:539`) and `approveOrder()`
  (`:813`). Both return silently and the routes still answer `{ ok: true }`
  (`app/api/greenlight/route.ts:36-37`, `app/api/review/route.ts:19`, `:44`).

### H2. Revenue is booked before settlement resolves: holds

- `lib/store.ts:842-844`: status, revenue and the delivered count are set synchronously, right
  after the transfer is started as fire-and-forget (`:828-840`).
- `lib/store.ts:834-838`: when the transfer fails, the reference becomes "simulated settlement;
  live tx failed: ..." and nothing is reversed.
- `lib/store.ts:85`: an invoice is `{ id, paidAt, ref }`. `paidAt` is set at acceptance (`:821`).
  There is no settlement status. The path is only live in demo mode with chain keys set
  (`:822`, `:828`).
- Also seen: a restart during the transfer leaves "Settling USDC on Base Sepolia..." for good.
  Nothing retries it.

### Probe output at baseline

```
H0 anonymous demo callers:  {"reset":200,"prune":200,"orders":200,"playbook":200,"resume":200,"talent":200}
H1 after a second approve:  {"revenue":200,"delivered":2,"firstInvoice":"INV-2026-0001","secondInvoice":"INV-2026-0002"}
H1 revise while producing:  renders in flight for one order: 2
H1 resume on a delivered order: {"result":"failed","statusNow":"greenlight","revenue":100}
H2 after a failed transfer: {"status":"delivered","revenue":100,"ref":"0x... (Base Sepolia, simulated settlement; live tx failed: buyer wallet USDC balance too low)"}
```

The probe is not committed. Its assertions come back in phase 2 as the failing tests.

## 2. Other findings from recon

- Baseline `npm run build` passes in 17 seconds and leaves the tree clean. `tsconfig.json`
  includes `**/*.ts`, so the build type-checks test files too.
- Local Node is 20.18.0. The latest Vitest (5.1.0) needs Node 22.12 or newer.
- On Node 20.18 a `vitest.config.ts` fails to load in this CommonJS package (`ERR_REQUIRE_ESM`).
  A `.mts` config loads.
- The studio UI shows "This key does not match the current session" for every 403
  (`app/studio/page.tsx:337-338`).
- The demo store lives in `./data` and `public/media`, and `makeStore()` re-runs concepts and
  jury for young inbox orders at boot (`lib/store.ts:284`, `:308-315`). A route test without a
  sandbox would reset real local data on its first, failing run.
- This checkout has no `.env.local` and no `data/` directory. The brief PDF is already listed in
  `.git/info/exclude`. There is no git remote.

## 3. Decisions the owner already made

- H0: demo mode is read-only by default. Writes need an explicit environment variable. Pilot
  mode behaves as before. No UI change.
- H1: add order status checks. An action in an illegal state is refused.
- H2: not fixed now. It goes into the README as the weakest part, with the next step.
- No lint fix, no refactor of the rest of `store.ts`, no deployment.
- Tests first. Vitest is the only new dependency. Every external call is mocked. No paid API
  call. `.env.local` is never read. Provider configuration stays generic and environment-driven.
- Branch `assessment/gate-harness` from `baseline`, small commits, no push.

Added by the owner when approving this plan:

- The permission test enumerates every route under `app/api` that exports a write method. No
  hand-written list of guarded routes: the handoff's list already missed two. Routes that stay
  open are listed explicitly, each with its reason.
- The refusal is a 405 with an `Allow` header and one clear reason sentence. The UI may get one
  very small branch that shows this reason. That is the only exception to "no UI change".
- The two handoff omissions (two routes, `resumeRender`) are recorded in `04-agent-misses.md`.

## 4. Approach

### A. Test harness (no behaviour change)

- `vitest@4.1.12`, pinned exactly. `npm test` runs `vitest run`.
- `vitest.config.mts`: the `@` alias, node environment, `tests/**/*.test.ts`, one setup file,
  no `.env` file loading.
- `tests/setup.ts` makes every test file hermetic by construction: module mocks for `lib/llm`
  (`reliable` returns the canned fallback and never calls a model), `lib/video`, `lib/image`,
  `lib/chain` and `lib/escrowWatch`; a global `fetch` that throws; the app's environment
  variables removed from `process.env`.
- `tests/harness.ts`: `sandbox()` gives each test a temp directory as working directory and
  `DATA_ROOT`, a fresh module registry, an empty store registry and reset mocks. Plus a request
  builder and helpers that walk an order to a given status.
- Self-tests prove the sandbox: `fetch` rejects, the working directory is a temp directory,
  mocks start clean in every test.

### B. H0: read-only demo

- Red: `tests/demo-readonly.test.ts`. It walks the `app` directory, imports every `route.ts` and
  takes every exported `POST`, `PUT`, `PATCH` or `DELETE` as a case. There is no hand-written
  list of guarded routes, so a new write route is tested the day it is added. The only list is
  the exemptions, each with a reason, and each exemption is held to "no store, no file, no
  outside call". Matrix per discovered handler: demo default is refused with no side effect;
  demo with `ARIA_DEMO_WRITES=1` is not refused; pilot without a session is 401 as before; pilot
  with a session is not refused. Requests are generic (an empty JSON body), so no per-route
  fixture is needed either.
- Green: `readOnlyDemo()` in `lib/ctx.ts`, called as the first statement of the nine handlers,
  before the store is touched. It answers 405 with an `Allow` header and one reason sentence.
  The test derives the expected `Allow` value from the read methods each route module really
  exports. `ARIA_DEMO_WRITES` is documented in `.env.example`. Enabling it logs one warning.
- UI: one branch in the studio's `post()` shows the reason from a 405 in the existing notice
  line. Nothing else in the UI changes.

### C. H1: gate guards

- Red: `tests/gates.test.ts`. The full action-by-status matrix written out by hand; the order
  lifecycle against the mocked pipeline (no render before greenlight, no settlement before
  acceptance, a delivered order accepts nothing, an order with a render in flight accepts
  nothing, repeated greenlight or approve takes effect once); and the routes answering 404 or
  409 instead of `{ ok: true }`.
- Green: `lib/gates.ts` holds one table and `canApply(status, action)` for the four actions
  `greenlight`, `approve`, `revise`, `resume`. The four store functions enforce it. The routes
  ask the same check immediately before acting, so they can report the refusal.
- `resume` is legal from `producing` and `review`, and additionally refused while a render is
  still in flight.

### D. H2: pin the gap, do not fix it

- One `it.fails` test states the wanted behaviour (no revenue when the transfer fails). It passes
  while the gap exists and starts failing the day someone fixes it.

### E. Check the real server

- Start the app in default demo mode and confirm a write is refused over HTTP. Only refused
  requests are sent, so the store is never created and nothing external is called.

### F. CI, if time allows

- One workflow: `npm ci`, `npm test`, `npm run build`.

### G. Wrap-up

- README top section, session log export (Chinese original, English translation, redacted),
  `logs/README.md`, final full test run and build.

## 5. Risks

| Risk | Handling |
|---|---|
| A future write route forgets the guard | The permission test enumerates handlers from the filesystem, so the new route fails it without anyone editing a list |
| A test touches real data or the network | Sandbox, throwing `fetch`, scrubbed environment, and self-tests that assert all three |
| `PILOT` is fixed at import time | Fresh module registry and dynamic import per mode; the store registry on `globalThis` is cleared |
| Mock state leaks between tests (seen in the probe) | Reset in `beforeEach`, covered by a self-test |
| Default demo mode now refuses writes | README and `.env.example` explain the switch. The studio shows the server's reason. The landing page has no notice line and stays silent |
| `ARIA_DEMO_WRITES=1` on a public host reopens the hole | One warning at first use and a plain statement in the README. Demo mode still has no per-caller login: accepted residual risk |
| Illegal actions now answer 404 or 409 instead of 200 | The UI only offers each action in its legal status (`app/studio/page.tsx:832`, `:1141`) |
| Red commits fail on purpose | Labelled `test(red):`, each followed directly by its fix |
| CI cannot run before the owner pushes | Kept minimal. The lockfile already carries the Linux native packages |
| The log export needs the local transcript file | If it cannot be read, rebuild from context and say so in `logs/README.md` |
| Time | Cut list below |

## 6. What is cut

Never in scope: an admin token, UI changes, lint, refactoring `store.ts`, deployment, fixing H2,
Bradley-Terry property tests, the jury position-bias evaluation.

Cut in this order if time runs short: the CI workflow, the in-flight precondition on `resume`,
the H2 pin test, the live server check.

## 7. Seen, not touched

- `GET /api/state` starts the escrow watcher in demo mode (`lib/store.ts:906`).
- The boot-time pipeline resume spends the server's LLM keys (`lib/store.ts:284`, `:308-315`).
- A revision whose render times out cannot be resumed, because the previous clip is still
  attached and `lib/store.ts:668` requires `!o.videoFile`. The old cut stays at the gate.
- With writes enabled, `prune` and `reset` are still open to any caller in demo mode.

## 8. Second task: a public demo that needs no key (added 2026-11-12, 16:58)

The owner's request, given after the first task was finished and summarised. No stop for
approval this time. Same rules: tests first, a red commit before each fix, no push.

1. Upgrade dependencies first: `next` to 16.4.6, then `npm audit fix` without `--force`. Record
   what remains. No major-version upgrade.
2. A third value for `ARIA_DEMO_WRITES`, `replay`, for a public demo on a host that holds no
   key. Only three writes are open: an order from a template, greenlight, acceptance. Every
   other write keeps answering 405 with a reason. Content comes from `public/demo-state.json`
   and `public/media`. No external client may be called, and the tests prove it by making
   every client throw. Custom orders are refused with a clear reason. Orders live in memory
   only, at most 20, the oldest dropped first, nothing on disk. Short simulated delays stay.
   The transition table still applies. The permission test still enumerates routes and covers
   the replay tier.
3. A minimal `fly.toml`: one smallest machine, stop when idle, `ARIA_DEMO_WRITES=replay` as the
   only variable, no secret, no volume. No deploy command is run.
4. README and planning files updated. 5. Session logs extended. 6. Final test, build, commit list.

### What the code and the data say

- The snapshot lists three templates, and exactly those three have a recorded run that was
  delivered without a revision: Kopi Loco (`ord_1`), Visit Palawan (`ord_2`), SlateLab (`ord_3`).
  The code has a fourth template, Kaya & Co., with no recording. "One of the three templates"
  in the request matches the data, not `TEMPLATES` in `lib/store.ts`.
- In each of those three runs the human greenlit the jury's pick, so the recorded cut belongs to
  the concept that ranks first. An override would have no footage.
- The recorded media paths are static files (`/media/...` under `public/`). No route is needed.
- The baseline already paces cached answers (`pace()` in `lib/store.ts`): 2 to 5.5 seconds per
  concept, 0.8 to 2.4 seconds per duel. "Keep the short delays" can mean exactly these.
- The baseline pipeline reaches the outside world in five places: `reliable()` for directors
  and jurors, `generateImage`, `generateVideo`, `settleUsdc`, and the escrow watcher that
  `publicState()` starts. `reliable()` and `saveSoon()` also write to disk.
- The UI needs no change: the studio already shows the reason of any 405, and it lists
  whatever templates the server sends.

### Approach

- `demoWrites()` in `lib/tenant.ts` turns the variable into `off`, `replay` or `on`. Anything
  else is `off`.
- `lib/replay.ts` holds the recorded runs (imported from the snapshot), the rule that picks one
  per template, the 20-order limit and the reason sentences.
- The store keeps one pipeline. In replay mode only the source of content changes: a recorded
  draft where it would ask a director, a recorded verdict where it would ask a juror, the
  recorded files where it would render. Events, statuses, ranking and pacing are the same code
  as the live path. The store also skips loading and saving, never settles on chain, never
  starts the watcher, and refuses the actions that would need a client.
- The routes: `orders`, `greenlight` and `review` are open in replay, each with one body rule
  (template only, jury pick only, approve only). The other six stay closed.
- Tests first, in `tests/replay.test.ts` and as a new tier in the enumerating permission test.
  Delays are tested with fake timers, so there is no speed knob in production code.

### Risks

| Risk | Handling |
|---|---|
| A code path reaches a client in replay mode | Every client throws in the replay tests, the call counters must stay at zero, and the store refuses at its own level too |
| Replayed content drifts from the recording | The tests compare drafts, duels, ranking and media with the snapshot, and check that every recorded file exists |
| A public page is flooded with orders | 20 orders in memory, a dropped order stops its own timers, events are already capped at 300 |
| Two machines would mean two memories | README and `fly.toml` say the app must run as a single machine |
| The Next.js upgrade breaks the UI, which has no tests | Build and suite must pass, and the replay flow is walked through in the running app |
| `fly.toml` cannot be validated without deploying | Checked against the Fly.io reference, kept minimal, marked as not deployed |

### Not done

No UI change. No rate limit beyond the 20-order window. No override, revision, custom brief or
upload in replay. No deployment.
