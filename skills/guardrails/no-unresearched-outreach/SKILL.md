---
name: no-unresearched-outreach
description: Fail closed when an agent drafts a message to a person without a verified research hook — one concrete, recent, dated, source-backed thing that person or company did. Use before generating, sending, queueing, or accepting any outbound message to a named human.
---

# No Unresearched Outreach

1. Resolve the recipient and check the contact record for a `hook`: text, date, and source URL.
2. Verify the hook is **concrete** (a named artifact, not a category), **recent** (dated, typically within 90 days), and **source-backed** (a resolvable URL).
3. Reject a hook that is generalised ("saw your work in AI"), undated, self-referential, or restates the recipient's job title.
4. Classify the result `UNRESEARCHED_OUTREACH` when no qualifying hook exists, and return a typed degraded result naming what was searched.
5. On pass, enforce the message shape: one reaction to the specific real thing, one open question, no role, no proof points, no availability, under ~40 words.

## Why fail closed

A model asked to open a message without research will produce something plausible
and false. Unlike a hallucinated code path, this one is delivered to a named human
who can check it — it is the highest-consequence fabrication surface in the
system, and the cheapest to prevent.

`UNRESEARCHED_OUTREACH` is a **correct and expected** verdict, not an error. For a
volume recruiter or an unidentifiable sender it is the right answer, and the
correct downstream action is to deprioritise the contact rather than to write
anything.

## Degraded result

```
UNRESEARCHED_OUTREACH
  contact:   <id>
  searched:  <sources actually checked>
  choices:   research-now | deprioritise | explicit-human-acceptance
```

Absence must be **scoped**. "No hook found" without naming what was searched is
the same defect as the fabricated hook: a claim whose coverage cannot be checked.

## Related guardrails

Same family as `no-generic-fallback` — both refuse to let a plausible substitute
stand in for the requested, provenance-backed thing. Where `no-generic-fallback`
protects a deck against unrelated content, this protects a human recipient against
a templated opener.

Full doctrine, research schema, and store contract:
`skills/probe-first/` in NodeRoom, or https://github.com/HomenShum/probe-first
