---
name: changelens
description: Require a human-readable before-and-after proof for every change, whatever the surface. Use when changing user interface, command-line output, backend behaviour, performance, schema, prompt, or configuration — and capture the before BEFORE editing, because a before cannot be reconstructed afterwards.
---

# ChangeLens

A change is not done when the edit lands. It is done when someone can see what it did.

1. **Capture the before first.** Run the thing and record its output. A before cannot be
   reconstructed after the edit, and a reconstruction is a guess wearing evidence.
2. **Pick the capture that matches the surface.** Interface → screenshot. Command line → the
   captured terminal output. Backend → a metric, a log line, or a response body. Performance → the
   number, with its units. Schema → the shape before and after.
3. **Make the edit.**
4. **Capture the after by the same method**, at the same size, on the same input. Two captures taken
   differently do not compare.
5. **State the delta in the terms the change was requested in.** "8 sizes → 4 sizes" is a result.
   "improved the type scale" is a claim.

## The probe must be unique to the change

A capture proves nothing if it would have looked the same without the edit. Before trusting one,
ask: *if I reverted my change right now, would this capture look different?* If not, the probe is
measuring something else and the result is noise.

This is the failure that keeps recurring. A deploy check matched a string that already existed. A
CSS rule was captured from a harness that did not contain the markup that ships. A grep for an
identifier reported a concept absent when it shipped under another name. In each case the sensor
reported success or absence for a reason unrelated to the thing under test.

## Absence needs an armed sensor

Before writing "X does not exist" or "X is not enforced": name the mechanism, say what would have to
be true for it to run, and confirm it ran. A guard behind a condition that was never met proves
nothing about the guard. Prefer a positive control — show the mechanism firing where it should,
before claiming it fails to fire where you think it does not.

## What counts as done

The change, the two captures, the method used for both, and the delta stated as a measurement. A
summary that describes the change without showing it is not a proof; it is a description of one.

## Why this is a guardrail and not a preference

Procedure that lives only in someone's habits degrades the moment they are busy, and an agent has no
habits at all. A skill in the repository travels with the work, applies to every agent that reads
it, and can be pointed at in review. Keeping it in one person's tool configuration makes the
discipline personal, unportable, and invisible to everyone else.
