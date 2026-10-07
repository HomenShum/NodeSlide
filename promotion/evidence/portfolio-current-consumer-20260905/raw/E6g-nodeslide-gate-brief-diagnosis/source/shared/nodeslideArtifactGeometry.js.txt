export const NODESLIDE_ARTIFACT_GEOMETRY_VERSION = 'nodeslide.artifact-geometry/v1';

export function compileNodeSlideNativeArtifactGeometry(
  spec,
  frame = { x: 0, y: 0, width: 100, height: 100 },
) {
  if (!spec || typeof spec !== 'object') throw new Error('ArtifactSpec is required.');
  if (
    ![frame.x, frame.y, frame.width, frame.height].every(finite) ||
    frame.width <= 0 ||
    frame.height <= 0
  )
    throw new Error('Artifact geometry frame is invalid.');
  const marks = geometryForKind(spec.kind, spec.payload ?? {}, frame);
  if (!marks) return null;
  return {
    schemaVersion: NODESLIDE_ARTIFACT_GEOMETRY_VERSION,
    artifactId: spec.id,
    kind: spec.kind,
    frame: { ...frame },
    marks,
  };
}

function geometryForKind(kind, payload, frame) {
  if (kind === 'waterfall') return waterfallMarks(payload, frame);
  if (kind === 'sankey') return sankeyMarks(payload, frame);
  if (kind === 'gantt') return ganttMarks(payload, frame);
  if (kind === 'risk-matrix') return riskMarks(payload, frame);
  if (kind === 'trace') return traceMarks(payload, frame);
  if (kind === 'spatial-scene') return spatialMarks(payload, frame);
  return null;
}

function waterfallMarks(payload, frame) {
  const deltas = Array.isArray(payload.deltas) ? payload.deltas : [];
  const values = [payload.baseline];
  let cumulative = payload.baseline;
  for (const delta of deltas) {
    cumulative += delta.value;
    values.push(cumulative);
  }
  values.push(payload.final);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const y = (value) => frame.y + frame.height - ((value - min) / range) * frame.height;
  const count = deltas.length + 2;
  const gap = frame.width * 0.025;
  const width = (frame.width - gap * (count - 1)) / count;
  const bars = [];
  bars.push(
    rectMark(
      'baseline',
      payload.baseline,
      frame.x,
      y(Math.max(0, payload.baseline)),
      width,
      Math.abs(y(payload.baseline) - y(0)),
      payload.unit,
    ),
  );
  cumulative = payload.baseline;
  deltas.forEach((delta, index) => {
    const next = cumulative + delta.value;
    bars.push(
      rectMark(
        `delta:${index + 1}`,
        delta.value,
        frame.x + (index + 1) * (width + gap),
        Math.min(y(cumulative), y(next)),
        width,
        Math.abs(y(cumulative) - y(next)),
        payload.unit,
        delta.label,
      ),
    );
    cumulative = next;
  });
  bars.push(
    rectMark(
      'final',
      payload.final,
      frame.x + (count - 1) * (width + gap),
      y(Math.max(0, payload.final)),
      width,
      Math.abs(y(payload.final) - y(0)),
      payload.unit,
    ),
  );
  const connectors = bars.slice(0, -1).map((bar, index) => {
    const next = bars[index + 1];
    const connectorY =
      bar.id === 'baseline' ? y(payload.baseline) : bar.value >= 0 ? bar.y : bar.y + bar.height;
    return {
      id: `connector:${index + 1}`,
      from: { x: bar.x + bar.width, y: connectorY },
      to: { x: next.x, y: connectorY },
    };
  });
  return { domain: { min, max, unit: payload.unit }, bars, connectors };
}

function sankeyMarks(payload, frame) {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const links = Array.isArray(payload.links) ? payload.links : [];
  const layers = [...new Set(nodes.map((node) => node.layer ?? 'middle'))];
  const layerOrder = [
    'source',
    ...layers.filter((layer) => !['source', 'sink'].includes(layer)),
    'sink',
  ].filter((layer, index, all) => layers.includes(layer) && all.indexOf(layer) === index);
  const maxLink = Math.max(1, ...links.map((link) => link.value));
  const nodeWidth = Math.max(2, frame.width * 0.025);
  const nodeRects = [];
  const byId = new Map();
  layerOrder.forEach((layer, layerIndex) => {
    const layerNodes = nodes.filter((node) => (node.layer ?? 'middle') === layer);
    layerNodes.forEach((node, nodeIndex) => {
      const mark = {
        id: node.id,
        label: node.label ?? node.id,
        x:
          frame.x +
          (layerOrder.length === 1
            ? 0
            : (layerIndex / (layerOrder.length - 1)) * (frame.width - nodeWidth)),
        y:
          frame.y +
          ((nodeIndex + 0.5) / Math.max(1, layerNodes.length)) * frame.height -
          frame.height * 0.06,
        width: nodeWidth,
        height: frame.height * 0.12,
      };
      nodeRects.push(mark);
      byId.set(node.id, mark);
    });
  });
  return {
    unit: payload.unit,
    nodes: nodeRects,
    links: links.map((link, index) => ({
      id: link.id ?? `link:${index + 1}`,
      source: link.source,
      target: link.target,
      value: link.value,
      width: Math.max(1, (link.value / maxLink) * frame.height * 0.08),
      from: centerRight(byId.get(link.source)),
      to: centerLeft(byId.get(link.target)),
    })),
  };
}

