# Free Router Deck Gym

NodeSlide keeps genuinely zero-priced OpenRouter routes in a qualification cohort separate from its metered production fleet. The label `openrouter_free` is a legacy provider-mode identifier; it does not prove that an upstream route has zero pricing.

## Selection contract

Candidates are selected from OpenRouter's official model API and must:

- have an explicit `:free` route ID;
- report zero prompt and completion pricing;
- accept text and return text;
- provide at least 64K context;
- advertise `response_format` or `structured_outputs` for NodeSlide's JSON deck contract.

The frozen cohort is Gemma 4 26B, Gemma 4 31B, Nemotron 3 Super, and GPT-OSS 20B. It spans three vendors. Gemma 4 31B is retained as a compatibility control because it advertises `response_format` without `structured_outputs`.

Free routes are capacity-limited and can disappear or change without notice. A candidate therefore remains hidden from the production model picker until it passes bounded route and structured-output qualification. Full Deck Gym results still cannot change prompts, routing, or model specialization automatically.

## 2026-07-21 production qualification

The bounded route probe passed Gemma 4 26B and Nemotron 3 Super at zero metered cost. The stricter JSON-schema probe passed Gemma 4 26B, Nemotron 3 Super, and GPT-OSS 20B, again with zero metered cost. GPT-OSS recovered from its initial route error; Gemma 4 31B failed both checks because OpenRouter reported no compatible provider endpoint.

Gemma 4 26B, Nemotron 3 Super, and GPT-OSS 20B are therefore eligible for the production picker. Gemma 4 31B stays benchmark-only. The Deck Gym pilot remains a quality gate, not an availability gate; a free model can remain selectable while its visual-quality card clearly records weaknesses, but it must fail closed when upstream capacity is unavailable.

The first full-deck pilot confirmed all three eligible routes can create a validated six-slide deck at zero metered cost. It also showed why they cannot share one undifferentiated “free model” score:

- Gemma was the most faithful to the requested primitive mix, but its PPTX export failed twice.
- Nemotron exported cleanly and produced the requested primitive classes, but invented process steps and turned the risk matrix into a linear stack.
- GPT-OSS exported cleanly but invented a 30 percent claim, used the wrong visual primitive for risk, and emitted raw LaTeX in PowerPoint.

All three decks still inherit the same editorial materializer, so their silhouettes remain more similar than their plans. The harness must score claim provenance, requested-versus-produced primitive type, formula render fidelity, meaningful visual count, and cross-slide silhouette diversity separately. See `artifacts/deck-gym/deck-gym-free-router-v1/pilot-summary.json` and the provisional cards in `.qa/models/*-free/`.

Production trace attribution now treats an explicit `:free` route with non-zero token flow as live provider telemetry even when reported cost is `$0.0000`. The Gemma proof run shows 2,424 input tokens, 1,215 output tokens, passed validation, and live `openrouter · google/gemma-4-26b-a4b-it:free` attribution. Manual Vercel deploys must keep `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` pinned to the production Convex deployment; the project-level production variables were corrected after this pilot exposed a stale frontend binding.

## Commands

```powershell
npm run deck-gym:free:validate
npm run deck-gym:free:matrix
npm run probe:free-router:prod
```

The full controlled matrix is 12 briefs × 4 models × 2 design directions = 96 runs. Start with a bounded one-direction, two-brief pilot; only expand after route and structured-output qualification.
