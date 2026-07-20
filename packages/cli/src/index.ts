import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  NODESLIDE_REGISTRY_VERSION,
  type NodeSlideBackendChoice,
  type NodeSlideInstallProfile,
  type NodeSlideRegistryEntry,
  type NodeSlideUiMode,
  readNodeSlideRegistryEntry,
  selectNodeSlideRegistryEntries,
} from '@nodeslide/registry';

export const NODESLIDE_INSTALLATION_RECEIPT_VERSION = 'nodeslide.installation/v1' as const;
export const NODESLIDE_PACKAGE_VERSION = '0.1.0' as const;

export interface NodeSlideInitOptions {
  cwd: string;
  profile: NodeSlideInstallProfile;
  backend: NodeSlideBackendChoice;
  uiMode: NodeSlideUiMode;
  artifactsDirectory?: string;
  skipInstall?: boolean;
  skipChecks?: boolean;
  dryRun?: boolean;
}

export interface NodeSlideFrameworkDetection {
  framework: 'next' | 'vite' | 'astro' | 'remix' | 'unknown';
  packageManager: 'npm';
  hasTypeScript: boolean;
  shadcnConfig: string | null;
}

export interface NodeSlideReceiptFile {
  registryId: string;
  path: string;
  sha256: string;
}

export interface NodeSlideInstallationReceipt {
  schemaVersion: typeof NODESLIDE_INSTALLATION_RECEIPT_VERSION;
  cliVersion: typeof NODESLIDE_PACKAGE_VERSION;
  registryVersion: typeof NODESLIDE_REGISTRY_VERSION;
  installedAt: string;
  updatedAt: string;
  profile: NodeSlideInstallProfile;
  backend: NodeSlideBackendChoice;
  uiMode: NodeSlideUiMode;
  detection: NodeSlideFrameworkDetection;
  packages: readonly string[];
  packageSource: 'registry' | 'tarball' | 'skipped';
  files: readonly NodeSlideReceiptFile[];
  checks: readonly { script: string; status: 'passed' | 'skipped' | 'failed' }[];
  pendingMigrations: readonly string[];
  manualSteps: readonly string[];
  upgrades: readonly {
    upgradedAt: string;
    fromRegistryVersion: string;
    toRegistryVersion: string;
    diffs: readonly string[];
  }[];
}

export interface NodeSlideInstallPlan {
  root: string;
  receiptPath: string;
  packages: readonly string[];
  installSpecs: readonly string[];
  packageSource: NodeSlideInstallationReceipt['packageSource'];
  entries: readonly NodeSlideRegistryEntry[];
  detection: NodeSlideFrameworkDetection;
}

export async function planNodeSlideInstallation(
  options: NodeSlideInitOptions,
): Promise<NodeSlideInstallPlan> {
  const root = path.resolve(options.cwd);
  const manifest = await readJsonObject(path.join(root, 'package.json'));
  const detection = await detectFramework(root, manifest);
  const packages = packagesFor(options);
  const installSpecs = await installSpecsFor(packages, root, options.artifactsDirectory);
  return {
    root,
    receiptPath: path.join(root, '.nodeslide', 'installation.json'),
    packages,
    installSpecs,
    packageSource: options.skipInstall
      ? 'skipped'
      : options.artifactsDirectory
        ? 'tarball'
        : 'registry',
    entries: selectNodeSlideRegistryEntries(options),
    detection,
  };
}

