# PR #84 — GitGuardian triage, and the two lines to confirm

GitGuardian is the **only** failing check on #84 and therefore the only thing between it and merge.
This document exists so the owner's dashboard visit is a one-minute confirmation of a named
hypothesis rather than an open-ended hunt.

## What the check actually says

Queried from the GitHub check API at `86c1efb`:

    conclusion        failure
    output_title      "2 secrets uncovered!"
    output_summary    "2 secrets were uncovered from the scan of 33 commits in your pull request."
    annotations_count 0
    details_url       https://dashboard.gitguardian.com

**`annotations_count` is 0 and `details_url` is the bare dashboard root.** GitGuardian publishes no
file or line to GitHub, so the location is not recoverable from the API, from `gh`, or from the PR
page. That was verified, not assumed — it is the reason owner action is required at all.

This also corrects an earlier claim in this effort that the finding was a stale sticky incident and
the code was "provably clean." It is a live finding on this PR. What had actually been proven was
that one previously-known fixture was gone, and that was generalised.

## Independent scan — method

`git diff $(git merge-base origin/main 86c1efb) 86c1efb`, 33 commits, **41,026 added lines across
125 files**, added lines only. Two passes:

1. **Strict:** provider-shaped credentials — GitHub `ghp_`/`github_pat_`, AWS `AKIA`/`ASIA`, Google
   `AIza`, Slack `xox*`, Stripe `sk_live`, OpenAI `sk-`, JWT `eyJ*.*.*`, PEM private-key headers,
   credentials-in-URL, Convex deploy keys. Plus any secret-named variable assigned a literal with
   Shannon entropy > 3.4.
2. **Loose:** *any* secret-named variable assigned *any* string literal, and any opaque
   base64/hex blob ≥ 40 chars — deliberately over-inclusive, to enumerate rather than to judge.

## Result: 42 candidates, zero literal credentials

**All 6 production-file candidates are benign, individually checked:**

| location | value | why it is not a secret |
|---|---|---|
| `convex/lib/nodeslideGoogleSlidesRuntime.ts:196` | `tokenType = 'Bearer'` | an auth *scheme* name, defined in RFC 6750 |
| `convex/nodeslideGoogleAuth.ts:27` | `GOOGLE_TOKEN_URL = https://oauth2.googleapis.com/token` | Google's public documented endpoint |
| `package-lock.json` ×4 | `sha512-…` | npm **integrity hashes**, which are published content digests |

The remaining 36 are in `*.test.ts` files and every one is a dictionary-word placeholder —
`test-key`, `client-secret`, `secret`, `encrypted-access-token`, `raw-provider-secret-do-not-persist`.
Nothing that is opaque, high-entropy, or provider-shaped appears anywhere in the added lines.

## The two lines to confirm, ranked

**1 — `convex/lib/nodeslideSourceRevision.test.ts:67`** — highest confidence.

```ts
buildNodeSlideSourceRevision({
  source: source({ url: 'https://user:secret@example.com/report' }),
}),
).toThrow('URL cannot contain credentials');
```

This is the canonical *"username and password in URL"* detector firing on **the negative test for the
security control that rejects credentials in URLs.** The assertion on the very next line is the
proof: the code refuses this input, and the test exists to prove the refusal. The host is
`example.com` (RFC 2606, reserved) and the credential is the literal words `user` and `secret`.

**2 — `convex/lib/nodeslideGoogleOAuth.test.ts:65` and `:75`** — `clientSecret: 'secret'`.

A Google-OAuth-client-secret detector matching on the dictionary word `secret`. Two occurrences in
one file, which also fits a count of exactly 2 if the scanner deduplicates per-file rather than
per-line.

## Recommendation

Both are test fixtures asserting security behaviour, and the first one is *the test that proves
credentials are rejected*. If the dashboard confirms these two locations, the correct resolution is
to mark them false positives — not to weaken or delete the tests, which would remove coverage of a
control in order to satisfy a scanner that was reacting to that coverage.

If the dashboard shows **anything else** — any location not in the table above — then this scan
missed it, that is a real finding, and this document should be treated as wrong rather than as
reassurance.

## Reproduce

```
gh api repos/HomenShum/NodeSlide/commits/<sha>/check-runs \
  --jq '.check_runs[] | select(.name|test("GitGuardian";"i")) | {conclusion, output_title, annotations: .output.annotations_count}'
```

Note what this cannot do: with `annotations_count: 0` there is no programmatic path to the finding's
location. A scanner that fails a merge while publishing no location to the system it is gating is
worth its own note — the gate is enforceable but not actionable without a second, manual, human-only
channel.
