import { spawnSync } from 'node:child_process';

const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

// Backend deployment is intentionally owned by deploy-production.yml. Keeping
// it out of the Vercel build prevents a remote rebuild from racing or silently
// redeploying Convex with a differently scoped key.
console.log('building frontend only; GitHub Actions owns Convex deployment');
run('npm', ['run', 'build']);
