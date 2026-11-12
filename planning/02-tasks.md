# Tasks

Status values: `todo`, `doing`, `done`, `cut`. Every acceptance command runs from the repo root
in PowerShell or Git Bash. After each task the full suite (`npm test`) and `npm run build` are
run, and this file is updated.

Phase 1 (done before this file): hypotheses verified, plan written. No code changed.

| ID | Task | Estimate | Actual | Status |
|---|---|---|---|---|
| T0 | Branch and repo hygiene | 5 min | 6 min | done |
| T1 | Test harness | 15 min | 4 min | done |
| T2 | H0: read-only demo | 25 min | 4 min | done |
| T3 | H1: gate guards | 35 min | 5 min | done |
| T4 | H2: pin the gap | 5 min | 1 min | done |
| T5 | Check the real server | 5 min | 3 min | done |
| T6 | CI workflow (optional) | 5 min | 1 min | done, not yet run on GitHub |
| T7 | README top section | 15 min | 3 min | done |
| T8 | Session logs | 20 min | 10 min | done |
| T9 | Final verification | 5 min | 2 min | done |

"Actual" is agent wall-clock time, taken from the commit times. The estimates were guesses made
without a clock and were far too high (miss M-11). Phase 1 took 17 minutes (15:10 to 15:27) and
the plan was approved at 15:34.

## T0. Branch and repo hygiene

- Create `assessment/gate-harness` from `baseline`.
- Add the brief PDF to `.gitignore` (it is already in the local exclude file).
- Commit the planning files.

Acceptance:

```bash
git branch --show-current
```

Expected: `assessment/gate-harness`.

```bash
git check-ignore -v planning/assessment-brief.pdf
```

Expected: one line naming the ignore rule.

```bash
git ls-files planning
```

Expected: the markdown files only, no PDF.

## T1. Test harness

- Add `vitest@4.1.12`, the `test` script, `vitest.config.mts`, `tests/setup.ts`,
  `tests/harness.ts`.
- `tests/harness.test.ts` proves the sandbox: no network, temp working directory, clean mocks.

Acceptance:

```bash
npx vitest run tests/harness.test.ts
```

Expected: all tests pass, in under 5 seconds.

```bash
git diff baseline..HEAD --stat -- package.json
```

Expected: one new devDependency (`vitest`) and one new script (`test`).

Result: done. 8 self-tests pass in about 1 second. `npm run build` passes and type-checks the
test files. The lockfile gained 85 packages, removed none, and changed one existing version
(`@types/estree` 1.0.9 to 1.0.10, required by the new Rollup). `npm audit` reports the same 8
findings before and after (decision D-17). A run leaves no temp directory behind.

## T2. H0: read-only demo

- Red first: `tests/demo-readonly.test.ts` fails at baseline. It enumerates every write handler
  under `app` from the filesystem. Only the exemptions are listed by hand, each with a reason.
  Output kept in `planning/evidence/T2-red.txt`.
- Green: `readOnlyDemo()` in `lib/ctx.ts`, called first in the nine mutating handlers. It
  answers 405 with an `Allow` header and one reason sentence. `ARIA_DEMO_WRITES` documented in
  `.env.example`.
- The one UI exception: the studio's `post()` shows that reason in the notice line.

Acceptance:

```bash
npx vitest run tests/demo-readonly.test.ts
```

Expected: all tests pass. The test names list every discovered write handler in both modes,
and the two exemptions with their reasons.

```bash
git log --oneline baseline..HEAD
```

Expected: a `test(red):` commit for H0 directly before its `fix:` commit.

Result: done. Red run: 17 failed, 31 passed (`planning/evidence/T2-red.txt`). The test found
nine write handlers and the two exemptions on its own. After the fix: 48 passed, full suite 56
passed, build passes. Extra check: a temporary route with an unguarded `DELETE` was added and
the unchanged test failed on it (`planning/evidence/T2-new-route-is-caught.txt`). The probe
route was deleted and never committed.

## T3. H1: gate guards

- Red first: `tests/gates.test.ts` fails at baseline for revise on a delivered order, revise
  while producing, resume on a delivered order, and the route status codes. Output kept in
  `planning/evidence/T3-red.txt`.
- Green: `lib/gates.ts` with the transition table and `canApply`; guards in `greenlightOrder`,
  `approveOrder`, `runRevision`, `resumeRender`; routes answer 404 or 409.

Acceptance:

```bash
npx vitest run tests/gates.test.ts
```

Expected: all tests pass, including "a delivered order accepts no further action".

