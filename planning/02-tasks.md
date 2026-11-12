# Tasks

Status values: `todo`, `doing`, `done`, `cut`. Every acceptance command runs from the repo root
in PowerShell or Git Bash. After each task the full suite (`npm test`) and `npm run build` are
run, and this file is updated.

Phase 1 (done before this file): hypotheses verified, plan written. No code changed.

| ID | Task | Estimate | Status |
|---|---|---|---|
| T0 | Branch and repo hygiene | 5 min | done |
| T1 | Test harness | 15 min | todo |
| T2 | H0: read-only demo | 25 min | todo |
| T3 | H1: gate guards | 35 min | todo |
| T4 | H2: pin the gap | 5 min | todo |
| T5 | Check the real server | 5 min | todo |
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

## T4. H2: pin the gap

- `tests/settlement-gap.test.ts`: one `it.fails` test for "no revenue when the transfer fails".

Acceptance:

```bash
npx vitest run tests/settlement-gap.test.ts
```

Expected: 1 test passes (an expected failure). It will fail once H2 is fixed.

## T5. Check the real server

- Start the app in default demo mode on a spare port and send one refused write.

Acceptance, with `npm run dev` running in another terminal:

```bash
node -e "fetch('http://localhost:3000/api/reset',{method:'POST'}).then(async r=>console.log(r.status, await r.text()))"
```

Expected: `405` and a JSON body that says the demo is read-only.

Then open http://localhost:3000/studio and click any template brief. Expected: the notice line
shows the same reason sentence.

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
