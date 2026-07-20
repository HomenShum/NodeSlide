# `@nodeslide/cli`

Run `npx @nodeslide/cli init` (the installed binary is `nodeslide`). Before
public npm releases, pass `--artifacts <directory>` to install the exact
versioned tarballs produced by `npm pack`.

The CLI never modifies auth, routing, global CSS, `.env`, or an existing Convex
schema. Generated source lives in package-specific paths. Every write is
hashed in `.nodeslide/installation.json`; upgrades overwrite only an unchanged
generated file and emit a reviewable diff for host-modified files.