Result: done. Red run: 31 failed, 27 passed (`planning/evidence/T3-red.txt`). The 27 that passed
pin behaviour that was already right. After the fix: 58 passed, full suite 114 passed, build
passes. `lib/store.ts` changed by 22 lines, all checks. Extra check: with `revise` wrongly allowed
from `delivered` in the table, three tests fail (the table cell, the story, the route). The
change was reverted.

Difference from the plan: the table is tested through the store and the routes, not with a
separate unit test of `canApply`. That kept the red test compiling against the old code, so the
build stayed green on the red commit.

## T4. H2: pin the gap

- `tests/settlement-gap.test.ts`: one `it.fails` test for "no revenue when the transfer fails".

Acceptance:

```bash
npx vitest run tests/settlement-gap.test.ts
```

Expected: 1 test passes (an expected failure). It will fail once H2 is fixed.

Result: done. "1 passed, 1 expected fail". A plain test over the same setup sits next to the
expected failure, so it cannot pass because its setup broke.

## T5. Check the real server

- Start the app in default demo mode on a spare port and send one refused write.

Acceptance, with `npm run dev` running in another terminal:

```bash
node -e "fetch('http://localhost:3000/api/reset',{method:'POST'}).then(async r=>console.log(r.status, await r.text()))"
```

Expected: `405` and a JSON body that says the demo is read-only.

Then open http://localhost:3000/studio and click any template brief. Expected: the notice line
shows the same reason sentence.

Result: done, against `next dev` in default demo mode on a spare port. `POST /api/reset`,
`/api/prune` and `/api/orders` answered 405 with an empty `Allow` header and the reason.
`POST /api/talent` answered 405 with `Allow: GET`. `GET /api/talent` answered 200 and
`POST /api/login` answered 200 (exempt). No `data/` directory was created.

The UI part failed on the first try: the click was refused, but nothing was shown, because the
notice line only existed in the pilot header (miss M-09). After a one-line fix the studio shows
"Demo mode is read-only: writes need ARIA_DEMO_WRITES=1 on the server." and creates no order.
The dev server rewrites `next-env.d.ts`. That file was restored afterwards.

## T6. CI workflow (optional, first to be cut)

- `.github/workflows/ci.yml`: install, test, build on push and pull request.

Acceptance: the workflow runs the same two commands as below, and turns green after the owner
pushes.

Result: written, not yet run on GitHub (nothing is pushed). Rehearsed locally instead: a clean
`git archive` export of the branch, then `npm ci` (48 s), `npm test` (5 s, 115 passed and 1
expected fail) and `npm run build` (15 s). That proves the committed tree is complete and the
lockfile is in step. It does not prove Linux: Docker was not running, so the suite has only
run on Windows. The action versions were looked up, not remembered (miss M-10).

```bash
npm test
```

```bash
npm run build
```

## T7. README top section

- New first section: what changed in the assessment window, how to verify in 60 seconds with no
  key, trade-offs, where the agent helped and where it was wrong, the weakest part and the next
  step.

Acceptance:

```bash
git diff baseline..HEAD --stat -- README.md
```

Expected: README.md changed. The new section is the first one after the title.

Result: done. The older sections that the change made stale were corrected too: the run
instructions, the layout table and the list of baseline gaps.

## T8. Session logs

- `logs/session-01.zh.md` (original), `logs/session-01.en.md` (translation), `logs/README.md`.
- Redacted: e-mail addresses, the Windows user name, absolute paths, anything that looks like a
  key.

Acceptance:

```bash
git ls-files logs
```

Expected: the three files.

```bash
git grep -n -I -E "Users[\\/]|AppData|sk-[A-Za-z0-9]{20,}|0x[a-fA-F0-9]{64}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}" -- logs
```

Expected: no output.

Result: done. A script read the local transcript and wrote the Chinese original. The English
file comes from the same entries plus one hand-written translation per Chinese text. Both files
have the same entries in the same order and identical tool-call lines. The redaction check
above prints nothing. The first export redacted part of a URL (miss M-12), which was fixed
before the commit. The export also showed that my time estimates were wrong (miss M-11).

The log stops where the export ran. It does not contain the commit of the log files, the final
verification below, or the closing summary.

## T9. Final verification

Acceptance:

```bash
npm test
```

```bash
npm run build
```

```bash
git log --oneline baseline..HEAD
```

```bash
git status --short
```

Expected: tests pass, build passes, small commits in order, clean tree, nothing pushed.

