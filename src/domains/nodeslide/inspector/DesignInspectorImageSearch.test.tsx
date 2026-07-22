// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import {
  type LicensedImageResult,
  NODESLIDE_IMAGE_SEARCH_CONSENT,
  type PatchOperation,
} from '../../../../shared/nodeslide';
import { DesignInspector, licensedImageCredit, readBoundedImageResponse } from './DesignInspector';

/*
 * Behavioural coverage for the license-aware image search in the Design
 * inspector: the section renders next to the image asset editor, clicking
 * Search sends the exact consent receipt with the query, and picking a result
 * fills alt text from the title plus a "<creator> · <license> via Openverse"
 * credit so the claim-truthful capability sync keeps exports clean.
 */

const licensedResult: LicensedImageResult = {
  id: 'ov-123',
  title: 'Wind turbines at dusk',
  thumbnailUrl: 'https://api.openverse.org/v1/images/ov-123/thumb/',
  url: 'https://live.staticflickr.com/turbines.jpg',
  license: 'BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  creator: 'Ada Fotograf',
  foreignLandingUrl: 'https://flickr.com/photos/turbines',
};

beforeAll(() => {
  // jsdom has no network. Individual success cases opt into a bounded raster;
  // the default proves that replacement fails closed instead of sending a
  // remote URL that the server-side patch contract rejects.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('jsdom has no network'))),
  );
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.mocked(fetch).mockClear();
});

function renderImageInspector(options: {
  onApplyPatch: (operations: PatchOperation[], summary: string) => void;
  onSearchImages: (
    query: string,
    consent: typeof NODESLIDE_IMAGE_SEARCH_CONSENT,
  ) => Promise<{ results: LicensedImageResult[] }>;
  onGenerateImage?: (
    prompt: string,
    aspect: 'landscape' | 'square' | 'portrait',
  ) => Promise<{ imageUrl: string; model: 'gpt-image-2'; requestId?: string }>;
}) {
  const { snapshot } = buildGoldenNodeSlide('image-search-test', 1_000);
  const imageElement = snapshot.elements.find((element) => element.kind === 'image');
  if (!imageElement) throw new Error('Golden deck fixture lost its image element.');
  imageElement.imageUrl = 'data:image/webp;base64,UklGRg==';
  imageElement.image = {
    placeholder: false,
    credit: 'Fixture asset',
    fit: 'cover',
    focalPoint: { x: 0.5, y: 0.5 },
  };
  const slide = snapshot.slides.find((candidate) => candidate.id === imageElement.slideId);
  if (!slide) throw new Error('Image element points at a missing slide.');
  return render(
    <DesignInspector
      slide={slide}
      slideElements={snapshot.elements.filter((element) => element.slideId === slide.id)}
      selectedElements={[imageElement]}
      theme={snapshot.deck.theme}
      activeTastePackId={null}
      activeProfileId={null}
      previewProfileId={null}
      profiles={[]}
      busy={false}
      onApplyTastePack={() => {}}
      onApplyProfile={undefined}
      onPreviewProfile={undefined}
      onUploadSource={undefined}
      tasteProfile={null}
      tasteProfileLoading={false}
      onEvictTasteSignal={undefined}
      onOpenPreferenceEvidence={undefined}
      onClearTastePack={() => {}}
      onApplyPatch={options.onApplyPatch}
      onSearchImages={options.onSearchImages}
      {...(options.onGenerateImage ? { onGenerateImage: options.onGenerateImage } : {})}
    />,
  );
}

