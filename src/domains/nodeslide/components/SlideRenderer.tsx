import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useState } from 'react';
import type { ChartData, Slide, SlideElement, ThemeSpec } from '../../../../shared/nodeslide';
import { isEmbeddedImageData } from '../slidelang/utils';
import { typesetMathHtml } from './mathTypeset';

interface SlideRendererProps {
  slide: Slide;
  elements: readonly SlideElement[];
  theme: ThemeSpec;
  className?: string;
  children?: ReactNode;
  elementClassName?: string;
  getElementStyle?: (element: SlideElement) => CSSProperties | undefined;
  isElementSelected?: (element: SlideElement) => boolean;
  onElementKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>, element: SlideElement) => void;
  onElementPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, element: SlideElement) => void;
  onElementDoubleClick?: (event: ReactMouseEvent<HTMLDivElement>, element: SlideElement) => void;
  renderElementContent?: (element: SlideElement, defaultContent: ReactNode) => ReactNode;
}

export function SlideRenderer({
  slide,
  elements,
  theme,
  className = '',
  children,
  elementClassName = '',
  getElementStyle,
  isElementSelected,
  onElementKeyDown,
  onElementPointerDown,
  onElementDoubleClick,
  renderElementContent,
}: SlideRendererProps) {
  const orderedElements = slide.elementOrder
    .map((id) => elements.find((element) => element.id === id))
    .filter(
      (element): element is SlideElement => element !== undefined && element.visible !== false,
    );

  return (
    <div
      className={`ns-slide-renderer ${className}`.trim()}
      style={
        {
          '--ns-theme-canvas': slide.background || theme.colors.canvas,
          '--ns-theme-ink': theme.colors.ink,
          '--ns-theme-muted': theme.colors.muted,
          '--ns-theme-accent': theme.colors.accent,
        } as CSSProperties
      }
      data-slide-id={slide.id}
    >
      {orderedElements.map((element) => (
        <div
          className={`ns-slide-element ns-slide-element--${element.kind} ${elementClassName}`.trim()}
          data-element-id={element.id}
          data-testid={`slide-element-${element.id}`}
          key={element.id}
          aria-label={
            onElementKeyDown
              ? `${element.name}, ${element.kind} slide element${element.locked ? ', locked' : ''}`
              : undefined
          }
          aria-pressed={onElementKeyDown ? Boolean(isElementSelected?.(element)) : undefined}
          onKeyDown={onElementKeyDown ? (event) => onElementKeyDown(event, element) : undefined}
          onPointerDown={
            onElementPointerDown ? (event) => onElementPointerDown(event, element) : undefined
          }
          onDoubleClick={
            onElementDoubleClick ? (event) => onElementDoubleClick(event, element) : undefined
          }
          role={onElementKeyDown ? 'button' : undefined}
          style={{
            left: `${element.bbox.x * 100}%`,
            top: `${element.bbox.y * 100}%`,
            width: `${element.bbox.width * 100}%`,
            height: `${element.bbox.height * 100}%`,
            transform: `rotate(${element.rotation}deg)`,
            ...elementVisualStyle(element),
            ...getElementStyle?.(element),
          }}
          tabIndex={onElementKeyDown ? 0 : undefined}
        >
          {renderElementContent?.(element, <ElementContent element={element} theme={theme} />) ?? (
            <ElementContent element={element} theme={theme} />
          )}
        </div>
      ))}
      {children}
    </div>
  );
}