Result: done at commit b4a6c24. `npm test`: 4 files, 115 passed and 1 expected failure, in 3
seconds. `npm run build`: passes. The tree is clean. The brief PDF, `data/` and `.env.local` are
not tracked, and `next-env.d.ts` is unchanged from the baseline. A scan of all 36 changed files
(the lockfile aside) for the Windows user name, e-mail addresses, absolute paths and key-like
strings found nothing. Nothing was pushed: the repository has no remote.

This entry was committed afterwards as a documentation-only change, and the suite and the
build were run once more on that final commit.

# Second task: keyless replay demo

Added 2026-11-12 at 16:58. Same conventions as above.

| ID | Task | Status |
|---|---|---|
| T10 | Upgrade dependencies | done |
| T11 | Replay mode, red then green | done |
| T12 | Walk the replay in the running app | done |
| T13 | Minimal `fly.toml` | done, not deployed |
| T14 | README and planning files | todo |
| T15 | Extend the session logs | todo |
| T16 | Final verification | todo |

## T10. Upgrade dependencies

- `next` to 16.4.6, then `npm audit fix` without `--force`. Full suite and build.

Acceptance:

```bash
npm ls next
```

Expected: `next@16.4.6`.

```bash
npm audit
```

Expected: one advisory left, in `zod`, whose fix is a major-version upgrade.

Result: done. Before: 8 advisories (1 critical, 6 high, 1 moderate). After the `next` upgrade:
4. After `npm audit fix`: 1, in `zod` (decision D-20). The lockfile changed 47 package versions,
added 2 and removed 1. Full suite: 115 passed and 1 expected failure. Build passes on Next.js
16.4.6.

## T11. Replay mode, red then green

- Red first: `tests/replay.test.ts` and a replay tier in `tests/demo-readonly.test.ts`. Output
  kept in `planning/evidence/T11-red.txt`.
- Green: `demoWrites()`, `lib/replay.ts`, the content switch in the store, the body rules in
  three routes.

Acceptance:

```bash
npx vitest run tests/replay.test.ts
```

Expected: all tests pass. They include a full walk through both gates with every external
client set to throw, the 20-order limit, and an empty data directory at the end.

```bash
npx vitest run tests/demo-readonly.test.ts
```

Expected: every discovered write handler has a replay case. Three are open, the rest answer
405 with the replay reason.

Result: done. Red run: 24 failed, 58 passed in the two files (`planning/evidence/T11-red.txt`).
The first failure was that reading the state starts the escrow watcher. After the change: 82
passed, full suite 149 passed and 1 expected failure, build passes. Five one-line mutations of
replay mode were each caught by the tests (`planning/evidence/T11-mutation-checks.txt`).

## T12. Walk the replay in the running app

Acceptance, in PowerShell:

```powershell
$env:ARIA_DEMO_WRITES='replay'; npm run dev
```

Then open http://localhost:3000/studio. Expected: three template briefs. Firing one shows the
recorded concepts and jury, the first greenlight button plays the recorded render, and
"Accept and settle" delivers the order. "Send back", a custom brief and the playbook each show
a sentence that starts with "Replay demo:".

Result: done against the production build (`next start`) with `ARIA_DEMO_WRITES=replay` and no
other variable. Through the API: three templates offered, the gate after 7.6 seconds, the
review after 4.8, the recorded video and poster served as static files, acceptance with a
simulated settlement, and a 405 with the right sentence for an override, a revision, a custom
brief and all six closed routes. Through the studio page: three template buttons, the recorded
cut plays, "Override and fund" and "Send back" show their reasons in the header, "Accept and
settle" delivers. No `data/` directory was created. The server process used about 90 MB.

The first version of the browser script was wrong twice (miss M-13).

## T13. Minimal fly.toml

Acceptance:

```bash
git grep -n -E "ARIA_DEMO_WRITES|auto_stop_machines|min_machines_running|memory" -- fly.toml
```

Expected: the replay variable, stop when idle, zero machines kept running, the smallest
memory size. No secret and no volume in the file. Nothing deployed.

Result: written, parsed as TOML, checked against the Fly.io configuration reference. Not
deployed and no Fly command was run, so it is unproven (decision D-27). `.dockerignore` now
keeps `planning` and `logs` out of the image.

## T14. README and planning files

Acceptance:

```bash
git grep -n "Public demo" -- README.md
```

Expected: a section that says what the public demo can and cannot do.

## T15. Extend the session logs

Acceptance: the two commands of T8, run again.

## T16. Final verification

Acceptance: the four commands of T9, run again.
