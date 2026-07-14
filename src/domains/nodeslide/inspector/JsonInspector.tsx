import { type CSSProperties, useMemo, useState } from 'react';
import type { DeckPatch, DeckSnapshot, Slide, SlideElement } from '../../../../shared/nodeslide';
import { downloadDeckJson } from '../slidelang/download';

export type DeckJsonMode = 'deck' | 'slide' | 'selection' | 'patch';

export interface DeckJsonContext {
  snapshot: DeckSnapshot;
  slide: Slide;
  selectedElements: readonly SlideElement[];
  patches: readonly DeckPatch[];
}

/**
 * The value serialized for each view mode. Pure so it can be unit-tested and so
 * the rendered JSON, the Copy payload, and the Download payload never diverge.
 * Returns `null` for the empty states (nothing selected / no proposals yet).
 */
export function deckJsonView(mode: DeckJsonMode, ctx: DeckJsonContext): unknown {
  switch (mode) {
    case 'deck':
      return ctx.snapshot;
    case 'slide':
      return {
        slide: ctx.slide,
        elements: ctx.snapshot.elements.filter((element) => element.slideId === ctx.slide.id),
      };
    case 'selection':
      return ctx.selectedElements.length > 0 ? [...ctx.selectedElements] : null;
    case 'patch':
      return ctx.patches.at(-1) ?? null;
  }
}

export function serializeDeckJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const MODES: ReadonlyArray<{ id: DeckJsonMode; label: string }> = [
  { id: 'deck', label: 'Deck' },
  { id: 'slide', label: 'Slide' },
  { id: 'selection', label: 'Selection' },
  { id: 'patch', label: 'Last patch' },
];

// Cap the *rendered* string so a very large deck cannot freeze the panel.
// Copy and Download always use the full JSON.
const RENDER_CAP = 200_000;

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  padding: '0 var(--ns-space-4, 12px) var(--ns-space-3, 8px)',
};

const chipStyle = (active: boolean): CSSProperties => ({
  font: 'inherit',
  fontSize: 11,
  fontWeight: 600,
  padding: '4px 10px',
  borderRadius: 'var(--ns-radius-pill, 999px)',
  border: '1px solid var(--ns-border, rgba(0,0,0,0.12))',
  background: active ? 'var(--ns-accent, #4f46e5)' : 'transparent',
  color: active ? 'var(--ns-on-accent, #fff)' : 'var(--ns-text, inherit)',
  cursor: 'pointer',
});

const actionStyle: CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  padding: '5px 12px',
  borderRadius: 'var(--ns-radius, 8px)',
  border: '1px solid var(--ns-border, rgba(0,0,0,0.12))',
  background: 'var(--ns-surface, rgba(0,0,0,0.03))',
  color: 'var(--ns-text, inherit)',
  cursor: 'pointer',
};

const preStyle: CSSProperties = {
  margin: '0 var(--ns-space-4, 12px) var(--ns-space-4, 12px)',
  padding: 'var(--ns-space-3, 10px)',
  maxHeight: '58vh',
  overflow: 'auto',
  whiteSpace: 'pre',
  fontFamily: `var(--ns-font-mono, ui-monospace, 'JetBrains Mono', 'SFMono-Regular', monospace)`,
  fontSize: 11,
  lineHeight: 1.5,
  borderRadius: 'var(--ns-radius, 8px)',
  border: '1px solid var(--ns-border, rgba(0,0,0,0.12))',
  background: 'var(--ns-surface-sunken, rgba(0,0,0,0.03))',
  color: 'var(--ns-text, inherit)',
};

export interface JsonInspectorProps {
  snapshot: DeckSnapshot;
  slide: Slide;
  selectedElements: readonly SlideElement[];
  patches: readonly DeckPatch[];
}

export function JsonInspector({ snapshot, slide, selectedElements, patches }: JsonInspectorProps) {
  const [mode, setMode] = useState<DeckJsonMode>('deck');

  const view = useMemo(
    () => deckJsonView(mode, { snapshot, slide, selectedElements, patches }),
    [mode, snapshot, slide, selectedElements, patches],
  );
  const json = useMemo(() => (view === null ? '' : serializeDeckJson(view)), [view]);
  const shown =
    json.length > RENDER_CAP
      ? `${json.slice(0, RENDER_CAP)}\n… (${json.length - RENDER_CAP} more characters — use Download for the full file)`
      : json;

  const copy = () => {
    if (json && typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(json);
    }
  };

  return (
    <div className="ns-inspector-scroll ns-json-inspector">
      <section className="ns-inspector-section">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Deck as code</span>
            <h2>JSON</h2>
          </div>
          <span className="ns-count-pill">{snapshot.slides.length}</span>
        </div>
        <p>
          The canonical <code>nodeslide.slidelang/v1</code> DeckSpec — {snapshot.slides.length}{' '}
          slides · {snapshot.elements.length} elements. Read-only; edits still flow through the
          validated propose → accept path.
        </p>
      </section>

      <div style={rowStyle} role="tablist" aria-label="JSON view">
        {MODES.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={mode === option.id}
            onClick={() => setMode(option.id)}
            style={chipStyle(mode === option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div style={rowStyle}>
        <button type="button" onClick={copy} disabled={!json} style={actionStyle}>
          Copy
        </button>
        <button type="button" onClick={() => downloadDeckJson(snapshot)} style={actionStyle}>
          Download deck.json
        </button>
      </div>

      {json ? (
        <pre className="ns-json-view" style={preStyle}>
          {shown}
        </pre>
      ) : (
        <div className="ns-empty-state ns-empty-state--compact" style={{ margin: '0 12px 12px' }}>
          <span>
            {mode === 'selection'
              ? 'Select one or more elements on the canvas to see their JSON.'
              : 'No agent proposal yet — the last patch will appear here once one is created.'}
          </span>
        </div>
      )}
    </div>
  );
}