function ganttMarks(payload, frame) {
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const min = Math.min(...tasks.map((task) => task.start));
  const max = Math.max(...tasks.map((task) => task.end));
  const range = max - min || 1;
  const rowHeight = frame.height / Math.max(1, tasks.length);
  const taskMarks = tasks.map((task, index) => ({
    id: task.id,
    label: task.label ?? task.id,
    x: frame.x + ((task.start - min) / range) * frame.width,
    y: frame.y + index * rowHeight + rowHeight * 0.15,
    width: Math.max(1, ((task.end - task.start) / range) * frame.width),
    height: rowHeight * 0.7,
    confidence: task.confidence,
    opacity: 0.35 + 0.65 * clamp(task.confidence ?? 0, 0, 1),
  }));
  const byId = new Map(taskMarks.map((task) => [task.id, task]));
  const dependencies = tasks.flatMap((task) =>
    (task.dependsOn ?? []).map((dependencyId) => ({
      from: centerRight(byId.get(dependencyId)),
      to: centerLeft(byId.get(task.id)),
      dependencyId,
      taskId: task.id,
    })),
  );
  return { domain: { min, max, unit: payload.unit }, tasks: taskMarks, dependencies };
}

function riskMarks(payload, frame) {
  const risks = Array.isArray(payload.risks) ? payload.risks : [];
  const maxLikelihood = Math.max(1, ...risks.map((risk) => risk.likelihood));
  const maxImpact = Math.max(1, ...risks.map((risk) => risk.impact));
  const maximumRadius = Math.max(3, Math.min(frame.width, frame.height) * 0.08);
  return {
    likelihoodAxis: payload.likelihoodAxis,
    impactAxis: payload.impactAxis,
    risks: risks.map((risk) => {
      const radius = clamp(
        Math.sqrt(Math.max(1, risk.exposure ?? risk.likelihood * risk.impact)) * 2,
        3,
        maximumRadius,
      );
      return {
        id: risk.id,
        label: risk.label ?? risk.id,
        x:
          frame.x +
          radius +
          (risk.likelihood / maxLikelihood) * Math.max(0, frame.width - radius * 2),
        y:
          frame.y +
          frame.height -
          radius -
          (risk.impact / maxImpact) * Math.max(0, frame.height - radius * 2),
        radius,
        likelihood: risk.likelihood,
        impact: risk.impact,
      };
    }),
  };
}

function traceMarks(payload, frame) {
  const spans = Array.isArray(payload.spans) ? payload.spans : [];
  const starts = spans.map((span) => span.startMs).filter(finite);
  const ends = spans.map((span) => span.endMs).filter(finite);
  const min = starts.length ? Math.min(...starts) : 0;
  const max = ends.length ? Math.max(...ends) : min + 1;
  const range = max - min || 1;
  const rowHeight = frame.height / Math.max(1, spans.length);
  return {
    domain: { min, max, unit: 'ms' },
    spans: spans.map((span, index) => {
      const startMs = finite(span.startMs) ? span.startMs : null;
      const endMs = finite(span.endMs) ? span.endMs : null;
      return {
        spanId: span.spanId,
        parentSpanId: span.parentSpanId ?? null,
        startMs,
        endMs,
        durationMs: startMs === null || endMs === null ? null : Math.max(0, endMs - startMs),
        x: frame.x + (((startMs ?? min) - min) / range) * frame.width,
        y: frame.y + index * rowHeight + rowHeight * 0.15,
        width: Math.max(1, (((endMs ?? startMs ?? min) - (startMs ?? min)) / range) * frame.width),
        height: rowHeight * 0.7,
      };
    }),
  };
}

function spatialMarks(payload, frame) {
  const viewports = Array.isArray(payload.viewports) ? payload.viewports : [];
  const maximumLevel = Math.max(1, ...viewports.map((viewport) => viewport.level ?? 1));
  return {
    viewports: viewports.map((viewport, index) => {
      const scale = 1 / Math.max(1, viewport.level ?? 1);
      const width = frame.width * scale;
      const height = frame.height * scale;
      return {
        id: viewport.id,
        level: viewport.level,
        x: finite(viewport.x)
          ? frame.x + viewport.x * frame.width
          : frame.x + (frame.width - width) * (index / Math.max(1, viewports.length - 1)),
        y: finite(viewport.y)
          ? frame.y + viewport.y * frame.height
          : frame.y + (frame.height - height) * ((viewport.level ?? 1) / maximumLevel),
        width,
        height,
        selectedNodeId: viewport.selectedNodeId ?? null,
      };
    }),
  };
}

function rectMark(id, value, x, y, width, height, unit, label = id) {
  return { id, label, value, unit, x, y, width, height: Math.max(1, height) };
}

function centerRight(mark) {
  return mark ? { x: mark.x + mark.width, y: mark.y + mark.height / 2 } : null;
}

function centerLeft(mark) {
  return mark ? { x: mark.x, y: mark.y + mark.height / 2 } : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}
