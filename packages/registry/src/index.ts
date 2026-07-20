import { readFile } from 'node:fs/promises';

export type NodeSlideInstallProfile =
  | 'full-studio'
  | 'agent-thread'
  | 'renderer'
  | 'presenter'
  | 'backend-only'
  | 'agent-pack-only';

export type NodeSlideBackendChoice = 'convex' | 'hosted' | 'custom';
export type NodeSlideUiMode = 'default-theme' | 'host-tokens' | 'headless';

export interface NodeSlideRegistryEntry {
  id: string;
  source: string;
  destination: string;
  profiles: readonly NodeSlideInstallProfile[];
  backends?: readonly NodeSlideBackendChoice[];
  uiModes?: readonly NodeSlideUiMode[];
}

export const NODESLIDE_REGISTRY_VERSION = '0.1.0' as const;

export const NODESLIDE_REGISTRY_ENTRIES: readonly NodeSlideRegistryEntry[] = [
  {
    id: 'studio-shell',
    source: 'studio/NodeSlideExample.tsx',
    destination: 'components/nodeslide/NodeSlideExample.tsx',
    profiles: ['full-studio'],
    uiModes: ['default-theme', 'host-tokens'],
  },
  {
    id: 'agent-panel',
    source: 'agent/NodeSlideAgentPanel.tsx',
    destination: 'components/nodeslide/NodeSlideAgentPanel.tsx',
    profiles: ['full-studio', 'agent-thread'],
    uiModes: ['default-theme', 'host-tokens'],
  },
  {
    id: 'renderer',
    source: 'renderer/NodeSlideRenderer.tsx',
    destination: 'components/nodeslide/NodeSlideRenderer.tsx',
    profiles: ['renderer'],
    uiModes: ['default-theme', 'host-tokens'],
  },
  {
    id: 'presenter',
    source: 'presenter/NodeSlidePresenter.tsx',
    destination: 'components/nodeslide/NodeSlidePresenter.tsx',
    profiles: ['full-studio', 'presenter'],
    uiModes: ['default-theme', 'host-tokens'],
  },
  {
    id: 'conformance',
    source: 'testing/nodeslide.conformance.ts',
    destination: 'nodeslide/nodeslide.conformance.ts',
    profiles: ['full-studio', 'backend-only'],
  },
  {
    id: 'convex-component-config',
    source: 'convex/convex.config.ts',
    destination: 'convex/nodeslide/convex.config.ts',
    profiles: ['full-studio', 'backend-only'],
    backends: ['convex'],
  },
  {
    id: 'convex-component-schema',
    source: 'convex/schema.ts',
    destination: 'convex/nodeslide/schema.ts',
    profiles: ['full-studio', 'backend-only'],
    backends: ['convex'],
  },
  {
    id: 'custom-backend',
    source: 'backend/customBackend.ts',
    destination: 'nodeslide/customBackend.ts',
    profiles: ['full-studio', 'backend-only'],
    backends: ['custom'],
  },
  {
    id: 'environment-example',
    source: 'backend/nodeslide.env.example',
    destination: 'nodeslide/nodeslide.env.example',
    profiles: ['full-studio', 'backend-only'],
    backends: ['convex', 'hosted'],
  },
];

export function selectNodeSlideRegistryEntries(input: {
  profile: NodeSlideInstallProfile;
  backend: NodeSlideBackendChoice;
  uiMode: NodeSlideUiMode;
}): readonly NodeSlideRegistryEntry[] {
  if (input.uiMode === 'headless') return [];
  return NODESLIDE_REGISTRY_ENTRIES.filter(
    (entry) =>
      entry.profiles.includes(input.profile) &&
      (!entry.backends || entry.backends.includes(input.backend)) &&
      (!entry.uiModes || entry.uiModes.includes(input.uiMode)),
  );
}

export async function readNodeSlideRegistryEntry(entry: NodeSlideRegistryEntry): Promise<string> {
  const root = new URL('../sources/', import.meta.url);
  const url = new URL(entry.source.replaceAll('\\', '/'), root);
  if (!url.href.startsWith(root.href))
    throw new Error(`Registry source escaped its root: ${entry.source}`);
  return readFile(url, 'utf8');
}
