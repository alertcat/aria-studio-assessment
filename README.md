# Aria Studio

A one-person media studio run by AI agents, with a human gate on every dollar.

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

Then run `npm run dev` and open `/studio`.

## Layout

| Path | Role |
|---|---|
| `lib/store.ts` | Orchestration and the order lifecycle |
| `lib/bt.ts` | Bradley-Terry ranking |
| `lib/llm.ts` | LLM calls with a fallback chain and a disk cache |
| `lib/video.ts`, `lib/image.ts` | Render clients |
| `lib/tenant.ts`, `lib/ctx.ts` | Modes and request authorisation |
| `app/api/*` | Routes. Gate 1 is `greenlight`, Gate 2 is `review` |
| `app/studio`, `app/page.tsx` | Control room and landing page |

## Known gaps in the baseline

- No automated tests and no CI.
- `lib/store.ts` is about 1,000 lines.
- Demo mode treats every caller as the default tenant.
- Revenue is booked at acceptance, before settlement is confirmed.
- `npm run lint` does not work yet: ESLint is not a dependency.

## Credits

- Next.js 16, React 19, Tailwind CSS 4, ethers v6.
- Frontend design discipline: [taste-skill](https://github.com/Leonxlnx/taste-skill) (MIT), applied through Claude Code.
- USDC test contract: Circle, Base Sepolia.
