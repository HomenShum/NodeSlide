# NodeSlide production build receipt

- Observed: 2026-08-04
- Command: `npm run build`
- Exit code: `0`
- Wall time: `259.5 seconds`
- Package chain: all NodeSlide workspaces built successfully.
- TypeScript project build: passed.
- Vite: `6,219 modules transformed`; production bundle completed in `1m 11s`.
- Output signal: `dist/index.html` and hashed production assets were emitted.

Warnings retained honestly:

- `%VITE_GIT_SHA%` was not defined for this local build.
- Vite reported a vendor chunk above its 500 kB advisory threshold.

The local Vite process on port 5180 was stopped before this run because it held generated font files open on Windows. The build was not run concurrently with that server.
