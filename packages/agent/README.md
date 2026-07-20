# `@nodeslide/agent`

Runtime-neutral deck tool contracts and a repository-backed room-tools adapter.
It does not ship a second agent loop: NodeRoom or another host supplies its own
model/runtime, locks, speech, preview, Deck CI, and export capabilities.
Governance policy routes direct edits through either atomic apply or an
unapplied proposal.
