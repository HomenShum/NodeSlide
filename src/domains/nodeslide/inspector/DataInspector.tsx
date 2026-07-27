import {
  BarChart3,
  Calculator,
  Database,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
  Quote,
  Sheet,
  StickyNote,
  Trash2,
  Unlink,
} from 'lucide-react';
import { useState } from 'react';
import type { Slide, SlideElement, SourceRecord } from '../../../../shared/nodeslide';
import {
  boundSourceIds,
  evidenceBindingCoverage,
  evidenceClaimTerms,
  highlightExcerpt,
} from '../../../../shared/nodeslideEvidence';
import { ExportMyDataAction } from './ExportMyDataAction';

/**
 * Data-rights wiring for the deck currently open. Absent for share-link and
 * approver views, which hold no owner capability — the section is not rendered
 * at all rather than rendered disabled.
 */
export interface DataInspectorDataRights {
  deckId: string;
  deckTitle: string;
  ownerAccessKey: string;
  onRequestDelete: () => void;
}

interface DataInspectorProps {
  sources: readonly SourceRecord[];
  selectedElements: readonly SlideElement[];
  /** All deck elements, for claim -> source -> element lineage. */
  elements?: readonly SlideElement[];
  /** All deck slides, to label where a citing element lives. */
  slides?: readonly Slide[];
  /** Selects a citing element on its slide (canvas selection callback). */
  onSelectElement?: (slideId: string, elementId: string) => void;
  onDeleteSource?: (sourceId: string) => Promise<void>;
  /** Owner-only export/erase controls. Omitted when there is no owner capability. */
  dataRights?: DataInspectorDataRights;
}

function elementCitesSource(element: SlideElement, sourceId: string): boolean {
  return boundSourceIds(element).includes(sourceId);
}

