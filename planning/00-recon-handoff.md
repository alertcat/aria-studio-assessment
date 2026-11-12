# Recon handoff: assessment scope for Aria Studio

Written by a prior agent session (Claude Code, 2026-11-12) that read the assessment brief and
reviewed this codebase. That session's raw log is not part of the submission because it also
covered unrelated private work. This file is its output and the starting context for the build
session.

## The brief in short

- Build or improve a small project with a coding agent. Reusing an older project is allowed if
  meaningful new work happens inside the window and the change is easy to see.
- Two days to submit. Two to three focused hours is acceptable. Weekend-scale effort is not wanted.
- Deliverables: public repo, short demo video, exported agent session logs, a `planning/` folder,
  a README with what was built, how to run it, and the trade-offs.
- Judged on: use of coding agents, clarity of planning and handoff artifacts, whether it works and
  is quick to understand, simple and secure technical choices, sensible trade-offs, and an honest
  account of where the AI helped, where it failed, and how that was corrected.
- The full brief is `planning/assessment-brief.pdf`. It is the company's document, so it stays
  out of git.

## What this repo is

Aria Studio is an agent pipeline with two human gates: three director agents pitch, a jury ranks
them with pairwise duels and Bradley-Terry, a human greenlights the spend, the render runs, and a
human accepts before settlement.

It is existing work, built from July to October 2026 with Claude Code: a first version at a
one-day hackathon, then a pilot edition with per-customer login. It placed 5th in the BUIDL QUESTS
2026 finals. It is imported here as a single commit, tagged `baseline`. Provider names and
deployment details were replaced with generic, environment-driven settings before the import.
Everything after the tag is assessment work.

## Baseline structure

- Next.js 16 app. Orchestration lives in `lib/store.ts` (about 1,000 lines). Ranking is in `lib/bt.ts`.
  Gate 1 is `POST /api/greenlight`. Gate 2 is `POST /api/review` with `approve` or `revise`.
- Two modes. Pilot mode (`ARIA_MODE=pilot`) requires a signed tenant cookie and the customer's
  own key for spending routes. Demo mode treats every request as the default tenant and spends
  with the server's key.
- Order statuses: `inbox`, `concepting`, `jury`, `greenlight`, `producing`, `review`, `revising`,
  `delivered`.
- A read-only showcase switch exists (`NEXT_PUBLIC_READONLY=1`, frozen data in
  `public/demo-state.json`), so the product can be viewed without any key.
- No tests, no test script, no CI.

## The incident that motivates the work (2026-10-14)

An unknown visitor used the public demo deployment to trigger paid generations with the server's
key and removed demo orders through the open prune route. It was contained the same day by
configuration only: spending secrets were removed from the host and the deployment was switched
to pilot mode. The code path is unchanged. A demo-mode deployment that holds a server key is
still open to anyone.

## Hypotheses (unverified: write the failing test first)

- **H0. Demo mode has no write protection.** In demo mode `tenantFromRequest()` returns the default
  tenant for every caller and `spendKey()` returns no key, so the server key applies. Every
  mutating route (`orders`, `greenlight`, `review`, `prune`, `reset`, `playbook`, `talent/upload`)
  is then reachable anonymously. This is the root cause of the incident above.
- **H1. Revision ignores order state.** `runRevision()` checks only that the order exists and has a
  winner. The review route does not check status, and `activeCount()` excludes the order itself.
  If true, a `delivered` order can be sent back, re-rendered and approved again, giving a second
  invoice, revenue counted twice and a second settlement. A `producing` order could also start a
  second concurrent render.
- **H2. Revenue is booked before settlement resolves.** `approveOrder()` marks the order delivered
  and adds revenue immediately. If the transfer then fails, the invoice keeps a "simulated
  settlement" reference. There is no explicit settlement status.

## Proposed scope (time-box: 2.5 to 3.5 hours)

1. **Close the incident in code.** Demo mode becomes read-only for anonymous callers unless an
   admin token is configured. Add one table-driven test that walks every mutating route in both
   modes and asserts anonymous callers are refused.
2. **Gate guards.** One transition table and a single `canApply(status, action)` check. Tests:
   no render before greenlight, no settlement before acceptance, a delivered order accepts no
   further action, repeated greenlight or approve takes effect once. Fix what fails. Expect H1.
3. **Decide H2 explicitly**, even if the decision is "document it as the weakest part".
4. **README, top section:** what changed in the assessment window, how to verify in 60 seconds
   without any key (`npm test`, then the read-only showcase), trade-offs, where the agent helped
   and where it was wrong.

Cut first if time runs short: CI workflow, Bradley-Terry property tests.

## Explicitly out of scope

- A live evaluation of jury position bias (needs paid model calls). Listed as the next step.
- UI changes, refactoring the rest of `store.ts`, multi-shot renders, a public deployment.

## Process rules for the build session

- `planning/` holds this file, the plan, the task list with an acceptance check per task, a
  decisions log, and a log of agent mistakes written at the moment they are caught.
- Work on a branch from the `baseline` tag and open a pull request so the diff is one click away.
- A fix lands only together with a test that failed before it.
- No secrets in the repo, the logs or the recording. Redact exported logs before committing them.

## Hygiene step already done

Before any agent acted on the assessment PDF, it was checked for hidden instructions: text layer
compared with OCR of the rendered pages, invisible-text and Unicode audit, annotations,
attachments and metadata. Nothing was found.
