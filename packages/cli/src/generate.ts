import { mkdir, rename, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import {
  type NodeSlideStorySpec,
  buildNodeSlideStoryContext,
} from '../../../convex/lib/nodeslideStoryContext';
import {
  type DeckSnapshot,
  NODESLIDE_AGENT_MODELS,
  type NodeSlideReasoningEffort,
  type NodeSlideWorkspace,
  isNodeSlideReasoningEffort,
} from '../../../shared/nodeslide';
import { renderDeckHtml } from '../../../src/domains/nodeslide/slidelang/html';
import { buildPptx } from '../../../src/domains/nodeslide/slidelang/pptx';

const MAX_PPTX_BYTES = 24 * 1024 * 1024;
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const CREATE_TIMEOUT_MS = 360_000;

/**
 * Resolves a model-compatible effort before the CLI spends or opens a deck.
 *
 * Most offered models accept `low`, but GLM's OpenRouter route intentionally
 * starts at `high`. A model-only CLI invocation must therefore derive its
 * default from the selected model instead of manufacturing an invalid pair.
 */
export function resolveGenerateEffort(
  modelId: string,
  requested?: string,
): NodeSlideReasoningEffort {
  if (requested !== undefined && !isNodeSlideReasoningEffort(requested)) {
    throw new Error('--effort must be low, medium, high, xhigh, or max.');
  }
  const model = NODESLIDE_AGENT_MODELS.find((candidate) => candidate.id === modelId);
  const supported = model?.supportedEfforts as readonly NodeSlideReasoningEffort[] | undefined;
  const effort = requested ?? (supported?.includes('low') ? 'low' : (supported?.[0] ?? 'low'));
  if (supported && !supported.includes(effort)) {
    throw new Error(
      `${modelId} does not support --effort ${effort}; choose ${supported.join(', ')}.`,
    );
  }
  return effort;
}

export interface GenerateOptions {
  convexUrl: string;
  title: string;
  prompt: string;
  audience: string;
  purpose: string;
  successCriteria: string[];
  outputDirectory: string;
  clientSessionId: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  accessCode?: string | undefined;
  allowFallback?: boolean;
  publish?: boolean;
}

export interface GenerateReceipt {
  deckId: string;
  slideCount: number;
  execution: 'hosted' | 'deterministic_fallback';
  publishedUrl: string | null;
  files: { pptx: string; html: string; snapshot: string; receipt: string };
  storySpec: NodeSlideStorySpec;
}

export async function writeDeckArtifacts(input: {
  workspace: NodeSlideWorkspace;
  title: string;
  outputDirectory: string;
  execution: GenerateReceipt['execution'];
  publishedUrl: string | null;
  storySpec: NodeSlideStorySpec;
}): Promise<GenerateReceipt> {
  const snapshot: DeckSnapshot = {
    deck: input.workspace.deck,
    slides: input.workspace.slides,
    elements: input.workspace.elements,
    sources: input.workspace.sources,
  };
  const [pptxBinary, html] = await Promise.all([buildPptx(snapshot), renderDeckHtml(snapshot)]);
  const pptx = pptxBinary instanceof Uint8Array ? pptxBinary : new Uint8Array(pptxBinary);
  boundedArtifact(pptx, MAX_PPTX_BYTES, 'PPTX');
  boundedArtifact(html, MAX_HTML_BYTES, 'HTML');

  const outputDirectory = resolve(input.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const base = safeBaseName(input.title);
  const files = {
    pptx: join(outputDirectory, `${base}.pptx`),
    html: join(outputDirectory, `${base}.html`),
    snapshot: join(outputDirectory, `${base}.nodeslide.json`),
    receipt: join(outputDirectory, `${base}.receipt.json`),
  };
  const receipt: GenerateReceipt = {
    deckId: input.workspace.deck.id,
    slideCount: input.workspace.slides.length,
    execution: input.execution,
    publishedUrl: input.publishedUrl,
    files,
    storySpec: input.storySpec,
  };
  await Promise.all([
    atomicWrite(files.pptx, pptx),
    atomicWrite(files.html, html),
    atomicWrite(files.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`),
    atomicWrite(files.receipt, `${JSON.stringify(receipt, null, 2)}\n`),
  ]);
  return receipt;
}

function boundedArtifact(value: Uint8Array | string, limit: number, label: string): void {
  const bytes = typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength;
  if (bytes > limit) throw new Error(`${label} exceeded the ${limit}-byte artifact limit.`);
}

function safeBaseName(title: string): string {
  return (
    title
      .normalize('NFKD')
      .replace(/[^\w.-]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 80) || 'nodeslide-deck'
  );
}

async function atomicWrite(path: string, value: Uint8Array | string): Promise<void> {
  const temporary = join(
    resolve(path, '..'),
    `.${basename(path)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  await writeFile(temporary, value);
  await rename(temporary, path);
}

export async function generateDeck(options: GenerateOptions): Promise<GenerateReceipt> {
  if (!/^https:\/\/[a-z0-9-]+\.convex\.cloud$/iu.test(options.convexUrl)) {
    throw new Error('--convex-url must be an https://*.convex.cloud URL.');
  }
  const client = new ConvexHttpClient(options.convexUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);
  let workspace: NodeSlideWorkspace & { ownerAccessKey?: string; shareSlug?: string | null };
  try {
    workspace = (await Promise.race([
      client.action(makeFunctionReference<'action'>('nodeslideAgent:createDeckFromBrief'), {
        accessCode: options.accessCode,
        clientSessionId: options.clientSessionId,
        title: options.title,
        brief: {
          prompt: options.prompt,
          audience: options.audience,
          purpose: options.purpose,
          successCriteria: options.successCriteria,
        },
        themeId: 'editorial-signal',
        route: 'free',
        providerMode: 'openrouter_free',
        providerModel: options.model,
        providerEffort: options.effort,
        providerConsent: 'openrouter_full_brief_v1',
      }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`NodeSlide generation exceeded ${CREATE_TIMEOUT_MS}ms.`)),
        );
      }),
    ])) as typeof workspace;
  } finally {
    clearTimeout(timeout);
  }

  const latestTrace = workspace.traces.at(-1);
  const fellBack = latestTrace?.summary?.toLowerCase().includes('deterministic fallback') ?? true;
  if (fellBack && !options.allowFallback) {
    throw new Error(
      `Hosted generation did not complete with the requested model; refusing a deterministic fallback. ${latestTrace?.summary ?? ''}`.trim(),
    );
  }
  if (!workspace.ownerAccessKey) throw new Error('Creation did not return an owner capability.');

  let publishedUrl: string | null = null;
  if (options.publish !== false) {
    const publicationResult = (await client.mutation(
      makeFunctionReference<'mutation'>('nodeslide:publishDeck'),
      {
        deckId: workspace.deck.id,
        ownerAccessKey: workspace.ownerAccessKey,
      },
    )) as {
      publication?: { slug?: string; shareSlug?: string };
      slug?: string;
      shareSlug?: string;
    };
    const slug =
      publicationResult.publication?.shareSlug ??
      publicationResult.publication?.slug ??
      publicationResult.shareSlug ??
      publicationResult.slug;
    const publicBaseUrl = (
      process.env['NODESLIDE_PUBLIC_URL'] ?? 'https://nodeslide.vercel.app'
    ).replace(/\/+$/u, '');
    publishedUrl = slug ? `${publicBaseUrl}/s/${slug}` : null;
    if (!publishedUrl) throw new Error('Publish completed without a public share slug.');
  }

  const storySpec = buildNodeSlideStoryContext({
    title: options.title,
    brief: {
      prompt: options.prompt,
      audience: options.audience,
      purpose: options.purpose,
      successCriteria: options.successCriteria,
    },
  }).storySpec;
  return writeDeckArtifacts({
    workspace,
    title: options.title,
    outputDirectory: options.outputDirectory,
    execution: fellBack ? 'deterministic_fallback' : 'hosted',
    publishedUrl,
    storySpec,
  });
}
