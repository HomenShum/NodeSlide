# `@nodeslide/cli`

Run `npx @nodeslide/cli init` (the installed binary is `nodeslide`). The CLI
detects the host framework, installs the selected NodeSlide profile, and writes
only package-owned sources. It never silently edits auth, routing, global CSS,
`.env`, or an existing Convex schema. Every generated file is hashed in
`.nodeslide/installation.json`; upgrades replace only unchanged generated
files and emit reviewable diffs for host-edited files.

Before public npm publication, install an immutable release set:

```bash
npm run artifacts:build -- \
  --out ./artifacts/v0.2.2 \
  --release-id <full-40-character-lowercase-git-commit-sha> \
  --release-version 0.2.2 \
  --registry-version 0.2.2

npx @nodeslide/cli init \
  --profile full-studio \
  --backend convex \
  --ui headless \
  --artifacts ./artifacts/v0.2.2
```

`nodeslide-artifacts.json` pins one release ID and version across the complete
11-package closure. Every tarball has an independent SHA-256 digest and npm
SHA-512 integrity value. Artifact installs verify the manifest, reject
unlisted tarballs, mixed versions, unsafe filenames, missing packages, and
tampered bytes before invoking npm. The installation receipt preserves the
manifest digest plus every exact name, version, filename, digest, and integrity
pin; upgrades must advance the release version and cannot downgrade the source
registry.

Use the Ubuntu `immutable-package-build.yml` workflow artifact for a
public GitHub release. The operating system affects npm's tar mode for the CLI
bin, so a Windows-built set is not accepted as the canonical public producer.

The local release proof builds two artifact directories and runs:

```bash
npm run proof:install-upgrade -- \
  --from ./artifacts/v0.1.0 \
  --to ./artifacts/v0.2.2 \
  --rebuilt-to ./artifacts/rebuilt-v0.2.2 \
  --from-release-id <exact-v0.1.0-tag-commit-sha> \
  --to-release-id <exact-v0.2.2-tag-commit-sha> \
  --report ./artifacts/immutable-install-upgrade-proof.json
```

That proof uses the candidate CLI from a separate controller, installs the
baseline into a clean consumer, verifies `package-lock.json` version and
integrity pins, upgrades to the candidate, verifies the advanced receipt, and
proves tampered and mixed release sets fail closed. The GitHub workflow also
requires public release URLs and verifies immutable releases and every asset
with `gh release verify` and `gh release verify-asset`. It resolves both tags to
their exact commit SHAs, rejects incomplete or extra release assets, rebuilds
the checked-out candidate tag, and byte-compares the manifest and all 11
tarballs with the public release before accepting the install/upgrade proof.

## Generate a finished deck

After cloning the repository and running `npm ci`, any coding agent can create,
publish, and export a deck with one command:

```bash
npm run nodeslide:generate -- \
  --title "The trust threshold" \
  --prompt "Build a seven-scene decision story about production readiness" \
  --output ./output
```

The command uses the production NodeSlide backend and the qualified Kimi K3
route by default. It does not stop at a draft: it validates the structured
deck, publishes the share, and atomically writes editable PPTX, standalone
HTML, canonical snapshot, and receipt files. A hosted provider silently
falling back to deterministic content is an error unless the caller explicitly
passes `--allow-fallback`. Use `--no-publish` only for a deliberate local-only
run, `--model` to select another qualified model, and `--effort` to raise
reasoning above the structured-generation default of `low`.
`NODESLIDE_CONVEX_URL` targets a different deployment.
