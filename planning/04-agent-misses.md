# Agent misses

Written at the moment each one is caught. "Prior agent" is the recon session that wrote the
handoff. "Build agent" is this session.

## M-01. The handoff's list of mutating routes was incomplete (prior agent)

- Claimed (`00-recon-handoff.md`, H0): seven mutating routes, `orders`, `greenlight`, `review`,
  `prune`, `reset`, `playbook`, `talent/upload`.
- Actual: nine. `POST /api/resume` (`app/api/resume/route.ts:9-17`) and `POST /api/talent`
  (`app/api/talent/route.ts:13-19`) were missing. Both act with the server key in demo mode.
- Caught by: reading every `app/api/**/route.ts` instead of trusting the list. Confirmed by the
  probe: both answered 200 to an anonymous caller.
- Correction: all nine are guarded. The permission test enumerates handlers from the
  filesystem, so there is no list left to go stale.

## M-02. The handoff scoped H1 to `revise` and missed `resumeRender` (prior agent)

- Claimed (`00-recon-handoff.md`, H1): `runRevision()` ignores order state.
- Actual: `resumeRender()` (`lib/store.ts:771-775`) has the same defect. It sets `review`
  (`:785`) or `greenlight` (`:795`) whatever the order's status was. The probe moved a delivered
  order back to `greenlight` with it.
- Caught by: tracing every status assignment in `lib/store.ts`, not only the function the
  handoff named.
- Correction: `resume` is part of the transition table (decision D-11).

## M-03. Assumed `vitest.config.ts` would load (build agent)

- What happened: the first probe run died at startup with `ERR_REQUIRE_ESM` on Node 20.18.0.
- Why: the package is CommonJS, so the config is loaded with `require`, and Vitest's CommonJS
  entry requires an ESM-only dependency.
- Caught by: running it in a scratch directory before planning around it.
- Correction: `vitest.config.mts` (decision D-06).

## M-04. Assumed `vi.restoreAllMocks()` gives every test fresh mocks (build agent)

- What happened: a probe test asserted one render call and saw three. A later test inherited a
  failing render implementation from the test before it.
- Why: the mocked modules are shared across tests in a file. Their call history and their
  per-test implementations survive `restoreAllMocks()`.
- Caught by: the failing assertion, and a stray "render failed" line in a test that never asked
  for a failure.
- Correction: reset mocks in `beforeEach`, with a harness self-test that proves it.

## M-05. Used a template-string dynamic import for the route modules (build agent)

- What happened: Vite warned about an invalid dynamic import. It still resolved.
- First correction: a static map of importers checked against the filesystem. That was itself
  a hand-written list and was dropped (see M-08).
- Final correction: a plain variable specifier marked `@vite-ignore`, built from the files found
  on disk.

## M-06. First planned a 403 for the read-only refusal (build agent)

- What happened: reading the studio UI showed that every 403 is rendered as "This key does not
  match the current session".
- Caught by: reading the caller before fixing the status code.
- Correction: 405 with an `Allow` header (decision D-07).

## M-07. Expected to need a Vite version override (build agent)

- What happened: I expected npm to pull a Vite release that needs Node 20.19 and planned an
  `overrides` entry. The probe showed npm picks Vite 6.4.6 on Node 20.18 without help.
- Correction: no override. One less line of configuration to explain.

## M-08. Planned a hand-written table of guarded routes (build agent)

- What happened: my plan had the permission test check each discovered handler against a
  "guarded table" kept by hand, right after I had recorded in M-01 that a hand-written list is
  what failed in the handoff.
- Caught by: the owner, at plan approval.
- Correction: the test enumerates write handlers from the filesystem and tests all of them.
  Only exemptions are listed, with reasons (decision D-09).

## M-09. Put the reason into a notice line that demo mode never renders (build agent)

- What happened: the one allowed UI change set the studio's `notice` state on a 405. The
  `notice` element is only rendered in the pilot branch of the header, and a 405 only happens in
  demo mode. So the reason was stored and never shown.
- Why: I read `post()` and the line that renders the notice, and did not read the conditional
  around that line.
- Caught by: the live check (T5). The unit tests could not catch it: there is no UI test, and
  the route answered 405 correctly. In the running app the click was refused and the header
  stayed empty.
- Correction: one more line renders the same notice in the demo branch of the header. Checked
  again in the running app: the sentence appears after a refused click.
- Lesson: a change is not verified until it has been seen working where the user sees it.

## M-10. Was about to pin GitHub Actions versions from memory (build agent)

- What happened: I was going to write `actions/checkout@v4` and `actions/setup-node@v4`. A
  lookup of the latest releases showed both are at v7.
- Caught by: checking before writing, because the workflow cannot be run before the owner
  pushes.
- Correction: the workflow uses `@v7` for both, and no dependency cache, so there is less to
  go wrong on the first run.

## M-11. Stated elapsed time without a clock (build agent)

- What happened: the plan said recon and planning "took about 45 minutes", and the README first
  said the session took "about three hours". Both were guesses. The transcript shows 17 minutes
  for phase 1, and the task estimates of 15 to 35 minutes turned into 1 to 6 minutes each.
- Caught by: the timestamps in the session transcript, while exporting the log.
- Correction: a dated correction in the plan, an "Actual" column in the task list taken from
  commit times, and a README that states the measured duration.
- Lesson: a number in a report needs a source. Three hours was the owner's time box, not a
  measurement.

## M-12. The first log export redacted part of a URL (build agent)

- What happened: the rule for absolute paths matched the `p:/` in `http://localhost`, so the
  log showed `htt<path>`.
- Caught by: reading the generated log before committing it.
- Correction: a drive letter only counts when no letter comes directly before it.

## M-13. The UI check script trusted two loose text matches (build agent)

- What happened: while walking the replay demo in the browser, the script waited for a button
  containing "Greenlight" and found the status chip of an order in the queue instead, so it
  ran ahead and failed. It then took the first invoice number on the page as proof that
  "Accept and settle" had worked, although that number belonged to an older order.
- Caught by: the script crashing on the next step, and by reading the server state afterwards
  instead of trusting the page text.
- Correction: exact button labels, the order selected explicitly, and the result confirmed
  from `/api/state`: the second order was delivered with its own invoice.

## M-14. Kept packing document edits into long shell commands (build agent)

- What happened: twice a shell command that edited several planning files at once broke on
  quoting. The first one (M-11 time) wrote one file and then stopped. The second one failed to
  parse, so nothing ran.
- Caught by: the error, and by checking afterwards which files had really changed instead of
  assuming all or nothing.
- Correction: documents are edited with the file tools. Shell commands are for running things.
