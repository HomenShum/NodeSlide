# NodeSlide current-consumer proof — 2026-09-05

An author must be able to preserve a structured brief, inspect a failed deck check and reopen an editable output. This packet records those jobs against the current isolated source, including failures discovered along the way. Start with the repository [HANDOFF](../../../HANDOFF.md).

This is an evidence record of scoped repairs. Full visual, responsive, interaction, accessibility and performance grades remain unassigned. Nothing here certifies a production deployment or a real provider call.

## Read these first

| Decision | Evidence |
| --- | --- |
| Can a fresh Windows checkout run ordinary checks? | [Portability judgment](raw/E6g_NODESLIDE_PORTABILITY_SOURCE_JUDGE.md.txt), then [the later complete normal check](raw/E6g-nodeslide-readiness-check-02/normal-check.log) |
| Does the actual structured brief survive create/reload/export? | [Multiline source and actual-output judgment](raw/E6g_NODESLIDE_MULTILINE_FINAL_JUDGE.md.txt) and [actual JSON/PPTX report](raw/E6g-nodeslide-multiline-browser-01/report.json) |
| Does the failed check explain the current blocker? | [Readiness judgment](raw/E6g_NODESLIDE_READINESS_FINAL_JUDGE.md.txt), [frozen source/proof](raw/E6g_NODESLIDE_READINESS_FREEZE.json) and [native browser journeys](raw/E6g-nodeslide-readiness-browser-02/report.json) |
| What visual problems remain? | [Six-width captures and limitations](raw/E6g-nodeslide-responsive-first-use-02/report.json), [phone enlarged check detail](raw/E6g-nodeslide-readiness-browser-02/390-fail-text200.png), [desktop enlarged check detail](raw/E6g-nodeslide-readiness-browser-02/1440-fail-text200.png) |
| Why is a passing run not a timing-stability certificate? | [OpenUI phase diagnosis](raw/E6g_NODESLIDE_OPENUI_PHASE_DIAGNOSIS.md.txt), with the original failed normal checks retained |

The earlier source-validation `npm run check` on 2026-09-05 passed 2,823 root tests in 316 files, with seven skips, plus 42 workspace tests and build in 145.859 seconds. After the archive filenames were corrected, the unchanged five-test documentation owner passed. The subsequent ordinary full check failed in 184.375 seconds: the existing six-kind NodeBook scenario exceeded its 60-second deadline; 315 other files and 2,822 tests passed, with seven skips. Workspace tests and build were not reached in that run. Full local readiness remains held; neither historical success nor the archive correction closes this recurring timing failure. The targeted readiness group passes 60 tests. The actual current browser scope has twelve native keyboard entry/reload journeys and eight screenshots across two decks and two widths. The independent judgment states any additional fixture evidence separately.

## Verify bytes from a fresh checkout

From the repository root, with Python 3 installed:

```powershell
python promotion/evidence/portfolio-current-consumer-20260905/verify.py
```

`manifest.json` lists every payload hash and the current authored source Git identities. `raw-copy-map.json` maps original central evidence names to portable copies; the bytes are unchanged. Local `.gitattributes` disables text conversion within this packet. Source hashes use Git's existing checkout normalization so a harmless platform line ending does not masquerade as a code change. The original raw-source hashes remain recorded too.

Historical code and script copies end in `.txt` to prevent the application test runner from collecting them. Historical `.gitattributes` snapshots also end in `.txt` so they cannot change the byte policy of nearby evidence files. Historical Markdown snapshots end in `.md.txt` so the current documentation checker does not validate their old citations and links as current instructions. Their original names remain in the mapping. They include original absolute paths and proof-session assumptions; inspect them as records. Use the current repository's commands in HANDOFF to repeat checks, and create your own backend/session for actual browser proof. The verifier does not run historical scripts.

The manifest intentionally does not hash itself. Subsequent publication/CI judgments are separate records, bound to their exact commit and tree; they do not rewrite these historical payloads. A new source revision can correctly make the source-identity part of this verifier fail while all historical payloads remain intact.

## Scope that stays open

- Notes overlap the slide pager/zoom, and enlarged navigation, density controls and the fixed-height inspector footer can clip text. The repaired count wrapping is a narrow observation.
- CSV chart units remain generic. Source-column fidelity, prose-only chart extraction and bare-CR CSV parsing are not certified. Native Office was not opened.
- Full human/device, keyboard/touch, accessibility, performance and long-session coverage is incomplete.
- Earlier OpenUI and NodeBook timing failures, failed harness probes and corrected citation checks remain raw. A passing later check does not erase them.
- The local proof used synthetic deterministic decks. Provider, production, remaining old work and shared integration are separate acceptance decisions.

Private bootstrap configuration, access storage, raw authenticated browser traces and local databases are not public payloads. Public receipts record their boundary without exposing access material. Both owned proof services stopped and released their ports; the pre-existing apps were untouched.