function ElementContent({ element, theme }: { element: SlideElement; theme: ThemeSpec }) {
  if (element.kind === 'image') {
    return isEmbeddedImageData(element.imageUrl) ? (
      <img
        className="ns-element-image"
        src={element.imageUrl}
        alt={element.altText ?? element.name}
        draggable={false}
        style={{
          objectFit: element.image?.fit ?? 'cover',
          objectPosition: `${(element.image?.focalPoint?.x ?? 0.5) * 100}% ${(element.image?.focalPoint?.y ?? 0.5) * 100}%`,
        }}
      />
    ) : (
      <div
        className="ns-element-image-placeholder"
        role="img"
        aria-label={element.altText ?? element.name}
      >
        <strong>{element.altText ?? 'Image'}</strong>
        <span>Replace image</span>
        {element.image?.credit ? <small>{element.image.credit}</small> : null}
      </div>
    );
  }

  if (element.kind === 'chart' && element.chart) {
    return (
      <ChartGraphic
        chart={element.chart}
        accent={element.style.color ?? theme.colors.accent}
        theme={theme}
      />
    );
  }

  if (element.kind === 'math') {
    const expression = element.math?.expression ?? element.content ?? '';
    const display = element.math?.display ?? expression;
    const variables = element.math?.variables ?? [];
    // C1: real typesetting for latex syntax, and for plain expressions that
    // happen to parse as TeX. C3: null (parse failure) falls back to the
    // existing styled-text rendering below — no crash, no error markup.
    const katexHtml =
      element.math?.syntax === 'latex' || expression.trim().length > 0
        ? typesetMathHtml(expression)
        : null;
    return (
      <div
        className={`ns-element-math ns-math-primitive ns-element-math--${element.math?.syntax ?? 'plain'}`}
        role="math"
        aria-label={element.math?.description ?? `${element.name}: ${display}`}
      >
        {katexHtml ? (
          <span
            className="ns-math-typeset"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: markup is generated locally by KaTeX from the deck's own expression, not remote content.
            dangerouslySetInnerHTML={{ __html: katexHtml }}
          />
        ) : (
          <code>{display}</code>
        )}
        {variables.length > 0 ? (
          <small>
            {variables
              .map(
                (variable) =>
                  `${variable.label} = ${variable.value}${variable.unit ? ` ${variable.unit}` : ''}`,
              )
              .join(' · ')}
          </small>
        ) : null}
        {element.math?.syntax === 'latex' && !katexHtml ? <small>LaTeX source</small> : null}
      </div>
    );
  }

  if (element.kind === 'video') {
    return <ConsentBoundVideo element={element} />;
  }

  if (element.kind === 'connector') {
    return (
      <svg
        className="ns-element-connector"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <marker
            id={`arrow-${element.id}`}
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
          </marker>
        </defs>
        <line
          x1="3"
          y1="50"
          x2="94"
          y2="50"
          vectorEffect="non-scaling-stroke"
          markerEnd={`url(#arrow-${element.id})`}
        />
      </svg>
    );
  }

  return <span className="ns-element-copy">{element.content}</span>;
}

