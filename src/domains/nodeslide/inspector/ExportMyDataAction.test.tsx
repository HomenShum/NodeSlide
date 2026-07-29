// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE,
  NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION,
  NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION,
  type NodeSlideOwnerDataExport,
} from '../../../../shared/nodeslideDataExport';
import { createNodeSlideDataExportDownloadPayload } from '../export/nodeSlideDataExportDownload';
import { ExportMyDataButton } from './ExportMyDataAction';

const DECK_ID = 'deck_export_scenario';
const DECK_TITLE = 'Series B narrative';
const OWNER_ACCESS_KEY = 'a'.repeat(43);

// Vitest runs without `globals`, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

function bundle(overrides: Partial<NodeSlideOwnerDataExport['manifest']> = {}) {
  const manifest: NodeSlideOwnerDataExport['manifest'] = {
    schemaVersion: NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION,
    generatedAt: Date.UTC(2026, 6, 27),
    mediaType: NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE,
    scope: { kind: 'deck_owner_capability', deckId: DECK_ID, deckVersion: 4 },
    completeness: { status: 'complete', truncated: false, recordCount: 12 },
    collections: [
      { path: 'slides', table: 'nodeslide_slides', recordCount: 5 },
      { path: 'elements', table: 'nodeslide_elements', recordCount: 7 },
    ],
    omissions: {
      policyVersion: NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION,
      removedFieldCount: 3,
      redactedValueCount: 1,
      collections: [
        {
          name: 'nodeslide_taste_profiles',
          reason: 'cross_deck_profile',
          detail: 'Tenant-level profiles can span decks.',
        },
      ],
      fields: [],
    },
    determinism: {
      collectionOrder: 'schema_defined',
      recordOrder: 'creation_time_then_stable_id',
      objectKeyOrder: 'lexicographic',
      generatedAt: 'request_time_only_nondeterministic_field',
    },
    retention: {
      serverCopyCreated: false,
      bundlePersistence: 'client_download_only',
      sourceSnapshot: 'retained_records_at_export_time',
      expiredOrPrunedRecords: 'not_recoverable',
    },
    mutationPolicy: 'read_only_no_cas_or_proposal_state_changes',
    ...overrides,
  };
  return { manifest, data: { slides: [], elements: [] } } satisfies NodeSlideOwnerDataExport;
}

function renderButton(
  requestExport: (args: {
    deckId: string;
    ownerAccessKey: string;
  }) => Promise<NodeSlideOwnerDataExport>,
) {
  const saveExport = vi.fn();
  render(
    <ExportMyDataButton
      deckId={DECK_ID}
      deckTitle={DECK_TITLE}
      ownerAccessKey={OWNER_ACCESS_KEY}
      requestExport={requestExport}
      saveExport={saveExport}
    />,
  );
  return { saveExport };
}

describe('ExportMyDataButton', () => {
  it('requests the bundle for exactly the open deck and saves it locally', async () => {
    const requestExport = vi.fn().mockResolvedValue(bundle());
    const { saveExport } = renderButton(requestExport);

    fireEvent.click(screen.getByTestId('export-my-data'));
    await waitFor(() => expect(saveExport).toHaveBeenCalledTimes(1));
    expect(requestExport).toHaveBeenCalledWith({
      deckId: DECK_ID,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(saveExport).toHaveBeenCalledWith(expect.anything(), DECK_TITLE);
  });

  it('reports what landed AND what was withheld, rather than claiming completeness', async () => {
    const { saveExport } = renderButton(vi.fn().mockResolvedValue(bundle()));
    fireEvent.click(screen.getByTestId('export-my-data'));
    await waitFor(() => expect(saveExport).toHaveBeenCalled());

    const status = screen.getByTestId('export-my-data-status').textContent ?? '';
    expect(status).toContain('12 records');
    expect(status).toContain('2 collections');
    expect(status).toContain('1 table is withheld');
    expect(status).toContain('3 secret or binary fields were removed');
    expect(status).toContain('manifest.omissions');
  });

  it('refuses a bundle scoped to a different deck instead of saving it', async () => {
    const wrongScope = bundle({
      scope: { kind: 'deck_owner_capability', deckId: 'deck_someone_else', deckVersion: 1 },
    });
    const { saveExport } = renderButton(vi.fn().mockResolvedValue(wrongScope));

    fireEvent.click(screen.getByTestId('export-my-data'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(saveExport).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('failed closed');
  });

  it('refuses a bundle that admits it is truncated', async () => {
    const truncated = bundle({
      completeness: {
        status: 'complete',
        truncated: true as unknown as false,
        recordCount: 1,
      },
    });
    const { saveExport } = renderButton(vi.fn().mockResolvedValue(truncated));

    fireEvent.click(screen.getByTestId('export-my-data'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(saveExport).not.toHaveBeenCalled();
  });

  it('surfaces a server refusal verbatim and stays usable', async () => {
    const requestExport = vi.fn().mockRejectedValue(new Error('NodeSlide owner access denied.'));
    const { saveExport } = renderButton(requestExport);

    fireEvent.click(screen.getByTestId('export-my-data'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('owner access denied');
    expect(saveExport).not.toHaveBeenCalled();
    expect((screen.getByTestId('export-my-data') as HTMLButtonElement).disabled).toBe(false);
  });

  it('is inert without an owner capability', () => {
    const requestExport = vi.fn();
    render(
      <ExportMyDataButton
        deckId={DECK_ID}
        deckTitle={DECK_TITLE}
        ownerAccessKey=""
        requestExport={requestExport}
        saveExport={vi.fn()}
      />,
    );
    const button = screen.getByTestId('export-my-data') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(requestExport).not.toHaveBeenCalled();
  });
});

describe('data export download payload', () => {
  it('names the file after the deck and the export date, not the deck id', () => {
    const payload = createNodeSlideDataExportDownloadPayload(bundle(), DECK_TITLE);
    expect(payload.fileName).toBe('series-b-narrative-nodeslide-data-2026-07-27.json');
    expect(payload.mediaType).toBe('application/json;charset=utf-8');
    expect(payload.fileName).not.toContain(DECK_ID);
  });

  it('falls back to a safe stem when the title has no usable characters', () => {
    expect(createNodeSlideDataExportDownloadPayload(bundle(), '///').fileName).toContain(
      'nodeslide-deck',
    );
  });

  it('serializes the manifest so the omissions travel with the data', () => {
    const payload = createNodeSlideDataExportDownloadPayload(bundle(), DECK_TITLE);
    const parsed = JSON.parse(payload.text) as NodeSlideOwnerDataExport;
    expect(parsed.manifest.omissions.collections[0]?.name).toBe('nodeslide_taste_profiles');
    expect(parsed.manifest.retention.serverCopyCreated).toBe(false);
  });
});
