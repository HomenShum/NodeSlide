import type { ChartData, DeckSnapshot, Slide, SlideElement, ThemeSpec } from '@nodeslide/contracts';
import { useNodeSlideDeckNavigation } from '@nodeslide/react-headless';
import { useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface NodeSlideSlideFrameProps {
  slide: Slide;
  elements: readonly SlideElement[];
  theme: ThemeSpec;
  /** Accessible name for the rendered slide. Defaults to the slide title. */
  ariaLabel?: string;
  className?: string;
  /** Optional host-owned overlay. It is never interpreted by NodeSlide. */
  children?: ReactNode;
}

/**
 * Read-only, host-neutral rendering of one normalized NodeSlide slide.
 *
 * The frame has no repository, auth, router, or provider knowledge. Every
 * renderable value comes from explicit props, and the host owns any overlay.
 */
export function NodeSlideSlideFrame({
  slide,
  elements,
  theme,
  ariaLabel = slide.title,
  className,
  children,
}: NodeSlideSlideFrameProps) {
  const orderedElements = slide.elementOrder
    .map((elementId) => elements.find((element) => element.id === elementId))
    .filter(
      (element): element is SlideElement => element !== undefined && element.visible !== false,
    );

  const themeVariables = {
    '--nodeslide-canvas': slide.background || theme.colors.canvas,
    '--nodeslide-ink': theme.colors.ink,
    '--nodeslide-muted': theme.colors.muted,
    '--nodeslide-accent': theme.colors.accent,
    '--nodeslide-accent-soft': theme.colors.accentSoft,
    '--nodeslide-border': theme.colors.border,
    '--nodeslide-radius': `${theme.defaultRadius}px`,
    '--nodeslide-font-display': theme.typography.display,
    '--nodeslide-font-body': theme.typography.body,
    '--nodeslide-font-data': theme.typography.data,
  } as CSSProperties;

  return (
    <section
      aria-label={ariaLabel}
      className={joinClassNames('nsx-slide-frame', className)}
      data-nodeslide-slide-id={slide.id}
      data-nodeslide-surface="slide-frame"
      style={themeVariables}
    >
      {orderedElements.map((element) => (
        <div
          aria-label={element.name}
          className={`nsx-slide-element nsx-slide-element--${element.kind}`}
          data-nodeslide-element-id={element.id}
          key={element.id}
          style={elementStyle(element)}
        >
          <NodeSlideElementContent element={element} theme={theme} />
        </div>
      ))}
      {children}
    </section>
  );
}

export interface NodeSlideDeckViewerProps {
  snapshot: DeckSnapshot;
  /** The host-controlled selected slide. Invalid IDs fail closed to an empty state. */
  activeSlideId: string;
  /** Required when slide navigation should be interactive. */
  onActiveSlideChange?: (slideId: string) => void;
  className?: string;
  previousSlideLabel?: string;
  nextSlideLabel?: string;
  unavailableLabel?: string;
}

/** A controlled, read-only deck viewer with accessible keyboard navigation. */
export function NodeSlideDeckViewer({
  snapshot,
  activeSlideId,
  onActiveSlideChange,
  className,
  previousSlideLabel = 'Previous slide',
  nextSlideLabel = 'Next slide',
  unavailableLabel = 'The selected slide is unavailable.',
}: NodeSlideDeckViewerProps) {
  const slideTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const navigation = useNodeSlideDeckNavigation({
    snapshot,
    activeSlideId,
    onActiveSlideChange,
    onFocusRequest: (slideId) => slideTabRefs.current.get(slideId)?.focus(),
  });
  const { activeIndex, activeSlide, orderedSlides } = navigation;

  return (
    <section
      aria-label={`${snapshot.deck.title} presentation`}
      className={joinClassNames('nsx-deck-viewer', className)}
      data-nodeslide-surface="deck-viewer"
    >
      <header className="nsx-deck-header">
        <div>
          <p className="nsx-eyebrow">Presentation</p>
          <h2>{snapshot.deck.title}</h2>
        </div>
        <p aria-live="polite" className="nsx-page-status">
          {activeSlide ? `${activeIndex + 1} of ${orderedSlides.length}` : 'No slide selected'}
        </p>
      </header>

      <div
        {...navigation.getPanelProps()}
        aria-label={activeSlide?.title ?? 'Selected slide'}
        className="nsx-slide-stage"
      >
        {activeSlide ? (
          <NodeSlideSlideFrame
            slide={activeSlide}
            elements={snapshot.elements.filter((element) => element.slideId === activeSlide.id)}
            theme={snapshot.deck.theme}
          />
        ) : (
          <output className="nsx-empty-state">{unavailableLabel}</output>
        )}
      </div>

      <nav aria-label="Slide navigation" className="nsx-deck-navigation">
        <button
          aria-label={previousSlideLabel}
          disabled={!navigation.canNavigate}
          onClick={navigation.previous}
          type="button"
        >
          Previous
        </button>
        <div aria-label="Choose a slide" className="nsx-slide-tabs" role="tablist">
          {orderedSlides.map((slide, index) => {
            const tabProps = navigation.getTabProps(slide.id);
            return (
              <button
                {...tabProps}
                key={slide.id}
                ref={(element) => {
                  if (element) slideTabRefs.current.set(slide.id, element);
                  else slideTabRefs.current.delete(slide.id);
                }}
                type="button"
              >
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span>{slide.title}</span>
              </button>
            );
          })}
        </div>
        <button
          aria-label={nextSlideLabel}
          disabled={!navigation.canNavigate}
          onClick={navigation.next}
          type="button"
        >
          Next
        </button>
      </nav>
    </section>
  );
}

function NodeSlideElementContent({ element, theme }: { element: SlideElement; theme: ThemeSpec }) {
  if (element.kind === 'image') {
    if (element.imageUrl) {
      return (
        <img
          alt={element.altText ?? element.name}
          className="nsx-element-media"
          draggable={false}
          src={element.imageUrl}
        />
      );
    }
    return (
      <span
        className="nsx-element-placeholder"
        role="img"
        aria-label={element.altText ?? element.name}
      >
        {element.altText ?? 'Image placeholder'}
      </span>
    );
  }

  if (element.kind === 'video') {
    if (!element.video?.url)
      return <span className="nsx-element-placeholder">Video unavailable</span>;
    return (
      // biome-ignore lint/a11y/useMediaCaption: a captions track is included whenever the deck declares one.
      <video
        aria-label={element.video.title ?? element.altText ?? element.name}
        className="nsx-element-media"
        controls
        poster={element.video.posterUrl}
        preload="metadata"
        src={mediaFragmentUrl(
          element.video.url,
          element.video.startAtSeconds,
          element.video.endAtSeconds,
        )}
      >
        {element.video.captionsUrl ? (
          <track
            default
            kind="captions"
            src={element.video.captionsUrl}
            srcLang={element.video.captionsLanguage ?? 'en'}
          />
        ) : null}
      </video>
    );
  }

  if (element.kind === 'chart' && element.chart) {
    return (
      <NodeSlideChart chart={element.chart} accent={element.style.color ?? theme.colors.accent} />
    );
  }

  if (element.kind === 'math') {
    const expression = element.math?.display ?? element.math?.expression ?? element.content ?? '';
    return (
      <div aria-label={element.math?.description ?? `${element.name}: ${expression}`} role="math">
        <code>{expression}</code>
      </div>
    );
  }

  if (element.kind === 'connector') {
    return (
      <svg aria-hidden="true" className="nsx-element-connector" viewBox="0 0 100 10">
        <line x1="1" x2="95" y1="5" y2="5" />
        <path d="M95 1 L100 5 L95 9 Z" />
      </svg>
    );
  }

  return <span>{element.content}</span>;
}

function NodeSlideChart({ chart, accent }: { chart: ChartData; accent: string }) {
  const max = Math.max(
    1,
    ...chart.series.flatMap((series) => series.values.map((value) => Math.abs(value))),
  );
  const summary = chart.series
    .map((series) => `${series.name}: ${series.values.join(', ')}`)
    .join('; ');
  return (
    <div
      aria-label={`${chart.chartType} chart. ${summary}${chart.unit ? ` ${chart.unit}` : ''}`}
      className="nsx-chart"
      role="img"
    >
      {chart.series.map((series, seriesIndex) => (
        <div className="nsx-chart-series" key={`${series.name}-${seriesIndex}`}>
          <span>{series.name}</span>
          <div className="nsx-chart-values">
            {series.values.map((value, valueIndex) => (
              <span
                aria-hidden="true"
                className="nsx-chart-value"
                key={`${chart.labels[valueIndex] ?? 'value'}-${valueIndex}`}
                style={{
                  background: series.color ?? accent,
                  blockSize: `${Math.max(4, (Math.abs(value) / max) * 100)}%`,
                }}
                title={`${chart.labels[valueIndex] ?? valueIndex + 1}: ${value}`}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function elementStyle(element: SlideElement): CSSProperties {
  const style = element.style;
  return {
    alignItems:
      style.verticalAlign === 'middle'
        ? 'center'
        : style.verticalAlign === 'bottom'
          ? 'flex-end'
          : 'flex-start',
    background: style.fill,
    borderColor: style.stroke,
    borderRadius: style.radius === undefined ? undefined : `${style.radius / 12.8}cqw`,
    borderStyle: style.stroke ? 'solid' : undefined,
    borderWidth: style.strokeWidth,
    boxShadow: style.shadow,
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize === undefined ? undefined : `${style.fontSize / 12.8}cqw`,
    fontWeight: style.fontWeight,
    height: `${element.bbox.height * 100}%`,
    justifyContent:
      style.textAlign === 'center'
        ? 'center'
        : style.textAlign === 'right'
          ? 'flex-end'
          : 'flex-start',
    left: `${element.bbox.x * 100}%`,
    letterSpacing:
      style.letterSpacing === undefined ? undefined : `${style.letterSpacing / 12.8}cqw`,
    lineHeight: style.lineHeight,
    opacity: style.opacity,
    padding: style.padding === undefined ? undefined : `${style.padding / 12.8}cqw`,
    textAlign: style.textAlign,
    top: `${element.bbox.y * 100}%`,
    transform: `rotate(${element.rotation}deg)`,
    width: `${element.bbox.width * 100}%`,
  };
}

function mediaFragmentUrl(url: string, start?: number, end?: number): string {
  if (start === undefined && end === undefined) return url;
  const from = Math.max(0, start ?? 0);
  const fragment = `t=${from}${end === undefined ? '' : `,${Math.max(from, end)}`}`;
  return `${url.split('#')[0]}#${fragment}`;
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
