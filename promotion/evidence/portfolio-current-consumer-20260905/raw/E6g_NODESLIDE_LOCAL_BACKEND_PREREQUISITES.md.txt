# NodeSlide local backend prerequisites

Builder. **Use the installed Convex 1.42.3 anonymous path with explicit ports, then verify the native listeners before pushing source.** A developer needs a new private local deck database; silently selecting an old cloud project or legacy local database would defeat that isolation. The CLI's anonymous fallback and native server lifetime must therefore be checked separately.

**Re your request:** prepare a usable handoff environment without disturbing existing projects. This is the source-bound prerequisite decision; no backend command was run.

- Run only in the newly created candidate. Confirm .env, .env.local and .convex/local/default are absent before FIRST bootstrap; no existing state may be renamed, deleted, copied or reused to satisfy this condition.

- Also require absence of the resolved legacy ~/.convex/anonymous-convex-backend-state/anonymous-agent directory. Agent mode uses the fixed anonymous-agent name; the storage resolver can reuse a matching legacy directory even after the chooser calls it new.

- Use a subprocess-local environment that removes CONVEX_DEPLOY_KEY, CONVEX_DEPLOYMENT_TOKEN, CONVEX_DEPLOYMENT, CONVEX_SELF_HOSTED_URL, CONVEX_SELF_HOSTED_ADMIN_KEY, CONVEX_PROVISION_HOST and stale frontend binding variables without printing their values. Set CONVEX_AGENT_MODE=anonymous. Require CONVEX_ALLOW_ANONYMOUS not false. Do not mutate the parent shell/global configuration or copy provider keys.

- Do not pass --configure, --local, --cloud, --prod, --deployment, --deployment-name, --team, --project, --dev-deployment, --url, --admin-key or an existing --env-file. The configured environment wins before anonymous fallback; --configure bypasses normal selection.

- Select two different free valid ports explicitly. --local-cloud-port and --local-site-port are installed supported hidden options; requested-port conflict fails rather than silently changing that requested port. Reserve proof ownership and verify actual PID/listener addresses after start because port discovery has an ordinary time-of-check gap.

- Keep raw bootstrap output private. The installed verbose native-launch command contains its generated instance secret; do not enable or publish verbose logs. New credentials/state belong only to the isolated local deployment.

The supported command arguments are below. Run through an owned subprocess with the guarded child environment and candidate working directory; replace the two port placeholders with distinct verified free ports. These are instructions for the root executor, not commands executed by this reviewer.

Start empty backend with explicit ports before source push; supervise as a persistent owned process:

```text
node node_modules/convex/bin/main.js dev --skip-push --local-cloud-port <CLOUD_PORT> --local-site-port <SITE_PORT> --tail-logs disable
```

Omit --once: skip-push bypasses the routine that normally flushes/exits; adding --once does not establish one-shot lifetime. No --typecheck disable or codegen override. CLI initialization can still create/update generated setup/AI guidance files; capture exact before/after tracked input hashes.

After actual loopback-only owned listeners verified, stop that bootstrap with supported SIGINT and verify only its child exits; then normal source push/watch:

```text
node node_modules/convex/bin/main.js dev --local-cloud-port <CLOUD_PORT> --local-site-port <SITE_PORT> --tail-logs disable
```

Same candidate and sanitized child environment. Only the freshly generated local selection/config may now be present. Keep normal typecheck and codegen behavior.

Set the one public-creation admission flag on this fresh anonymous backend:

```text
node node_modules/convex/bin/main.js env set NODESLIDE_PUBLIC_CREATION true
```

Same candidate and sanitized selection environment, after verifying generated target is the anonymous local deployment. With an owned backend already running this reuses it; otherwise env set starts and stops an ephemeral saved local backend in finally. Never use env list or read keys.

The native bind boundary is still **unverified**. The installed launcher returns a loopback URL but passes no listen-interface option. The root should inspect actual addresses for both owned native listeners before source push/admission. If localhost-only binding is not observed, stop only that owned child and inspect its supported help; do not infer safety from the printed URL or invent a flag.

`init` is an explicit one-shot cleanup path with no port controls. Normal `dev --once` performs a push and invokes cleanup. `dev --skip-push` skips that exit-owning routine, so `--once` beside it is not a reliable process-lifetime claim. Graceful SIGINT runs registered cleanup; native cleanup sends SIGTERM to its own child but does not await process exit. Confirm owned-child termination and both released ports. Force-killing a parent on Windows does not establish the same cleanup behavior.

`env set` uses the same deployment selection resolver. With the verified fresh anonymous selection it targets the saved local backend and starts an ephemeral backend only if needed, then attempts cleanup in `finally`. Read no credential values and do not use broad `env list`. The admission flag admits creation; it does not select deterministic mode. Explicit deterministic selection remains mandatory before Create.

The six application crons consist of stale-run failure recovery, three expiration pruners, opted-in source refresh and probe retention. The refresh scan only schedules enabled due records and the action checks its Firecrawl credential before fetching. A fresh database with no imported schedules has no due source work; this is a scoped fresh-state argument, not a promise about arbitrary existing data.

The declared `npm run check` is lint, typecheck, tests and build. Its Vitest config excludes deployed Playwright e2e; workspace scripts run Vitest. The inspected PPTX subprocess checks ZIP/OOXML structure with JavaScript, separate from the native PowerPoint motion canary. No native Office dispatch was found in the bounded declared-owner/test-source review. This is static evidence; the root's unchanged running check remains the execution oracle, and no extra check was launched here.

Exact source hashes, line excerpts, workspace script closure and the native-pattern test scan are retained under [prerequisite evidence](E6g-nodeslide-local-backend-prerequisites/source-bindings.json). The [structured receipt](E6g_NODESLIDE_LOCAL_BACKEND_PREREQUISITES.json) names all constraints and lifetime differences. No environment values, config credentials, workbooks, live listeners or backend binary were inspected. No source/index/ref edits occurred; all grades remain null.

Bootstrap also writes the new anonymous selection and frontend/backend URLs before returning. Preserve only that newly generated candidate selection for `env set`: anonymous mode with a null deployment name is explicitly refused by the credential resolver. The four native-keyword scan matches are comments/test-description references to LibreOffice, not native dispatch.
