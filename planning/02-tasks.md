# Tasks

Status values: `todo`, `doing`, `done`, `cut`. Every acceptance command runs from the repo root
in PowerShell or Git Bash. After each task the full suite (`npm test`) and `npm run build` are
run, and this file is updated.

Phase 1 (done before this file): hypotheses verified, plan written. No code changed.

| ID | Task | Estimate | Status |
|---|---|---|---|
| T0 | Branch and repo hygiene | 5 min | done |
| T1 | Test harness | 15 min | done |
| T2 | H0: read-only demo | 25 min | done |
| T3 | H1: gate guards | 35 min | done |
| T4 | H2: pin the gap | 5 min | done |
| T5 | Check the real server | 5 min | done |
| T6 | CI workflow (optional) | 5 min | todo |
| T7 | README top section | 15 min | todo |
| T8 | Session logs | 20 min | todo |
| T9 | Final verification | 5 min | todo |

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