export function DataInspector({
  sources,
  selectedElements,
  elements,
  slides,
  onSelectElement,
  onDeleteSource,
  dataRights,
}: DataInspectorProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [openSnapshot, setOpenSnapshot] = useState<{
    sourceId: string;
    elementId?: string;
  } | null>(null);
  const [unsourcedCollapsed, setUnsourcedCollapsed] = useState(false);
  const dependencyIds = new Set(selectedElements.flatMap(boundSourceIds));
  const dependencies = sources.filter((source) => dependencyIds.has(source.id));
  const coverage = evidenceBindingCoverage(elements ?? []);
  const unsourcedOpen = coverage.unsourced.length > 0 && !unsourcedCollapsed;
  const structuredElements = selectedElements.filter(
    (element) => element.kind === 'chart' || element.kind === 'math' || element.kind === 'image',
  );

  return (
    <div className="ns-inspector-scroll ns-data-inspector">
      <section className="ns-inspector-section">
        <div className="ns-section-title-row">
          <div>
            <span className="ns-eyebrow">Evidence layer</span>
            <h2>Data & sources</h2>
          </div>
          <span className="ns-count-pill">{sources.length}</span>
        </div>
        <p>
          Citations stay attached to canonical elements and travel with exported artifacts.
          NodeSlide checks attachment and disclosure; it does not independently verify facts.
        </p>
        {elements ? (
          <div className="ns-evidence-coverage" data-testid="evidence-coverage">
            <span>
              <span>Claims</span>
              <strong>{coverage.claims}</strong>
            </span>
            <span>
              <span>Bound</span>
              <strong>{coverage.bound}</strong>
            </span>
            <button
              type="button"
              className="ns-evidence-unsourced-toggle"
              data-testid="evidence-unsourced-toggle"
              disabled={coverage.unsourced.length === 0}
              aria-expanded={unsourcedOpen}
              aria-controls="nodeslide-unsourced-claims"
              aria-label={`${coverage.unsourced.length} unsourced ${coverage.unsourced.length === 1 ? 'claim' : 'claims'}`}
              onClick={() => setUnsourcedCollapsed(unsourcedOpen)}
            >
              <span>Unsourced</span>
              <strong data-testid="evidence-unsourced-count">{coverage.unsourced.length}</strong>
            </button>
          </div>
        ) : null}
      </section>

      {unsourcedOpen ? (
        <section
          className="ns-unsourced-claims"
          id="nodeslide-unsourced-claims"
          data-testid="evidence-unsourced-list"
        >
          <div className="ns-section-heading">
            <span>Not yet bound to a source</span>
            <small>{coverage.unsourced.length}</small>
          </div>
          <div className="ns-evidence-citing">
            {coverage.unsourced.map((element) => {
              const slideTitle = slides?.find(
                (candidate) => candidate.id === element.slideId,
              )?.title;
              return (
                <button
                  type="button"
                  key={element.id}
                  className="ns-evidence-citing-element is-unsourced"
                  data-testid="evidence-unsourced-element"
                  disabled={!onSelectElement}
                  onClick={() => onSelectElement?.(element.slideId, element.id)}
                  aria-label={`Select unsourced claim ${element.name}${slideTitle ? ` on ${slideTitle}` : ''}`}
                >
                  <Unlink size={11} /> {element.name}
                  {slideTitle ? <em> · {slideTitle}</em> : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {selectedElements.length > 0 ? (
        <section className="ns-dependency-card">
          <div className="ns-section-heading">
            <span>
              <Link2 size={13} /> Selection dependencies
            </span>
            <small>{dependencies.length}</small>
          </div>
          {dependencies.length > 0 ? (
            dependencies.map((source) => (
              <div key={source.id}>
                <SourceIcon type={source.sourceType} />
                <span>
                  <strong>{source.title}</strong>
                  <small>{source.citation}</small>
                </span>
              </div>
            ))
          ) : (
            <p>
              No source records are attached to{' '}
              {selectedElements.length === 1 ? 'this element' : 'these elements'}.
            </p>
          )}
        </section>
      ) : null}

      {structuredElements.length > 0 ? (
        <section className="ns-dependency-card ns-primitive-card">
          <div className="ns-section-heading">
            <span>
              <Database size={13} /> Structured primitive
            </span>
            <small>{structuredElements.length}</small>
          </div>
          {structuredElements.map((element) => (
            <PrimitiveDetails element={element} key={element.id} />
          ))}
        </section>
      ) : null}

      <section className="ns-source-list">
        <div className="ns-section-heading">
          <span>Source records</span>
          <small>{sources.length} total</small>
        </div>
        {sources.length === 0 ? (
          <div className="ns-empty-state ns-empty-state--compact">
            <span>
              <Database size={17} />
            </span>
            <strong>No sources yet</strong>
            <p>Sources cited by agents or imports will be recorded here.</p>
          </div>
        ) : (
          sources.map((source) => {
            const citingElements = (elements ?? []).filter((element) =>
              elementCitesSource(element, source.id),
            );
            const excerpt =
              source.citation.length > 420 ? `${source.citation.slice(0, 420)}…` : source.citation;
            const isWebExcerpt = source.format === 'web';
            const captureFailed = source.status === 'failed';
            const snapshot = source.snapshot?.kind === 'search_excerpt' ? source.snapshot : null;
            const claimTerms = isWebExcerpt
              ? evidenceClaimTerms(
                  [...citingElements, ...selectedElements].map((element) => element.content ?? ''),
                  excerpt,
                )
              : [];
            const snapshotIsOpen = snapshot !== null && openSnapshot?.sourceId === source.id;
            const snapshotElement = snapshotIsOpen
              ? citingElements.find((element) => element.id === openSnapshot.elementId)
              : undefined;
            const snapshotTerms = snapshot
              ? evidenceClaimTerms(
                  snapshotElement
                    ? [snapshotElement.content ?? '']
                    : citingElements.map((element) => element.content ?? ''),
                  snapshot.text,
                )
              : [];
            return (
              <article key={source.id} className={dependencyIds.has(source.id) ? 'is-linked' : ''}>
                <span className="ns-source-icon">
                  <SourceIcon type={source.sourceType} />
                </span>
                <div>
                  <div>
                    <strong>{source.title}</strong>
                    <span>{source.sourceType}</span>
                  </div>
                  <blockquote data-testid="evidence-excerpt">
                    <Quote size={11} />
                    {isWebExcerpt && claimTerms.length > 0
                      ? highlightExcerpt(excerpt, claimTerms).map((segment, index) =>
                          segment.highlighted ? (
                            <mark
                              className="ns-evidence-highlight"
                              data-testid="evidence-highlight"
                              // biome-ignore lint/suspicious/noArrayIndexKey: segments are static per render
                              key={index}
                            >
                              {segment.text}
                            </mark>
                          ) : (
                            // biome-ignore lint/suspicious/noArrayIndexKey: segments are static per render
                            <span key={index}>{segment.text}</span>
                          ),
                        )
                      : excerpt}
                  </blockquote>
                  {isWebExcerpt ? (
                    captureFailed ? (
                      <small
                        className="ns-evidence-capture-note"
                        data-testid="evidence-capture-failed"
                      >
                        Capture failed — the stored excerpt may be stale. Open the source to verify.
                      </small>
                    ) : snapshot ? (
                      <button
                        type="button"
                        className="ns-evidence-snapshot-toggle"
                        data-testid="evidence-snapshot-toggle"
                        aria-expanded={snapshotIsOpen}
                        onClick={() =>
                          setOpenSnapshot(snapshotIsOpen ? null : { sourceId: source.id })
                        }
                      >
                        {snapshotIsOpen ? 'Close' : 'Open'} retrieved excerpt snapshot
                      </button>
                    ) : (
                      <small
                        className="ns-evidence-capture-note"
                        data-testid="evidence-no-snapshot"
                      >
                        Text excerpt · no visual snapshot
                      </small>
                    )
                  ) : null}
                  {snapshotIsOpen && snapshot ? (
                    <section
                      className="ns-evidence-snapshot"
                      data-testid="evidence-snapshot-region"
                      aria-label={`Retrieved excerpt snapshot for ${source.title}`}
                    >
                      <header>
                        <strong>Retrieved excerpt snapshot</strong>
                        <small>
                          Captured {formatDate(snapshot.capturedAt)} ·{' '}
                          {snapshot.contentDigest.slice(0, 18)}…
                        </small>
                      </header>
                      <blockquote>
                        {snapshotTerms.length > 0
                          ? highlightExcerpt(snapshot.text, snapshotTerms).map((segment, index) =>
                              segment.highlighted ? (
                                <mark
                                  className="ns-evidence-highlight"
                                  data-testid="evidence-snapshot-highlight"
                                  data-element-id={snapshotElement?.id}
                                  // biome-ignore lint/suspicious/noArrayIndexKey: immutable snapshot segments
                                  key={index}
                                >
                                  {segment.text}
                                </mark>
                              ) : (
                                // biome-ignore lint/suspicious/noArrayIndexKey: immutable snapshot segments
                                <span key={index}>{segment.text}</span>
                              ),
                            )
                          : snapshot.text}
                      </blockquote>
                      <small data-testid="evidence-snapshot-binding">
                        {snapshotElement
                          ? `Claim region bound to ${snapshotElement.name}.`
                          : snapshotTerms.length > 0
                            ? `Claim regions from ${citingElements.length} citing element${citingElements.length === 1 ? '' : 's'}.`
                            : 'No citing claim terms overlap this captured excerpt.'}
                      </small>
                      <small>
                        This is the immutable excerpt returned by{' '}
                        {source.provider ?? 'the search provider'}, not a photograph of the
                        third-party page.
                      </small>
                    </section>
                  ) : null}
                  {source.format || source.rowCount !== undefined || source.columns?.length ? (
                    <div className="ns-source-metadata" aria-label={`${source.title} data shape`}>
                      {source.format ? <span>{source.format.toUpperCase()}</span> : null}
                      {source.rowCount !== undefined ? (
                        <span>{source.rowCount.toLocaleString()} rows</span>
                      ) : null}
                      {source.byteSize !== undefined ? (
                        <span>{formatBytes(source.byteSize)}</span>
                      ) : null}
                      {source.columns?.slice(0, 6).map((column) => (
                        <span key={column}>{column}</span>
                      ))}
                    </div>
                  ) : null}
                  <small>
                    Retrieved {formatDate(source.retrievedAt)}
                    {source.license ? ` · ${source.license}` : ''}
                  </small>
                  {elements ? (
                    <div className="ns-evidence-citing" data-testid="evidence-citing-list">
                      {citingElements.length > 0 ? (
                        <>
                          <small>
                            Cited by {citingElements.length}{' '}
                            {citingElements.length === 1 ? 'element' : 'elements'}
                          </small>
                          {citingElements.map((element) => {
                            const slideTitle = slides?.find(
                              (candidate) => candidate.id === element.slideId,
                            )?.title;
                            return (
                              <button
                                type="button"
                                key={element.id}
                                className="ns-evidence-citing-element"
                                data-testid="evidence-citing-element"
                                disabled={!onSelectElement && !snapshot}
                                onClick={() => {
                                  if (snapshot) {
                                    setOpenSnapshot({ sourceId: source.id, elementId: element.id });
                                  }
                                  onSelectElement?.(element.slideId, element.id);
                                }}
                                aria-label={`${snapshot ? 'Open source snapshot region and ' : ''}select ${element.name}${slideTitle ? ` on ${slideTitle}` : ''}`}
                              >
                                <Link2 size={11} /> {element.name}
                                {slideTitle ? <em> · {slideTitle}</em> : null}
                              </button>
                            );
                          })}
                        </>
                      ) : (
                        <small data-testid="evidence-no-citations">
                          No elements cite this source yet.
                        </small>
                      )}
                    </div>
                  ) : null}
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      Open source <ExternalLink size={11} />
                    </a>
                  ) : null}
                  {source.retention === 'until_deleted' && onDeleteSource ? (
                    <button
                      type="button"
                      className="ns-source-delete"
                      disabled={deletingId === source.id}
                      onClick={() => {
                        setDeleteError(null);
                        setDeletingId(source.id);
                        void onDeleteSource(source.id)
                          .catch((error) =>
                            setDeleteError(
                              error instanceof Error
                                ? error.message
                                : 'The source could not be deleted.',
                            ),
                          )
                          .finally(() => setDeletingId(null));
                      }}
                      aria-label={`Delete private source ${source.title}`}
                    >
                      <Trash2 size={12} /> {deletingId === source.id ? 'Deleting…' : 'Delete data'}
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
        {deleteError ? <output role="alert">{deleteError}</output> : null}
      </section>

      {dataRights ? (
        <section
          className="ns-inspector-section ns-data-rights"
          data-testid="deck-data-rights"
          aria-label="Your data"
        >
          <div className="ns-section-title-row">
            <div>
              <span className="ns-eyebrow">Your data</span>
              <h2>Export or erase this deck</h2>
            </div>
          </div>
          <p>
            The export hands back every record this deck owns, and names what it withholds in its
            own manifest. Deletion removes exactly the same set, permanently, with no server copy
            retained.
          </p>
          <ExportMyDataAction
            deckId={dataRights.deckId}
            deckTitle={dataRights.deckTitle}
            ownerAccessKey={dataRights.ownerAccessKey}
          />
          <button
            type="button"
            className="ns-button ns-button--danger ns-delete-deck-trigger"
            data-testid="delete-deck-open"
            onClick={dataRights.onRequestDelete}
          >
            <Trash2 size={14} /> Delete this deck
          </button>
        </section>
      ) : null}
    </div>
  );
}

function PrimitiveDetails({ element }: { element: SlideElement }) {
  if (element.kind === 'chart' && element.chart) {
    return (
      <div>
        <BarChart3 size={15} />
        <span>
          <strong>{element.chart.chartType} chart · editable data</strong>
          <small>
            {element.chart.labels
              .map((label, index) => `${label}: ${element.chart?.series[0]?.values[index] ?? '—'}`)
              .join(' · ')}
          </small>
        </span>
      </div>
    );
  }
  if (element.kind === 'math' && element.math) {
    return (
      <div>
        <Calculator size={15} />
        <span>
          <strong>{element.math.display ?? element.math.expression}</strong>
          <small>
            expression: {element.math.expression}
            {(element.math.variables ?? []).length > 0
              ? ` · ${(element.math.variables ?? [])
                  .map(
                    (variable) =>
                      `${variable.label}=${variable.value}${variable.unit ? ` ${variable.unit}` : ''}`,
                  )
                  .join(' · ')}`
              : ''}
          </small>
        </span>
      </div>
    );
  }
  if (element.kind === 'image') {
    return (
      <div>
        <ImageIcon size={15} />
        <span>
          <strong>
            {element.image?.placeholder ? 'Replace-image placeholder' : 'Image asset'}
          </strong>
          <small>
            {element.altText ?? element.name}
            {element.image?.credit ? ` · ${element.image.credit}` : ''}
          </small>
        </span>
      </div>
    );
  }
  return null;
}

function SourceIcon({ type }: { type: SourceRecord['sourceType'] }) {
  if (type === 'spreadsheet') return <Sheet size={15} />;
  if (type === 'note') return <StickyNote size={15} />;
  if (type === 'url') return <Link2 size={15} />;
  return <FileText size={15} />;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(timestamp);
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