describe('Design inspector licensed image search', () => {
  it('renders the consent-noted search section for image elements', () => {
    renderImageInspector({ onApplyPatch: vi.fn(), onSearchImages: vi.fn() });
    expect(screen.getByTestId('licensed-image-search')).toBeTruthy();
    expect(screen.getByText('Search licensed images')).toBeTruthy();
    expect(screen.getByText(/sends this query to Openverse \(api\.openverse\.org\)/i)).toBeTruthy();
    const button = screen.getByTestId('licensed-image-search-button');
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('sends the exact consent receipt and fills alt text plus credit on selection', async () => {
    const user = userEvent.setup();
    const onApplyPatch = vi.fn<(operations: PatchOperation[], summary: string) => void>();
    const onSearchImages = vi.fn().mockResolvedValue({ results: [licensedResult] });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(new TextEncoder().encode('bounded-openverse-raster'), {
        headers: { 'content-type': 'image/webp' },
      }),
    );
    renderImageInspector({ onApplyPatch, onSearchImages });

    await user.type(screen.getByTestId('licensed-image-query'), 'wind turbines');
    await user.click(screen.getByTestId('licensed-image-search-button'));
    expect(onSearchImages).toHaveBeenCalledWith('wind turbines', NODESLIDE_IMAGE_SEARCH_CONSENT);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('img', { name: 'Wind turbines at dusk' })).toBeNull();

    await user.click(await screen.findByTestId('licensed-image-ov-123'));
    await waitFor(() => expect(onApplyPatch).toHaveBeenCalledTimes(1));

    const [operations, summary] = onApplyPatch.mock.calls[0] ?? [[], ''];
    const update = operations.find((operation) => operation.op === 'update_image');
    if (update?.op !== 'update_image') throw new Error('Expected an update_image operation.');
    expect(update.altText).toBe('Wind turbines at dusk');
    expect(update.credit).toBe('Ada Fotograf · BY-SA 4.0 via Openverse');
    expect(update.credit).toBe(licensedImageCredit(licensedResult));
    expect(update.imageUrl).toMatch(/^data:image\/webp;base64,/u);
    expect(update.imageUrl.length).toBeLessThanOrEqual(680_000);
    expect(fetch).toHaveBeenCalledWith(licensedResult.thumbnailUrl, {
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(summary).toContain('Openverse');
  });

  it('rejects a result whose thumbnail is outside the exact Openverse API allowlist', async () => {
    const user = userEvent.setup();
    const onApplyPatch = vi.fn<(operations: PatchOperation[], summary: string) => void>();
    const hostileResult = {
      ...licensedResult,
      thumbnailUrl: 'https://tracker.example.test/thumbnail.webp',
    };
    renderImageInspector({
      onApplyPatch,
      onSearchImages: vi.fn().mockResolvedValue({ results: [hostileResult] }),
    });

    await user.type(screen.getByTestId('licensed-image-query'), 'wind turbines');
    await user.click(screen.getByTestId('licensed-image-search-button'));
    await user.click(await screen.findByTestId('licensed-image-ov-123'));

    expect(await screen.findByText(/exact API allowlist/i)).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(onApplyPatch).not.toHaveBeenCalled();
  });

  it('rejects an oversized allowlisted response before buffering its body', async () => {
    const response = new Response(new Uint8Array([1]), {
      headers: {
        'content-length': '8000001',
        'content-type': 'image/webp',
      },
    });
    await expect(readBoundedImageResponse(response)).rejects.toThrow(/smaller than 8 MB/i);
    expect(response.bodyUsed).toBe(false);
  });

  it('fails closed when the licensed raster cannot be embedded', async () => {
    const user = userEvent.setup();
    const onApplyPatch = vi.fn<(operations: PatchOperation[], summary: string) => void>();
    const onSearchImages = vi.fn().mockResolvedValue({ results: [licensedResult] });
    renderImageInspector({ onApplyPatch, onSearchImages });

    await user.type(screen.getByTestId('licensed-image-query'), 'wind turbines');
    await user.click(screen.getByTestId('licensed-image-search-button'));
    await user.click(await screen.findByTestId('licensed-image-ov-123'));

    expect(await screen.findByText(/could not embed this Openverse image/i)).toBeTruthy();
    expect(onApplyPatch).not.toHaveBeenCalled();
  });

  it('surfaces search failures honestly instead of an empty grid', async () => {
    const user = userEvent.setup();
    const onSearchImages = vi.fn().mockRejectedValue(new Error('Openverse responded with 503.'));
    renderImageInspector({ onApplyPatch: vi.fn(), onSearchImages });

    await user.type(screen.getByTestId('licensed-image-query'), 'turbines');
    await user.click(screen.getByTestId('licensed-image-search-button'));

    expect(await screen.findByText('Openverse responded with 503.')).toBeTruthy();
    expect(screen.queryByTestId('licensed-image-results')).toBeNull();
  });

  it('labels BYOK-generated assets as illustrative and non-evidentiary', async () => {
    const user = userEvent.setup();
    const onApplyPatch = vi.fn<(operations: PatchOperation[], summary: string) => void>();
    const onGenerateImage = vi.fn().mockResolvedValue({
      imageUrl: 'data:image/webp;base64,UklGRg==',
      model: 'gpt-image-2' as const,
      requestId: 'req_123',
    });
    renderImageInspector({ onApplyPatch, onSearchImages: vi.fn(), onGenerateImage });

    expect(screen.getByText(/OpenAI bills the request/i)).toBeTruthy();
    expect(screen.getByText(/is not evidence/i)).toBeTruthy();
    await user.type(
      screen.getByTestId('illustrative-image-prompt'),
      'A translucent bridge over a calm harbor',
    );
    await user.click(screen.getByTestId('illustrative-image-generate-button'));

    await waitFor(() => expect(onApplyPatch).toHaveBeenCalledTimes(1));
    expect(onGenerateImage).toHaveBeenCalledWith(
      'A translucent bridge over a calm harbor',
      expect.stringMatching(/landscape|square|portrait/),
    );
    const [operations, summary] = onApplyPatch.mock.calls[0] ?? [[], ''];
    const update = operations.find((operation) => operation.op === 'update_image');
    if (update?.op !== 'update_image') throw new Error('Expected an update_image operation.');
    expect(update.imageUrl).toBe('data:image/webp;base64,UklGRg==');
    expect(update.altText).toContain('Illustrative image:');
    expect(update.credit).toContain('AI-generated illustrative image');
    expect(update.credit).toContain('gpt-image-2');
    expect(summary).toContain('explicitly labeled illustrative image');
  });

  it('proposes reversible fit and focal-point changes without replacing the asset', async () => {
    const user = userEvent.setup();
    const onApplyPatch = vi.fn<(operations: PatchOperation[], summary: string) => void>();
    renderImageInspector({ onApplyPatch, onSearchImages: vi.fn() });

    expect(screen.getByTestId('image-framing-controls')).toBeTruthy();
    await user.selectOptions(screen.getByTestId('image-fit-select'), 'contain');

    let [operations, summary] = onApplyPatch.mock.calls[0] ?? [[], ''];
    let update = operations.find((operation) => operation.op === 'update_image');
    if (update?.op !== 'update_image') throw new Error('Expected an update_image operation.');
    expect(update).toMatchObject({
      imageUrl: 'data:image/webp;base64,UklGRg==',
      fit: 'contain',
      focalPoint: { x: 0.5, y: 0.5 },
    });
    expect(summary).toContain('framing to contain');

    onApplyPatch.mockClear();
    const focusX = screen.getByText('Focus X').closest('label')?.querySelector('input');
    if (!focusX) throw new Error('Missing Focus X input.');
    await user.clear(focusX);
    await user.type(focusX, '18');
    await user.tab();

    [operations, summary] = onApplyPatch.mock.calls[0] ?? [[], ''];
    update = operations.find((operation) => operation.op === 'update_image');
    if (update?.op !== 'update_image') throw new Error('Expected an update_image operation.');
    expect(update).toMatchObject({
      imageUrl: 'data:image/webp;base64,UklGRg==',
      fit: 'cover',
      focalPoint: { x: 0.18, y: 0.5 },
    });
    expect(summary).toContain('horizontal focal point');
  });
});
