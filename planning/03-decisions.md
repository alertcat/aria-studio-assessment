# Decisions

One entry per trade-off, written when it is made. "Owner" means the human decided it.
"Agent" means the coding agent decided it and the owner can overrule it.

## D-01. Demo mode is read-only by default (owner)

Writes in demo mode need an explicit environment variable. Pilot mode is unchanged. No UI change.
Rejected: the handoff's admin token. A token gives per-caller control but needs a place to enter
it, which means UI work. Cost of the choice: the switch is deployment-wide, so turning it on
exposes writes to every caller.

## D-02. Illegal order actions are refused (owner)

Order status is checked before every gate action. Rejected: silently ignoring the call, which is
what the baseline does where it checks at all.

## D-03. H2 is documented, not fixed (owner)

Revenue is still booked before settlement resolves. It is named in the README as the weakest
part, with the next step. Reason: a correct fix changes the invoice shape and the books, which
does not fit the time box.

## D-04. Scope limits (owner)

No lint fix, no refactor of the rest of `store.ts`, no deployment. Vitest is the only new
dependency. Every external call is mocked.

## D-05. Vitest 4.1.12, not the latest 5.1.0 (agent)

Vitest 5 needs Node 22.12 or newer. The local Node is 20.18.0 and Next 16 itself supports Node
20. Version 4.1.12 is the newest release of the maintained 4.x line and runs on Node 20, 22 and
24. On Node 20.18 npm resolves its Vite dependency to 6.4.6, which the lockfile then pins for
everyone. Rejected: asking the owner to upgrade Node for a test runner.

## D-06. The config file is `vitest.config.mts` (agent)

A `.ts` config is loaded as CommonJS in this package and fails on Node 20.18 with
`ERR_REQUIRE_ESM`. The `.mts` extension forces ESM. Rejected: adding `"type": "module"` to
`package.json`, which would change how every other file in the app is loaded.

## D-07. The read-only refusal is HTTP 405 with an `Allow` header, not 403 (agent, confirmed by owner)

The API already uses 403 for "key does not match this session" (`lib/ctx.ts:25`), and the studio
UI shows that message for every 403 (`app/studio/page.tsx:337-338`). A 403 would tell a demo
visitor something false. 405 is also the more exact answer: the method is disabled by
configuration and no credential would change that (RFC 9110, 15.5.6 and 10.2.1). The owner
confirmed it and added: the response carries an `Allow` header and one clear reason sentence.
Cost: 405 is less common for this purpose.

## D-08. The switch is `ARIA_DEMO_WRITES=1` (agent)

Only the exact value `1` enables writes, so a typo fails closed. The name follows the existing
`ARIA_MODE` and `ARIA_COOKIE_SECRET`. It is read on each call, not at import. The first time it
takes effect the server logs one warning.

## D-09. An explicit guard line per route plus an enumerating test, not middleware (agent, test design by owner)

Each mutating handler starts with the same guard call. The permission test enumerates every
route under `app` that exports a write method and tests each one. Nobody maintains a list of
guarded routes. Only the exemptions are written down, each with a reason that the test checks.
The owner required this after the plan review: the handoff's hand-written list had already
missed two routes, and my first plan repeated the pattern with a "guarded table" (miss M-08).
Rejected: a Next.js middleware/proxy file. It would be central, but it is harder to unit-test,
ties the fix to a framework file convention, and does not exist in a static export build.

## D-10. One transition table, enforced in the store and reported by the routes (agent)

`lib/gates.ts` holds the table. The store functions refuse illegal calls, so any future caller is
covered. Their signatures did not change. The store got one new method, `gate()`, and the three
gate routes call it before any provider call to answer 404 or 409. Before, an illegal call was
answered with `{ ok: true }`.

Known limit: in pilot mode the route awaits a balance lookup between its check and the store
call. Two requests that race across that lookup both pass the route check. The store then
accepts one and silently ignores the other, exactly as the baseline did. No double render, but
the loser is told `{ ok: true }`. Rejected: a second route check after the lookup, which adds
lines to fix a response nobody acts on.

## D-11. `resume` joins the table (agent)

Not in the handoff. Verification showed `resumeRender()` has the same missing status check as
`runRevision()` and can move a delivered order back to an earlier status. It is legal from
`producing` and `review` only, and refused while a render is in flight. The in-flight
precondition is the second item on the cut list.

## D-12. H2 is pinned with an expected-failure test (agent)

`it.fails` states the wanted behaviour. It passes today and fails as soon as H2 is fixed, which
forces whoever fixes it to update the test. Rejected: a test that asserts the wrong behaviour as
if it were correct.

## D-13. Red tests are committed separately (agent)

Each fix is preceded by a `test(red):` commit and its captured output under
`planning/evidence/`. Those commits fail on purpose. Every `fix:` commit is green.

## D-14. The brief PDF is ignored twice (agent)

It is already in `.git/info/exclude`, which is local to this clone. A `.gitignore` entry makes
the rule travel with the repo. Files are staged by explicit path, never with `git add -A`.

## D-15. Hypotheses were verified by execution before planning (agent)

A throwaway probe ran the baseline source from a scratch directory outside the repo. It cost
about ten minutes and found two tooling problems (D-05, D-06) before they could interrupt the
build phase.

## D-16. One UI exception: the studio shows the reason for a 405 (owner)

"No UI change" has exactly one exception, allowed by the owner at plan approval: a very small
branch in the studio's `post()` that puts the server's reason sentence into the existing notice
line. Without it a refused click does nothing visible. The live check showed that this notice
line was only rendered in pilot mode, so the change is two small edits in
`app/studio/page.tsx`: the branch in `post()` and one line that renders the notice in the demo
header too (miss M-09). Kept out on purpose: hiding or disabling
the write controls, a notice line for the landing page, and a Chinese translation of the
sentence (the translation helper falls back to the English text).

## D-17. Baseline dependency advisories are reported, not fixed (agent)

`npm audit` lists 8 packages with advisories in the baseline tree, among them `next` 16.2.4
(critical, fixed in 16.4.6) and `postcss`, `zod`, `sharp`. Adding Vitest changed nothing: the
report is identical before and after. Upgrading Next.js is the right fix, but it changes the
framework under an app with no UI tests, and the owner limited this window to one new
dependency. It is listed in the README as a next step.

## D-18. Test fixtures are derived, not listed (agent)

Following the owner's rule for the route list: the set of environment variables that tests
remove comes from `.env.example`, and the pilot session in tests is built with the app's own
cookie and tenant functions. Nothing in the harness has to be kept in step by hand.