export async function runNodeSlideInit(
  options: NodeSlideInitOptions,
): Promise<NodeSlideInstallationReceipt> {
  const plan = await planNodeSlideInstallation(options);
  await assertMissing(plan.receiptPath, 'NodeSlide is already installed; run `nodeslide upgrade`.');
  const prepared = await prepareRegistryWrites(plan);
  if (options.dryRun) return receiptFor(options, plan, [], [], 'skipped');

  if (!options.skipInstall) {
    await runCommand('npm', ['install', '--save-exact', ...plan.installSpecs], plan.root);
  }
  const files: NodeSlideReceiptFile[] = [];
  for (const item of prepared) {
    await mkdir(path.dirname(item.destination), { recursive: true });
    await writeFile(item.destination, item.content, { encoding: 'utf8', flag: 'wx' });
    files.push({
      registryId: item.entry.id,
      path: relativePortable(plan.root, item.destination),
      sha256: digest(item.content),
    });
  }
  const checks = options.skipChecks ? skippedChecks() : await runProjectChecks(plan.root);
  const receipt = receiptFor(options, plan, files, checks, plan.packageSource);
  await mkdir(path.dirname(plan.receiptPath), { recursive: true });
  await writeFile(plan.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  if (checks.some((check) => check.status === 'failed')) {
    throw new Error(`NodeSlide installed, but a project check failed. See ${plan.receiptPath}.`);
  }
  return receipt;
}

export async function runNodeSlideUpgrade(options: {
  cwd: string;
  artifactsDirectory?: string;
  skipInstall?: boolean;
  skipChecks?: boolean;
  dryRun?: boolean;
}): Promise<NodeSlideInstallationReceipt> {
  const root = path.resolve(options.cwd);
  const receiptPath = path.join(root, '.nodeslide', 'installation.json');
  const previous = validateReceipt(await readJsonObject(receiptPath));
  const initOptions: NodeSlideInitOptions = {
    cwd: root,
    profile: previous.profile,
    backend: previous.backend,
    uiMode: previous.uiMode,
    ...(options.artifactsDirectory === undefined
      ? {}
      : { artifactsDirectory: options.artifactsDirectory }),
    ...(options.skipInstall === undefined ? {} : { skipInstall: options.skipInstall }),
    ...(options.skipChecks === undefined ? {} : { skipChecks: options.skipChecks }),
  };
  const plan = await planNodeSlideInstallation(initOptions);
  if (!options.skipInstall && !options.dryRun) {
    await runCommand('npm', ['install', '--save-exact', ...plan.installSpecs], root);
  }
  const priorFiles = new Map(previous.files.map((file) => [file.registryId, file]));
  const nextFiles: NodeSlideReceiptFile[] = [];
  const diffs: string[] = [];
  for (const entry of plan.entries) {
    const content = await readNodeSlideRegistryEntry(entry);
    const destination = safeDestination(root, entry.destination);
    const prior = priorFiles.get(entry.id);
    const current = await readOptional(destination);
    const nextHash = digest(content);
    if (current === null) {
      const diffPath = await writeUpgradeDiff(root, entry, '', content, options.dryRun);
      diffs.push(diffPath);
      if (prior) nextFiles.push(prior);
      continue;
    }
    const currentHash = digest(current);
    if (currentHash === nextHash) {
      nextFiles.push({
        registryId: entry.id,
        path: relativePortable(root, destination),
        sha256: nextHash,
      });
      continue;
    }
    if (prior && currentHash === prior.sha256) {
      if (!options.dryRun) await writeFile(destination, content, 'utf8');
      nextFiles.push({
        registryId: entry.id,
        path: relativePortable(root, destination),
        sha256: nextHash,
      });
      continue;
    }
    const diffPath = await writeUpgradeDiff(root, entry, current, content, options.dryRun);
    diffs.push(diffPath);
    if (prior) nextFiles.push(prior);
  }
  for (const prior of previous.files) {
    if (!nextFiles.some((file) => file.registryId === prior.registryId)) nextFiles.push(prior);
  }
  const checks =
    options.skipChecks || options.dryRun ? skippedChecks() : await runProjectChecks(root);
  const updatedAt = new Date().toISOString();
  const next: NodeSlideInstallationReceipt = {
    ...previous,
    cliVersion: NODESLIDE_PACKAGE_VERSION,
    registryVersion: NODESLIDE_REGISTRY_VERSION,
    updatedAt,
    packages: plan.packages,
    packageSource: options.skipInstall ? 'skipped' : plan.packageSource,
    files: nextFiles,
    checks,
    upgrades: [
      ...previous.upgrades,
      {
        upgradedAt: updatedAt,
        fromRegistryVersion: previous.registryVersion,
        toRegistryVersion: NODESLIDE_REGISTRY_VERSION,
        diffs,
      },
    ],
  };
  if (!options.dryRun) await writeFile(receiptPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  if (checks.some((check) => check.status === 'failed')) {
    throw new Error(`NodeSlide upgraded, but a project check failed. See ${receiptPath}.`);
  }
  return next;
}

async function detectFramework(
  root: string,
  manifest: Record<string, unknown>,
): Promise<NodeSlideFrameworkDetection> {
  const dependencies = {
    ...objectValue(manifest['dependencies']),
    ...objectValue(manifest['devDependencies']),
  };
  const framework: NodeSlideFrameworkDetection['framework'] =
    'next' in dependencies
      ? 'next'
      : 'vite' in dependencies
        ? 'vite'
        : 'astro' in dependencies
          ? 'astro'
          : '@remix-run/react' in dependencies
            ? 'remix'
            : 'unknown';
  const shadcn = await firstExisting(root, ['components.json', 'src/components.json']);
  return {
    framework,
    packageManager: 'npm',
    hasTypeScript: await exists(path.join(root, 'tsconfig.json')),
    shadcnConfig: shadcn ? relativePortable(root, shadcn) : null,
  };
}

function packagesFor(
  options: Pick<NodeSlideInitOptions, 'profile' | 'backend' | 'uiMode'>,
): string[] {
  const byProfile: Record<NodeSlideInstallProfile, string[]> = {
    'full-studio': [
      '@nodeslide/contracts',
      '@nodeslide/engine',
      '@nodeslide/backend',
      '@nodeslide/testing',
      '@nodeslide/react-headless',
      '@nodeslide/react',
      '@nodeslide/agent',
    ],
    'agent-thread': [
      '@nodeslide/contracts',
      '@nodeslide/backend',
      '@nodeslide/react-headless',
      '@nodeslide/react',
      '@nodeslide/agent',
    ],
    renderer: ['@nodeslide/contracts', '@nodeslide/react'],
    presenter: ['@nodeslide/contracts', '@nodeslide/react-headless', '@nodeslide/react'],
    'backend-only': [
      '@nodeslide/contracts',
      '@nodeslide/engine',
      '@nodeslide/backend',
      '@nodeslide/testing',
    ],
    'agent-pack-only': ['@nodeslide/contracts', '@nodeslide/backend', '@nodeslide/agent'],
  };
  const values = [...byProfile[options.profile]];
  if (options.uiMode === 'headless') {
    const styledIndex = values.indexOf('@nodeslide/react');
    if (styledIndex >= 0) values.splice(styledIndex, 1);
    if (!values.includes('@nodeslide/react-headless')) values.push('@nodeslide/react-headless');
  }
  if (options.backend === 'convex') values.push('@nodeslide/convex');
  if (options.backend === 'hosted') values.push('@nodeslide/client-http');
  return [...new Set(values)].sort();
}

async function installSpecsFor(
  packages: readonly string[],
  root: string,
  artifactsDirectory?: string,
): Promise<string[]> {
  if (!artifactsDirectory) return packages.map((name) => `${name}@${NODESLIDE_PACKAGE_VERSION}`);
  const artifacts = path.resolve(root, artifactsDirectory);
  const specs: string[] = [];
  for (const packageName of packages) {
    const base = packageName.replace(/^@/, '').replace('/', '-');
    const tarball = path.join(artifacts, `${base}-${NODESLIDE_PACKAGE_VERSION}.tgz`);
    await access(tarball);
    specs.push(tarball);
  }
  return specs;
}

async function prepareRegistryWrites(plan: NodeSlideInstallPlan) {
  const prepared: Array<{ entry: NodeSlideRegistryEntry; destination: string; content: string }> =
    [];
  for (const entry of plan.entries) {
    const destination = safeDestination(plan.root, entry.destination);
    await assertMissing(destination, `Refusing to overwrite existing file ${destination}.`);
    prepared.push({ entry, destination, content: await readNodeSlideRegistryEntry(entry) });
  }
  return prepared;
}

function receiptFor(
  options: NodeSlideInitOptions,
  plan: NodeSlideInstallPlan,
  files: readonly NodeSlideReceiptFile[],
  checks: NodeSlideInstallationReceipt['checks'],
  packageSource: NodeSlideInstallationReceipt['packageSource'],
): NodeSlideInstallationReceipt {
  const now = new Date().toISOString();
  return {
    schemaVersion: NODESLIDE_INSTALLATION_RECEIPT_VERSION,
    cliVersion: NODESLIDE_PACKAGE_VERSION,
    registryVersion: NODESLIDE_REGISTRY_VERSION,
    installedAt: now,
    updatedAt: now,
    profile: options.profile,
    backend: options.backend,
    uiMode: options.uiMode,
    detection: plan.detection,
    packages: plan.packages,
    packageSource,
    files,
    checks,
    pendingMigrations:
      options.backend === 'convex'
        ? ['initialize_isolated_tables_v1 (run in host Convex deployment)']
        : [],
    manualSteps: [
      'Wire the generated example into host-owned routing only after review.',
      'Resolve NodeSlidePrincipal in server-owned auth code.',
      'Run the generated repository conformance helper against the deployed adapter.',
      ...(options.uiMode === 'headless'
        ? []
        : ['Import @nodeslide/react/styles.css from a host-owned style entry if desired.']),
    ],
    upgrades: [],
  };
}

async function runProjectChecks(root: string): Promise<NodeSlideInstallationReceipt['checks']> {
  const manifest = await readJsonObject(path.join(root, 'package.json'));
  const scripts = objectValue(manifest['scripts']);
  const checks: Array<{ script: string; status: 'passed' | 'skipped' | 'failed' }> = [];
  for (const script of ['typecheck', 'build']) {
    if (typeof scripts[script] !== 'string') {
      checks.push({ script, status: 'skipped' });
      continue;
    }
    try {
      await runCommand('npm', ['run', script], root);
      checks.push({ script, status: 'passed' });
    } catch {
      checks.push({ script, status: 'failed' });
      break;
    }
  }
  return checks;
}

function skippedChecks(): NodeSlideInstallationReceipt['checks'] {
  return [
    { script: 'typecheck', status: 'skipped' },
    { script: 'build', status: 'skipped' },
  ];
}

async function runCommand(command: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const executable = process.platform === 'win32' && command === 'npm' ? 'npm.cmd' : command;
    const child = spawn(executable, [...args], {
      cwd,
      shell: false,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with code ${String(code)}.`)),
    );
  });
}

async function writeUpgradeDiff(
  root: string,
  entry: NodeSlideRegistryEntry,
  current: string,
  next: string,
  dryRun = false,
): Promise<string> {
  const relative = path.posix.join('.nodeslide', 'updates', `${entry.id}.diff`);
  const destination = safeDestination(root, relative);
  const diff = sourceDiff(entry.destination, current, next);
  if (!dryRun) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, diff, 'utf8');
  }
  return relative;
}

function sourceDiff(file: string, current: string, next: string): string {
  const before = current
    .split(/\r?\n/)
    .map((line) => `-${line}`)
    .join('\n');
  const after = next
    .split(/\r?\n/)
    .map((line) => `+${line}`)
    .join('\n');
  return `--- a/${file}\n+++ b/${file}\n@@ registry source update @@\n${before}\n${after}\n`;
}

function safeDestination(root: string, relative: string): string {
  const destination = path.resolve(root, relative);
  const prefix = `${path.resolve(root)}${path.sep}`;
  if (!destination.startsWith(prefix)) throw new Error(`Path escapes project root: ${relative}`);
  return destination;
}

function relativePortable(root: string, value: string): string {
  return path.relative(root, value).replaceAll(path.sep, '/');
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function readJsonObject(file: string): Promise<Record<string, unknown>> {
  const value: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${file} must contain a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validateReceipt(value: Record<string, unknown>): NodeSlideInstallationReceipt {
  if (value['schemaVersion'] !== NODESLIDE_INSTALLATION_RECEIPT_VERSION) {
    throw new Error(
      `Unsupported NodeSlide installation receipt ${String(value['schemaVersion'])}.`,
    );
  }
  return value as unknown as NodeSlideInstallationReceipt;
}

async function assertMissing(file: string, message: string): Promise<void> {
  if (await exists(file)) throw new Error(message);
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function firstExisting(root: string, candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    const value = path.join(root, candidate);
    if (await exists(value)) return value;
  }
  return null;
}

function isNotFound(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
}