function ConsentBoundVideo({ element }: { element: SlideElement }) {
  const [allowedMediaKey, setAllowedMediaKey] = useState<string | null>(null);
  const video = element.video;
  const label = video?.title ?? element.altText ?? element.name;
  if (!video?.url) {
    return (
      <div className="ns-element-video-placeholder" role="img" aria-label={label}>
        <span>Video unavailable</span>
      </div>
    );
  }
  const mediaKey = consentBoundMediaKey(video);
  if (allowedMediaKey !== mediaKey) {
    return (
      <button
        className="ns-element-video-placeholder"
        type="button"
        aria-label={`Load remote video: ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          setAllowedMediaKey(mediaKey);
        }}
      >
        <strong>{label}</strong>
        <span>Load remote video</span>
      </button>
    );
  }
  return (
    // biome-ignore lint/a11y/useMediaCaption: The structured captions track is rendered when the deck supplies one; silent and illustrative clips may omit it.
    <video
      className="ns-element-video"
      crossOrigin="anonymous"
      src={mediaFragmentUrl(video.url, video.startAtSeconds, video.endAtSeconds)}
      poster={video.posterUrl}
      controls
      preload="metadata"
      aria-label={label}
    >
      {video.captionsUrl ? (
        <track
          default
          kind="captions"
          src={video.captionsUrl}
          srcLang={video.captionsLanguage ?? 'en'}
        />
      ) : null}
    </video>
  );
}

function consentBoundMediaKey(video: NonNullable<SlideElement['video']>): string {
  return JSON.stringify([
    video.url,
    video.posterUrl ?? '',
    video.captionsUrl ?? '',
    video.startAtSeconds ?? null,
    video.endAtSeconds ?? null,
  ]);
}

function mediaFragmentUrl(url: string, start?: number, end?: number): string {
  if (start === undefined && end === undefined) return url;
  const fragment = `t=${Math.max(0, start ?? 0)}${end === undefined ? '' : `,${Math.max(0, end)}`}`;
  return `${url.split('#')[0]}#${fragment}`;
}

function elementVisualStyle(element: SlideElement): CSSProperties {
  const style = element.style;
  return {
    background: style.fill,
    borderColor: style.stroke,
    borderStyle: style.stroke ? 'solid' : undefined,
    borderWidth: style.strokeWidth === undefined ? undefined : `${style.strokeWidth}px`,
    borderRadius: style.radius === undefined ? undefined : `${style.radius / 12.8}cqw`,
    boxShadow: style.shadow,
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize === undefined ? undefined : `${style.fontSize / 12.8}cqw`,
    fontWeight: style.fontWeight,
    letterSpacing:
      style.letterSpacing === undefined ? undefined : `${style.letterSpacing / 12.8}cqw`,
    lineHeight: style.lineHeight,
    opacity: style.opacity,
    padding: style.padding === undefined ? undefined : `${style.padding / 12.8}cqw`,
    textAlign: style.textAlign,
    alignItems:
      style.verticalAlign === 'middle'
        ? 'center'
        : style.verticalAlign === 'bottom'
          ? 'flex-end'
          : 'flex-start',
    justifyContent:
      style.textAlign === 'center'
        ? 'center'
        : style.textAlign === 'right'
          ? 'flex-end'
          : 'flex-start',
  };
}

function ChartGraphic({
  chart,
  accent,
  theme,
}: {
  chart: ChartData;
  accent: string;
  theme: ThemeSpec;
}) {
  // Multi-series colors come from the theme palette; the first series keeps
  // the accent so single-series decks look exactly as before.
  const palette = [
    accent,
    theme.colors.insightInk,
    theme.colors.muted,
    theme.colors.border,
    theme.colors.insight,
    theme.colors.trace,
  ];
  const seriesColor = (index: number, explicit?: string) =>
    explicit ?? palette[index % palette.length] ?? accent;

  if (chart.chartType === 'pie') {
    const values = chart.series[0]?.values.map((value) => Math.max(0, value)) ?? [];
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    // A circle of radius r/2 with stroke-width r paints filled wedges.
    const wedgeRadius = 18;
    const circumference = 2 * Math.PI * wedgeRadius;
    let offset = 0;
    return (
      <div
        className="ns-chart ns-chart--line"
        data-chart-type="pie"
        role="img"
        aria-label={`${chart.labels.join(', ')} pie chart`}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          {values.map((value, index) => {
            const length = (value / total) * circumference;
            const dashOffset = -offset;
            offset += length;
            return (
              <circle
                key={`${chart.labels[index] ?? 'wedge'}-${index}`}
                cx="50"
                cy="50"
                r={wedgeRadius}
                fill="none"
                stroke={seriesColor(index, index === 0 ? chart.series[0]?.color : undefined)}
                strokeWidth={36}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 50 50)"
              />
            );
          })}
        </svg>
      </div>
    );
  }

  if (chart.chartType === 'bar-horizontal') {
    const labels = chart.labels.length > 0 ? chart.labels : [''];
    const max = Math.max(
      1,
      ...chart.series.flatMap((series) => series.values.map((value) => Math.abs(value))),
    );
    const rowHeight = 100 / labels.length;
    const seriesCount = Math.max(1, chart.series.length);
    const barHeight = (rowHeight * 0.6) / seriesCount;
    return (
      <div
        className="ns-chart ns-chart--line"
        data-chart-type="bar-horizontal"
        role="img"
        aria-label={`${chart.labels.join(', ')} horizontal bar chart${chart.unit ? ` in ${chart.unit}` : ''}`}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="26" y1="0" x2="26" y2="100" stroke={theme.colors.border} strokeWidth="0.6" />
          {labels.map((label, labelIndex) => (
            <g key={`${chart.labels[labelIndex] ?? 'row'}-${labelIndex}`}>
              <text
                x="24"
                y={labelIndex * rowHeight + rowHeight / 2}
                fill={theme.colors.muted}
                fontSize="5"
                textAnchor="end"
                dominantBaseline="middle"
              >
                {label}
              </text>
              {chart.series.map((series, seriesIndex) => (
                <rect
                  key={`${series.name}-${seriesIndex}`}
                  x="26"
                  y={labelIndex * rowHeight + rowHeight * 0.2 + seriesIndex * barHeight}
                  width={Math.max(1, (Math.abs(series.values[labelIndex] ?? 0) / max) * 72)}
                  height={Math.max(1, barHeight - 1)}
                  rx="1"
                  fill={seriesColor(seriesIndex, series.color)}
                />
              ))}
            </g>
          ))}
        </svg>
      </div>
    );
  }

  if (chart.chartType === 'stacked-bar') {
    const labels = chart.labels.length > 0 ? chart.labels : [''];
    const stackedMax = Math.max(
      1,
      ...labels.map((_, valueIndex) =>
        chart.series.reduce((sum, series) => sum + Math.max(0, series.values[valueIndex] ?? 0), 0),
      ),
    );
    const groupWidth = 100 / labels.length;
    return (
      <div
        className="ns-chart ns-chart--line"
        data-chart-type="stacked-bar"
        role="img"
        aria-label={`${chart.labels.join(', ')} stacked bar chart${chart.unit ? ` in ${chart.unit}` : ''}`}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="94" x2="100" y2="94" stroke={theme.colors.border} strokeWidth="0.6" />
          {labels.map((_, valueIndex) => {
            let stackTop = 94;
            return (
              <g key={`${chart.labels[valueIndex] ?? 'column'}-${valueIndex}`}>
                {chart.series.map((series, seriesIndex) => {
                  const value = Math.max(0, series.values[valueIndex] ?? 0);
                  const segmentHeight = (value / stackedMax) * 88;
                  if (segmentHeight <= 0) return null;
                  stackTop -= segmentHeight;
                  return (
                    <rect
                      key={`${series.name}-${seriesIndex}`}
                      x={valueIndex * groupWidth + groupWidth * 0.2}
                      y={stackTop}
                      width={groupWidth * 0.6}
                      height={segmentHeight}
                      fill={seriesColor(seriesIndex, series.color)}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  if (chart.chartType === 'donut') {
    const values = chart.series.flatMap((series) => series.values);
    const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const primary = Math.max(0, values[0] ?? 0);
    const angle = (primary / total) * 360;
    return (
      <div className="ns-chart ns-chart--donut">
        <div
          className="ns-chart-donut"
          style={{
            background: `conic-gradient(${accent} 0deg ${angle}deg, color-mix(in srgb, ${accent} 16%, transparent) ${angle}deg 360deg)`,
          }}
        >
          <span>{Math.round((primary / total) * 100)}%</span>
        </div>
      </div>
    );
  }

  if (chart.chartType === 'bar') {
    const values = chart.series[0]?.values ?? [];
    const max = Math.max(1, ...values.map((value) => Math.abs(value)));
    return (
      <div
        className="ns-chart ns-chart--bar"
        role="img"
        aria-label={`${chart.labels.join(', ')} bar chart`}
      >
        {values.map((value, index) => (
          <div className="ns-chart-bar-column" key={`${chart.labels[index] ?? 'bar'}-${index}`}>
            <span
              className="ns-chart-bar"
              style={{
                height: `${Math.max(3, (Math.abs(value) / max) * 100)}%`,
                background: chart.series[0]?.color ?? accent,
              }}
            />
            <small>{chart.labels[index]}</small>
          </div>
        ))}
      </div>
    );
  }

  const max = Math.max(
    1,
    ...chart.series.flatMap((series) => series.values.map((value) => Math.abs(value))),
  );
  const seriesPoints = chart.series.map((series) => {
    const denominator = Math.max(1, series.values.length - 1);
    return series.values
      .map((value, index) => `${(index / denominator) * 100},${94 - (Math.abs(value) / max) * 82}`)
      .join(' ');
  });
  return (
    <div
      className="ns-chart ns-chart--line"
      data-chart-type={chart.chartType}
      role="img"
      aria-label={`${chart.labels.join(', ')} trend chart`}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {chart.chartType === 'area'
          ? chart.series.map((series, index) => (
              <polygon
                key={`area-${series.name}-${index}`}
                points={`0,100 ${seriesPoints[index] ?? ''} 100,100`}
                fill={index === 0 ? accent : seriesColor(index, series.color)}
                opacity="0.14"
              />
            ))
          : null}
        {chart.series.map((series, index) => (
          <polyline
            key={`line-${series.name}-${index}`}
            points={seriesPoints[index] ?? ''}
            fill="none"
            stroke={series.color ?? seriesColor(index)}
            strokeWidth="3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}
