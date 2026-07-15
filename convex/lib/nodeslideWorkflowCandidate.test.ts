import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
} from '../../shared/nodeslide';
import {
  NODE_WORKFLOW_PROTOCOL_VERSION,
  type NodeWorkflowRequest,
  type NodeWorkflowResult,
  canonicalNodeWorkflowJson,
} from '../../shared/workflowExecutionPort';
import type { NodeSlidePatchInput } from './nodeslidePatches';
import { inspectNodeSlideWorkflowCandidate } from './nodeslideWorkflowCandidate';

const request: NodeWorkflowRequest = {
  schemaVersion: NODE_WORKFLOW_PROTOCOL_VERSION,
  app: 'nodeslide',
  workflow: 'independent-element-edit',
  fixtureId: 'nodeslide-independent-elements-v1',
  traceId: 'trace-nodeslide-independent-elements-1',
  inputDigest: `sha256:${'1'.repeat(64)}`,
  baseVersion: 3,
  idempotencyKey: 'nodeslide-independent-elements-v1:run-1',
  concurrency: 4,
  deadlineMs: 10_000,
};

describe('NodeSlide workflow execution port', () => {
  it('validates an executor patch without accepting or applying it', async () => {
    const snapshot = deckSnapshot();
    const candidate = patchCandidate();
    const admission = await inspectNodeSlideWorkflowCandidate({
      request,
      result: resultFor(candidate),
      expectedAppCommit: 'dd67e4c642c40e6bb414af617a67a31dbed507c5',
      snapshot,
      digestCandidate: digest,
      now: () => new Date('2026-07-15T10:00:00.000Z'),
    });

    expect(admission.accepted).toBe(true);
    expect(admission.receipt.finalWriteAuthority).toBe('application_validation_cas_review');
    expect(snapshot.elements[0]?.content).toBe('Before');
  });

  it('rejects a stale element clock through NodeSlide CAS evaluation', async () => {
    const snapshot = deckSnapshot();
    const candidate = patchCandidate();
    candidate.baseElementVersions.headline = 0;

    const admission = await inspectNodeSlideWorkflowCandidate({
      request,
      result: resultFor(candidate),
      expectedAppCommit: 'dd67e4c642c40e6bb414af617a67a31dbed507c5',
      snapshot,
      digestCandidate: digest,
    });

    expect(admission.accepted).toBe(false);
    expect(admission.receipt.issues.join('\n')).toContain(
      'Element headline changed from v0 to v1.',
    );
    expect(snapshot.elements[0]?.content).toBe('Before');
  });
});

function patchCandidate(): NodeSlidePatchInput {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/rocketride-nodeslide-independent-elements.json', import.meta.url),
      'utf8',
    ),
  ) as { candidate: NodeSlidePatchInput };
  return fixture.candidate;
}

function resultFor(candidate: NodeSlidePatchInput): NodeWorkflowResult<NodeSlidePatchInput> {
  return {
    schemaVersion: NODE_WORKFLOW_PROTOCOL_VERSION,
    runId: 'nodeslide-native-001',
    traceId: request.traceId,
    framework: 'native',
    candidate,
    inputDigest: request.inputDigest,
    idempotencyKey: request.idempotencyKey,
    outputDigest: digest(candidate),
    events: [
      { sequence: 1, atMs: 0, kind: 'run.started' },
      { sequence: 2, atMs: 8, kind: 'candidate.produced', unitId: 'headline' },
    ],
    metrics: {
      coldStartMs: 1,
      warmupMs: 0,
      executionMs: 7,
      totalMs: 8,
      retryCount: 0,
      completedUnits: 1,
      failedUnits: 0,
      duplicateUnits: 0,
      leakedUnits: 0,
    },
    provenance: {
      adapter: 'nodeslide-native',
      adapterVersion: '1.0.0',
      runtime: 'node',
      runtimeVersion: process.version,
      appCommit: 'dd67e4c642c40e6bb414af617a67a31dbed507c5',
      deterministic: true,
      location: 'local',
    },
  };
}

function deckSnapshot(): DeckSnapshot {
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: 'deck-1',
      projectId: 'project-1',
      title: 'RocketRide study',
      brief: {
        prompt: 'Compare execution runtimes',
        audience: 'Application engineers',
        purpose: 'Deterministic benchmark',
        successCriteria: ['Preserve unrelated elements'],
      },
      theme: {
        id: 'study',
        name: 'Study',
        mode: 'light',
        colors: {
          canvas: '#ffffff',
          ink: '#111111',
          muted: '#666666',
          accent: '#0055aa',
          accentSoft: '#ddeeff',
          insight: '#ddffdd',
          insightInk: '#114411',
          trace: '#222222',
          border: '#cccccc',
        },
        typography: { display: 'Arial', body: 'Arial', data: 'monospace' },
        defaultRadius: 0,
        spacingUnit: 8,
      },
      slideOrder: ['slide-1'],
      version: 3,
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    },
    slides: [
      {
        id: 'slide-1',
        deckId: 'deck-1',
        title: 'Runtime comparison',
        background: '#ffffff',
        elementOrder: ['headline'],
        version: 2,
      },
    ],
    elements: [
      {
        id: 'headline',
        slideId: 'slide-1',
        name: 'Headline',
        kind: 'text',
        bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
        rotation: 0,
        content: 'Before',
        style: {},
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native'],
        version: 1,
      },
    ],
    sources: [],
  };
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalNodeWorkflowJson(value)).digest('hex')}`;
}
