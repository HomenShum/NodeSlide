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
  --out ./artifacts/v0.2.0 \
  --release-id <full-40-character-lowercase-git-commit-sha> \
  --release-version 0.2.0 \
  --registry-version 0.2.0

npx @nodeslide/cli init \
  --profile full-studio \
  --backend convex \
  --ui headless \
  --artifacts ./artifacts/v0.2.0
```

`nodeslide-artifacts.json` pins one release ID and version across the complete
11-package closure. Every tarball has an independent SHA-256 digest and npm
SHA-512 integrity value. Artifact installs verify the manifest, reject
unlisted tarballs, mixed versions, unsafe filenames, missing packages, and
tampered bytes before invoking npm. The installation receipt preserves the
manifest digest plus every exact name, version, filename, digest, and integrity
pin; upgrades must advance the release version and cannot downgrade the source
registry.

The local release proof builds two artifact directories and runs:

```bash
npm run proof:install-upgrade -- \
  --from ./artifacts/v0.1.0 \
  --to ./artifacts/v0.2.0 \
  --rebuilt-to ./artifacts/rebuilt-v0.2.0 \
  --from-release-id <exact-v0.1.0-tag-commit-sha> \
  --to-release-id <exact-v0.2.0-tag-commit-sha> \
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
