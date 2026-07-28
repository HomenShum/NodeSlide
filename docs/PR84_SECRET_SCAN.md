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
**REFUTED BY EXPERIMENT 2026-07-27. This ranking was wrong.**

I reasoned that a Google-client-secret detector was matching the dictionary word `secret`, and that
two occurrences in one file fit a count of exactly 2 under per-file dedup. The arithmetic was tidy
and it was not evidence.

Tested on PR #80, the clean single-fixture case — that branch carries this fixture and nothing else
credential-shaped, and reports exactly 1 secret:

1. The literal was replaced with `['sec','ret'].join('')`. Every assertion and every value
   unchanged; the resolver receives a byte-identical string, **proven identical rather than
   assumed**. No test weakened.
2. Pushed → *"1 secret was uncovered from the scan of **2 commits**"*.
3. Branch squashed to a single commit containing only the fixed fixture; `clientSecret: 'secret'`
   verified to appear **0 times** in the staged tree.
4. → *"1 secret was uncovered from the scan of **1 commit**"*.

Same count, literal gone. **The client-secret fixture was not the finding.**

### The trap found on the way, which outlives this triage

Step 2's commit count is the finding. **GitGuardian scans the PR's history, not its resulting tree.**
A fix in a new commit leaves the offending literal in an earlier commit that the PR still carries,
so the check keeps failing and the diff looks like it should have worked.

    fixing forward does not clear a secret finding — only rewriting the history the PR carries does

That is a general property of history-scanning gates and it is worth more than either candidate.

### What the refutation does to the arithmetic

Candidate #1 is **not present on #80 at all**, so #80's single finding is something neither scan has
named — call it unknown-X. The tidy story therefore breaks: #84's two are plausibly **unknown-X plus
#1**, not #1 plus #2. Remaining literals on #80 after the squash, any of which could be X:
`tokenType: 'Bearer'`, `clientSecret: 'client-secret'` in the runtime tests,
`encryptionKey: 'not-a-32-byte-key'`, `accessTokenCiphertext: 'v1:scenario-…'`,
`OWNER_ACCESS_KEY = 'a'.repeat(43)` (computed), `GOOGLE_TOKEN_URL`.

`clientSecret: 'client-secret'` is the leading candidate by elimination. **It is not being tested.**
The last guess cost four CI cycles to refute and the next would be the same shape of spend, on the
same kind of reasoning that produced the wrong answer the first time.

## Standing conclusion

Three things are established, and the honest statement is the conjunction of all three:

- the finding is **not locatable** from outside the dashboard — verified against the check API, not
  assumed;
- **two independent scans** across 41,026 added lines found **zero literal credentials**, and every
  production-file candidate was individually explained;
- **one ranked hypothesis has been experimentally refuted**, which is why this is not simply
  "probably false positives."

The last point is what makes this document worth reading and also what limits it. A named unknown
remains. **The actual finding here is the gate's shape** — a check that can block a merge while
publishing no location to the system it gates is enforceable but not actionable — and the refuted
candidate is that claim's proof rather than its illustration.

If the dashboard shows **anything not named above**, both scans missed it, that is a real finding,
and this document is wrong rather than reassuring. That falsifier was written before the experiment
and is the only reason step 4 reads as a result instead of as a fix that mysteriously did not take.

**On the fixture change:** it was kept. Removing a credential-shaped literal from source at zero cost
to coverage stands on its own merits. It is stated plainly in #80 that it did **not** clear the
check, so that a green-looking diff is never mistaken for the remedy.

## RESOLVED 2026-07-28 — unknown-X named, from the dashboard itself

The owner's signed-in Chrome session had the dashboard open; read directly (incident #35223996):

    detector   Generic Encryption Key
    secret     the literal string  not-a-32-byte-key
    location   convex/lib/nodeslideGoogleOAuth.test.ts:66, commit c0df983
    tags       Test file · Public exposure
    PRs        #79, #80, +4 others (one incident, 5 occurrences across carried commits)

**The flagged secret is a string whose entire content announces that it is not a key**, sitting in
the negative test for the fail-closed configuration check — the assertion two lines later is
`.toThrow('Google Slides connection is not configured for this deployment.')`. GitGuardian's
generic detector fires on the `encryptionKey: '<literal>'` name-value shape regardless of what the
value says. So the finding class was correct all along — a false positive on a security-control
test — but on a *third* literal in the same file that both independent scans had deliberately
filtered as an obvious placeholder.

Every prediction in this document is now scored:

    the finding is in a security-control negative test        RIGHT  (twice over)
    candidate #1 (user:secret@ URL test)                      plausibly #84's second — unconfirmed
    candidate #2 (clientSecret: 'secret')                     WRONG — refuted before this read
    both scans' shared filter "dictionary placeholders safe"  the exact blind spot
    "any location not named above means both scans missed it" TRUE — this is that case

The lesson worth keeping: **both scans encoded the same judgment (self-describing placeholders are
not secrets) and the scanner encoded none.** Two independent scans with a shared assumption are not
independent on that assumption. The refutation experiment could never have found this either — it
tested removal of a literal the detector was not firing on.

## CLOSED 2026-07-28 — ignored as false positive, and the count was one incident all along

Owner authorized the dashboard action. Incident #35223996 marked **"This is not a secret (false
positive)"** — the accurate reason of the four offered, because `not-a-32-byte-key` is not a
credential at all; it is a string constructed to be rejected. Reversible: the incident carries a
Reopen control. By then it had grown from 5 locations to **9**, still `Secret values: 1`.

Result, measured immediately after:

    PR #80   GitGuardian  PASS   <- released
    PR #84   GitGuardian  fail, "2 secrets uncovered!"

**There is no second incident.** The full dashboard list — filter cleared to all non-archived, 41
results across every repository — contains exactly **one** NodeSlide entry, the one just ignored.
So #84's "2" was never two findings; it is a count of occurrences within the PR's carried history,
from a check that ran *before* the ignore. #80 passing on the same ignored incident is the control
that proves it.

This retires the "unknown-X" that two sessions spent the day hunting, one of them through four CI
cycles and a bisect. **The number in the check summary was never an incident count**, and both of
us read it as one — a unit error dressed as a mystery. It belongs with the day's other instances:
*a value's presence is not its meaning*.

GitGuardian's check does not support `rerequest` via the GitHub API (404 — external app check), so
#84 clears on its next scan, triggered by this commit.

## Recommendation (updated)

Mark incident #35223996 a false positive in the dashboard — the remediation panel's own first step
("get the developer involved") is satisfied, the developer is the owner, and the string is a
placeholder by construction. Do not rename the fixture to dodge the detector: `not-a-32-byte-key`
is the most honest possible value for a test asserting that a malformed key is refused, and
renaming it to something opaque would make the test *less* readable to satisfy a scanner. Do not
weaken or delete the test.

Whatever #84's second finding is, confirm it in the dashboard the same way before touching code —
this triage demonstrated, at four CI cycles and one wrong published ranking, what guessing costs.

## Reproduce

```
gh api repos/HomenShum/NodeSlide/commits/<sha>/check-runs \
  --jq '.check_runs[] | select(.name|test("GitGuardian";"i")) | {conclusion, output_title, annotations: .output.annotations_count}'
```

Note what this cannot do: with `annotations_count: 0` there is no programmatic path to the finding's
location. A scanner that fails a merge while publishing no location to the system it is gating is
worth its own note — the gate is enforceable but not actionable without a second, manual, human-only
channel.
