import { describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../convex/lib/nodeslideSeed';
import { validateNodeSlideSnapshot } from '../convex/lib/nodeslideValidation';
import { validateSnapshot } from '../src/domains/nodeslide/slidelang/validation';
import type { DeckSnapshot, ValidationIssue } from './nodeslide';
import { geometryIssueDrafts } from './nodeslideGeometryChecks';

/**
 * The shared geometry validator is the single source for collision and text
 * overflow issues. These scenarios prove the historical dishonesty is closed:
 * the server validation record (inspector footer) and the client SlideLang
 * validator (export gate) must agree on geometry verdicts.
 */

function geometryTuples(issues: readonly ValidationIssue[]) {
  return issues
    .filter((issue) => issue.code === 'collision' || issue.code === 'overflow')
    .map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      slideId: issue.slideId,
      elementId: issue.elementId,
      message: issue.message,
    }))
    .sort((left, right) =>
      `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`),
    );
}

function collisionSnapshot(): { snapshot: DeckSnapshot; bodyId: string; bulletId: string } {
  const { snapshot } = buildGoldenNodeSlide('geometry-agreement', 1_000);
  const slide = snapshot.slides[0];
  if (!slide) throw new Error('Missing golden slide fixture.');
  const body = snapshot.elements.find(
    (element) => element.slideId === slide.id && element.role === 'body',
  );
  const bullet = snapshot.elements.find(
    (element) => element.slideId === slide.id && element.role === 'bullet',
  );
  if (!body || !bullet) throw new Error('Missing body or bullet fixture.');
  // The shipped collision class: a measured body block whose bottom edge
  // (y 0.48 + h 0.17 = 0.65) runs into the bullet stack starting at y 0.62.
  body.bbox = { x: 0.07, y: 0.48, width: 0.39, height: 0.17 };
  bullet.bbox = { x: 0.07, y: 0.62, width: 0.39, height: 0.09 };
  return { snapshot, bodyId: body.id, bulletId: bullet.id };
}

describe('shared geometry checks (single-sourced collision + overflow)', () => {
  it('flags the body/bullet collision fixture (y0.48 h0.17 vs y0.62) in the shared validator', () => {
    const { snapshot, bodyId, bulletId } = collisionSnapshot();
    const collisions = geometryIssueDrafts(snapshot).filter((draft) => draft.code === 'collision');
    expect(collisions.length).toBeGreaterThanOrEqual(1);
    expect(collisions[0]).toMatchObject({
      severity: 'warning',
      code: 'collision',
      elementId: bulletId,
    });
    expect(collisions[0]?.message).toContain(bodyId);
    expect(collisions[0]?.message).toContain(bulletId);
  });

  it('keeps server validation records and client export gating in agreement on collisions', () => {
    const { snapshot } = collisionSnapshot();
    const server = validateNodeSlideSnapshot(snapshot, 1_000);
    const client = validateSnapshot(snapshot);

    // Identical geometry issues (code, severity, target, message) on both surfaces.
    const serverGeometry = geometryTuples(server.issues);
    const clientGeometry = geometryTuples(client.issues);
    expect(serverGeometry.length).toBeGreaterThanOrEqual(1);
    expect(serverGeometry.some((issue) => issue.code === 'collision')).toBe(true);
    expect(clientGeometry).toEqual(serverGeometry);

    // Identical verdicts: the deck still compiles, but neither surface lets it publish.
    expect(server.ok).toBe(true);
    expect(client.ok).toBe(true);
    expect(server.publishOk).toBe(false);
    expect(client.publishOk).toBe(false);
    expect(server.cleanOk).toBe(false);
    expect(client.cleanOk).toBe(false);
  });

  it('keeps server and client in agreement on estimated text overflow', () => {
    const { snapshot } = buildGoldenNodeSlide('geometry-overflow-agreement', 1_000);
    const body = snapshot.elements.find((element) => element.role === 'body');
    if (!body) throw new Error('Missing body fixture.');
    body.bbox = { x: 0.06, y: 0.07, width: 0.2, height: 0.06 };
    body.content = Array.from({ length: 40 }, () => 'overflowing measured copy').join(' ');
    body.style.fontSize = 30;

    const server = validateNodeSlideSnapshot(snapshot, 1_000);
    const client = validateSnapshot(snapshot);

    const serverOverflow = server.issues.filter((issue) => issue.code === 'overflow');
    const clientOverflow = client.issues.filter((issue) => issue.code === 'overflow');
    expect(serverOverflow.length).toBeGreaterThanOrEqual(1);
    expect(geometryTuples(server.issues)).toEqual(geometryTuples(client.issues));
    expect(clientOverflow[0]).toMatchObject({ severity: 'warning', elementId: body.id });
    expect(server.publishOk).toBe(false);
    expect(client.publishOk).toBe(false);
  });

  it('leaves the untouched golden deck geometry-clean on both surfaces', () => {
    const { snapshot } = buildGoldenNodeSlide('geometry-clean-agreement', 1_000);
    expect(geometryIssueDrafts(snapshot)).toEqual([]);
    expect(geometryTuples(validateNodeSlideSnapshot(snapshot, 1_000).issues)).toEqual([]);
    expect(geometryTuples(validateSnapshot(snapshot).issues)).toEqual([]);
  });
});
