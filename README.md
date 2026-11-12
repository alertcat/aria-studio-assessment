# Aria Studio

A one-person media studio run by AI agents, with a human gate on every dollar.

**Live demo for reviewers: https://aria-studio-demo.fly.dev** (a replay of recorded runs, no
key needed, see "Public demo" below).

## Assessment window: what changed

Everything after the `baseline` tag was done on 2026-11-12 in one session with Claude Code as
the coding agent, in two parts. The first part (items 1 to 5 below) had a three-hour time box
and took a little over one hour. The second part (items 6 and 7) was a follow-up request the
same afternoon and took under an hour. The log has the timestamps. A third, short part
published the repository and deployed the demo. The project itself is older (see "Status of
this repository" below). The whole change is `git diff baseline..HEAD`. The working notes are
in [`planning/`](planning/) and the agent session log is in [`logs/`](logs/).

### What changed

1. **Demo mode is read-only by default.** Demo mode has no login, so every caller is the
   default tenant and renders run on the server's key. On 2026-10-14 an unknown visitor used
   exactly that on a public demo deployment. Now each of the nine write routes starts with
   `readOnlyDemo()` ([`lib/ctx.ts`](lib/ctx.ts)) and answers `405` with an `Allow` header and a
   reason, before any state is touched. Writes need `ARIA_DEMO_WRITES=1`. Pilot mode keeps its
   own login and behaves as before.
2. **Order gates refuse illegal actions.** [`lib/gates.ts`](lib/gates.ts) holds one table: which
   of the four human-triggered actions (`greenlight`, `approve`, `revise`, `resume`) is legal
   from which order status. The store enforces it and the routes answer `404` or `409`. Before,
   a delivered order could be sent back, approved again and booked twice, and an order that was
   still rendering could start a second render, which in pilot mode is a second charge on the
   customer's key.
3. **A test suite where there was none.** 157 tests in a few seconds, with no network, no
   key and no real data directory ([`tests/setup.ts`](tests/setup.ts)). The permission test
   keeps no list of routes. It walks `app/`, imports every route file and tests every write
   method it exports, so a route added later is covered the day it is added.
4. **Two small UI changes in the studio.** It shows why a write was refused. And it starts
   dark and in English on every first visit: it used to follow the system colour scheme, so
   the first look at the live demo was a light page.
5. **A CI workflow** that runs install, test and build. It runs on every push and pull
   request.
6. **A public demo that needs no key.** `ARIA_DEMO_WRITES=replay` opens three writes: a
   template brief, greenlight and acceptance. It replays runs that were recorded earlier and
   are part of the repository. No external client is called, and the tests prove it by making
   every client throw ([`tests/replay.test.ts`](tests/replay.test.ts)). Details in the next
   section.
7. **Dependencies.** `next` 16.2.4 to 16.4.6, then `npm audit fix`. Advisories went from 8,
   one of them critical, to 1.

### Public demo: what it can and cannot do

`ARIA_DEMO_WRITES=replay` sits between read-only and full writes. It is meant for a public page
on a host that holds no key. That page is live:

- Reviewers, start here, on the site: https://aria-studio-demo.fly.dev
- The control room behind it: https://aria-studio-demo.fly.dev/studio

[`fly.toml`](fly.toml) is the configuration of that host: one 256 MB machine in Singapore
with no secret and no volume. It stops when idle, so the first request after a pause takes a
few seconds.

What a visitor can do, on the site or in the studio:

- Fire one of three template briefs: Kopi Loco, Visit Palawan, SlateLab.
- Watch three directors pitch and the jury rank them. That takes about 4 to 10 seconds.
- Greenlight the jury's pick and watch the render progress for about 5 seconds.
- Watch the cut, look at the poster, and accept. The order is delivered with a simulated
  settlement.

What it is: a replay. The concepts, the verdicts, the video and the poster come from
`public/demo-state.json` and `public/media`. No model, render service or chain is called, and
the event log of each order says so. The code that paces, ranks, books and moves the order
through the two gates is the code the live pipeline runs.

What a visitor cannot do. Each of these requests is refused with a 405 and one sentence that
starts with "Replay demo:". The studio shows that sentence in its header. The site has no
notice line, so a refused click there does nothing visible:

- Write a custom brief. A template without a recorded run (Kaya & Co.) is not offered at all.
- Override the jury's pick. Only the recorded cut exists.
- Send a cut back for revision.
- Change the playbook, register a portrait, prune or reset.

The studio still shows the controls for model, resolution and duration at Gate 1. In replay
mode they have no effect: the recorded cut is shown as it was rendered.

What the host keeps: nothing on disk. Orders live in memory, the newest 20 at most. A machine
that stops when idle starts empty again. Orders live in one process, so the app has to run as
exactly one machine. The deployment was made with `fly deploy --ha=false` and is kept at
`fly scale count 1`.

What it does not prove: that the live pipeline works today. For that, run it with your own
keys (see "Run the live pipeline" below).

To try it locally, with no key, in Git Bash:

```bash
ARIA_DEMO_WRITES=replay npm run dev
```

In PowerShell:

```powershell
$env:ARIA_DEMO_WRITES='replay'; npm run dev
```

Then open http://localhost:3000.

### Verify in about a minute, no key needed

No `.env` file is needed for any of this.

```bash
npm install
```

```bash
npm test
```

Expected: `Test Files 6 passed (6)` and `Tests 156 passed | 1 expected fail (157)`. The expected
failure is the known gap described under "Weakest part" below.

Measured twice on a clean export of this branch (Node 20.18, Windows, warm npm cache): install
48 and 62 seconds, tests 5 seconds both times. `npm run build` takes another 15 to 21 seconds
and type-checks the tests.

To see the real server refuse a write, start it in its default mode:

```bash
npm run dev
```

Then, in a second terminal:

```bash
node -e "fetch('http://localhost:3000/api/reset',{method:'POST'}).then(async r=>console.log(r.status, await r.text()))"
```

Expected: `405 {"error":"read-only demo","reason":"Demo mode is read-only: writes need ARIA_DEMO_WRITES=1 on the server."}`.
Or open http://localhost:3000/studio and click a template brief: the same sentence appears in
the header and no order is created.

### Trade-offs

- **A switch, not an admin token.** `ARIA_DEMO_WRITES=1` is one line and needs no UI. The cost:
  it applies to the whole deployment. Turning it on for a public host that holds keys reopens
  the hole. The server logs a warning when it is on. Anything public should run in pilot mode.
- **405, not 403.** This API already uses 403 for "the key does not match the session", and the
  studio shows that message for every 403. The method is disabled by configuration, which is
  what 405 with an `Allow` header means.
- **A guard line in each route plus a test that finds routes, not middleware.** The guard is
  one visible line and easy to test. The test, not a convention, is what catches a route that
  forgets it.
- **No refactor of `lib/store.ts`.** The file is still one large module. The first part changed
  22 lines, all of them guards. The replay demo added about 110 more: one mode flag and the
  recorded source.
- **The public demo replays, it does not generate.** That is what makes it safe without a key,
  and honest about it. The cost: no override, no revision, no custom brief, and no proof that
  the models work.
- **One pipeline with two sources, not a second pipeline.** Replay takes a recorded answer
  where the live path calls a model. Events, ranking, booking and pacing are shared, so the
  demo cannot drift from the product.
- **Every replay refusal is a 405**, also when only the body is refused (a custom brief, an
  override, a revision). One status lets the studio show every reason through one branch. The
  cost: a 405 whose `Allow` header lists `POST`.
- **Memory only.** No file, no volume, 20 orders. The cost: one machine only, an empty studio
  after every stop, and totals that keep counting orders that have left the list.
- **Failing tests are committed on purpose.** Each fix has a `test(red):` commit directly
  before it, with the captured output in [`planning/evidence/`](planning/evidence/).
- **Vitest 4.1.12, not the latest 5.x**, because 5.x needs Node 22.12 and this project runs on
  Node 20. It is the only new dependency.
- **Left alone:** lint, a deployment of the live pipeline, the landing page (it stays silent on
  a refused click), and major-version upgrades. One advisory is left, in `zod` 3.x, and its fix is zod 4.
  The app lists `zod` but never imports it.

All decisions with their reasons are in [`planning/03-decisions.md`](planning/03-decisions.md).

### Where the agent helped, and where it was wrong

Helped:

- It checked the three handoff hypotheses by running the baseline code in a throwaway probe
  before planning, and found more than the handoff had: two unlisted write routes, and the same
  missing status check in `resumeRender`.
- It read the UI before choosing the status code and noticed that a 403 would show a false
  message.
- It built the hermetic test harness, wrote each failing test before its fix, and kept the
  planning files current while working.
- For the replay demo it read the snapshot before designing anything and found that "three
  templates" is a fact of the recorded data. The code has four. It then broke its own
  implementation on purpose five times to check that the tests notice.

Wrong, and how it was corrected (full list in
[`planning/04-agent-misses.md`](planning/04-agent-misses.md)):

- The earlier recon agent listed seven write routes. There are nine. Found by reading every
  route file. The test now enumerates them.
- The build agent then planned a hand-written table of guarded routes, the same pattern that
  had just failed. The owner caught it at plan review.
- The one UI change did nothing at first: it wrote the reason into a notice that only exists in
  pilot mode. All tests were green. It was found by clicking the button in the running app.
- Two tooling assumptions failed on first run (the config file format, mock state leaking
  between tests), and the GitHub Actions versions it remembered were three majors behind.
- Its time claims were guesses. It wrote "about 45 minutes" for a phase that the log shows
  took 17.
- Its first browser check of the replay demo matched text too loosely, ran ahead and proved
  nothing. The result was confirmed from the server state instead.

### Weakest part and next step

**Revenue is booked before settlement resolves (H2). Not fixed.** `approveOrder()` marks the
order delivered and adds the revenue right after it starts the transfer. If the transfer fails,
the books keep the money and the invoice says "simulated settlement". A restart during the
transfer leaves it at "Settling..." for good. `tests/settlement-gap.test.ts` pins this with an
expected-failure test.

Next step: give the invoice an explicit settlement record
(`pending`, `confirmed`, `failed`, `simulated`, with the transaction hash or the error), book
revenue only on `confirmed`, persist `pending` and retry it on boot, and turn the
expected-failure test into a plain one in the same commit.

Also weak:

- With `ARIA_DEMO_WRITES=1`, demo mode still has no caller identity, so `prune` and `reset`
  are open to anyone who can reach the server.
- The UI has no tests. The one UI bug of this session was found by hand.
- CI runs on every push and pull request, on Linux with Node 22. No other platform is covered
  there. Locally the suite has only run on Windows.
- The public demo is one small machine with no monitoring. It was checked once, right after
  the deploy. The checks and their results are in `planning/02-tasks.md` (T17).
- The public demo shows recorded runs only. It is evidence for the gates and the flow, not for
  the models.
- One advisory is left in `zod` 3.x, a dependency the app does not use. Removing it would
  clear the report.

## What it does

1. A client brief comes in with a budget.
2. Three director agents pitch structured concepts.
3. A jury of LLM judges compares every pair of concepts. Bradley-Terry turns the verdicts into a ranking.
4. **Gate 1, greenlight.** Concepts cost cents and renders cost dollars, so a human approves the spend. The human can override the jury.
5. The studio renders a 5-second cut and a campaign poster.
6. **Gate 2, acceptance.** The human watches the cut, then accepts it or sends it back with notes for a revision.
7. Acceptance settles the order.

## Status of this repository

This is existing work, built from July to October 2026 with Claude Code as the coding agent: a first version at a one-day hackathon in Singapore, then a pilot edition with per-customer login. It placed 5th in the BUIDL QUESTS 2026 finals.

It is imported here as a single commit, tagged `baseline`. Earlier history is not part of this repository. Provider names and deployment details were replaced with generic, environment-driven settings before the import.

## See it without any key

```bash
npm install
```

Then start the read-only showcase. It serves the landing page and the shipped work from a frozen snapshot in `public/demo-state.json`.

```bash
NEXT_PUBLIC_READONLY=1 npm run dev
```

On Windows PowerShell:

```powershell
$env:NEXT_PUBLIC_READONLY='1'; npm run dev
```

Open http://localhost:3000.

## Run the live pipeline (optional)

Live generation needs your own endpoints. Copy `.env.example` to `.env.local` and fill in what you have.

| Variable | Used for |
|---|---|
| `OPENROUTER_API_KEY` | Director agents, and the jury fallback |
| `LLM_GATEWAY_BASE`, `LLM_GATEWAY_API_KEY` | Jury, on any OpenAI-compatible chat endpoint |
| `RENDER_API_BASE`, `RENDER_API_KEY` | Video and poster generation |
| `RENDER_ASSET_BASE` | Virtual talent portraits (optional) |
| `CHAIN_BUYER_PK`, `CHAIN_STUDIO_ADDR` | Testnet USDC settlement (optional) |
| `ARIA_MODE=pilot`, `ARIA_COOKIE_SECRET` | Per-customer login instead of the single demo tenant |
| `ARIA_DEMO_WRITES=1` | Lets demo mode accept every write. It has no login, so use it only on a machine you control |
| `ARIA_DEMO_WRITES=replay` | The public demo: recorded runs, three writes, no key needed and none used |

Then run `npm run dev` and open `/studio`. In demo mode every write is refused with a 405 until
`ARIA_DEMO_WRITES=1` is set.

## Layout

| Path | Role |
|---|---|
| `lib/store.ts` | Orchestration and the order lifecycle |
| `lib/bt.ts` | Bradley-Terry ranking |
| `lib/llm.ts` | LLM calls with a fallback chain and a disk cache |
| `lib/video.ts`, `lib/image.ts` | Render clients |
| `lib/tenant.ts`, `lib/ctx.ts` | Modes and request authorisation |
| `lib/gates.ts` | Which order action is legal from which status |
| `lib/replay.ts` | The recorded runs behind the public demo, and its rules |
| `app/api/*` | Routes. Gate 1 is `greenlight`, Gate 2 is `review` |
| `app/studio`, `app/page.tsx` | Control room and landing page |
| `tests/` | Vitest suite and its hermetic harness |
| `planning/`, `logs/` | Assessment notes and the agent session log |
| `fly.toml` | The host of the public demo |

## Known gaps in the baseline

This list describes the `baseline` tag. The note after each item says where it stands now.

- No automated tests and no CI. Now: 157 tests and a CI workflow.
- `lib/store.ts` is about 1,000 lines. Now: unchanged.
- Demo mode treats every caller as the default tenant. Now: still true, but demo mode is
  read-only unless `ARIA_DEMO_WRITES` is set to `replay` or `1`.
- Revenue is booked at acceptance, before settlement is confirmed. Now: unchanged, and pinned
  by a test.
- `npm run lint` does not work yet: ESLint is not a dependency. Now: unchanged.

## Credits

- Next.js 16, React 19, Tailwind CSS 4, ethers v6.
- Frontend design discipline: [taste-skill](https://github.com/Leonxlnx/taste-skill) (MIT), applied through Claude Code.
- USDC test contract: Circle, Base Sepolia.
