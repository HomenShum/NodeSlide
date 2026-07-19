import { describe, expect, it } from 'vitest';
import {
  estimateTextHeight,
  findCollisions,
  measureText,
  overlapOfSmallerRatio,
  resolveCollisions,
  stackBlocks,
} from './nodeslideLayoutMetrics';

describe('NodeSlide layout metrics', () => {
  describe('measureText / estimateTextHeight', () => {
    it('treats empty content as a single line', () => {
      const result = measureText('', 19, 1.35, 0.39);
      expect(result.lines).toBe(1);
      expect(result.height).toBeGreaterThan(0);
    });

    it('computes characters per line from the 0.52em average glyph width', () => {
      // 0.39 slide-widths on a 1600px canvas = 624px inner width;
      // 19px type at 0.52em averages 9.88px/char -> 63 characters per line.
      expect(measureText('x', 19, 1.35, 0.39).charactersPerLine).toBe(63);
    });

    it('wraps at the calibrated line width and converts lines to normalized height', () => {
      const oneLine = measureText('x'.repeat(63), 19, 1.35, 0.39);
      const twoLines = measureText('x'.repeat(64), 19, 1.35, 0.39);
      expect(oneLine.lines).toBe(1);
      expect(twoLines.lines).toBe(2);
      // 2 lines * 19px * 1.35 line-height / 900px canvas height ~= 0.057.
      expect(twoLines.height).toBeCloseTo(0.057, 3);
    });

    it('word-wraps prose instead of counting raw characters', () => {
      const words = Array.from({ length: 20 }, () => 'evidence').join(' ');
      // 20 8-char words + separators = 179 chars -> 3 lines at 63 cpl.
      expect(measureText(words, 19, 1.35, 0.39).lines).toBe(3);
    });

    it('estimates a 600-character body as taller than the legacy fixed 0.2 block', () => {
      const longBody = Array.from({ length: 75 }, () => 'measured').join(' ');
      expect(longBody.length).toBeGreaterThanOrEqual(600);
      expect(estimateTextHeight(longBody, 19, 1.35, 0.39)).toBeGreaterThan(0.2);
    });

    it('grows monotonically with content length', () => {
      const short = estimateTextHeight('Short claim.', 19, 1.35, 0.48);
      const long = estimateTextHeight('Short claim. '.repeat(30), 19, 1.35, 0.48);
      expect(long).toBeGreaterThan(short);
    });
  });

  describe('stackBlocks', () => {
    it('places each block below the previous one plus its gap', () => {
      const placed = stackBlocks(
        0.4,
        [
          { key: 'a', height: 0.2, gapBefore: 0.05 },
          { key: 'b', height: 0.09, gapBefore: 0.02 },
          { key: 'c', height: 0.09, gapBefore: 0.03 },
        ],
        0.95,
      );
      expect(placed[0]).toMatchObject({ key: 'a', y: 0.4, height: 0.2 });
      expect(placed[1]?.y).toBeCloseTo(0.62, 6);
      expect(placed[2]?.y).toBeCloseTo(0.74, 6);
    });

    it('compresses gaps and heights so the stack never passes maxBottom', () => {
      const placed = stackBlocks(
        0.67,
        [
          { key: 'b1', height: 0.09, gapBefore: 0.03 },
          { key: 'b2', height: 0.09, gapBefore: 0.03 },
          { key: 'b3', height: 0.09, gapBefore: 0.03 },
        ],
        0.95,
      );
      const last = placed[2];
      if (!last) throw new Error('Missing stacked block.');
      expect(last.y + last.height).toBeLessThanOrEqual(0.95 + 1e-9);
      // Order is preserved and blocks stay disjoint.
      expect(placed[1]?.y ?? 0).toBeGreaterThanOrEqual(
        (placed[0]?.y ?? 0) + (placed[0]?.height ?? 0),
      );
    });
  });

  describe('collision detection and resolution', () => {
    it('measures overlap as a share of the smaller box', () => {
      const large = { x: 0, y: 0, width: 0.5, height: 0.5 };
      const small = { x: 0.45, y: 0.45, width: 0.1, height: 0.1 };
      // 0.05 x 0.05 overlap over the 0.01 smaller area = 25%.
      expect(overlapOfSmallerRatio(large, small)).toBeCloseTo(0.25, 6);
    });

    it('flags pairs above the 8% threshold and ignores disjoint boxes', () => {
      const rects = [
        { id: 'body', bbox: { x: 0.07, y: 0.4, width: 0.39, height: 0.33 } },
        { id: 'bullet', bbox: { x: 0.07, y: 0.62, width: 0.39, height: 0.09 } },
        { id: 'chart', bbox: { x: 0.53, y: 0.42, width: 0.39, height: 0.4 } },
      ];
      const collisions = findCollisions(rects);
      expect(collisions).toHaveLength(1);
      expect(collisions[0]).toMatchObject({ first: 'body', second: 'bullet' });
    });

    it('resolves collisions by pushing the lower element down within bounds', () => {
      const rects = [
        { id: 'body', bbox: { x: 0.07, y: 0.4, width: 0.39, height: 0.3 } },
        { id: 'bullet', bbox: { x: 0.07, y: 0.62, width: 0.39, height: 0.09 } },
      ];
      const result = resolveCollisions(rects);
      expect(result.resolved).toBe(true);
      expect(result.nudged).toEqual(['bullet']);
      const moved = result.boxes.get('bullet');
      if (!moved) throw new Error('Missing resolved bullet box.');
      expect(moved.y).toBeGreaterThanOrEqual(0.7);
      expect(moved.y + moved.height).toBeLessThanOrEqual(0.995);
      // Inputs are not mutated.
      expect(rects[1]?.bbox.y).toBe(0.62);
    });

    it('reports unresolved when pushing down cannot clear the overlap', () => {
      const rects = [
        { id: 'a', bbox: { x: 0, y: 0, width: 1, height: 1 } },
        { id: 'b', bbox: { x: 0, y: 0, width: 1, height: 1 } },
      ];
      const result = resolveCollisions(rects);
      expect(result.resolved).toBe(false);
      expect(result.remaining.length).toBeGreaterThan(0);
    });
  });
});
