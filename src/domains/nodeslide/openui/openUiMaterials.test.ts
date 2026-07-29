import { createParser } from '@openuidev/react-lang';
import { describe, expect, it } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { nodeslideOpenUiMaterialLibrary } from './OpenUiMaterialWorkbench';
import {
  AI2027_OPENUI_PROGRAM,
  AI2027_TRANSFORMATION_LADDER,
  NODESLIDE_OPENUI_ACTION,
  compileOpenUiMaterialProposal,
  validateOpenUiMaterialSpec,
} from './openUiMaterials';

describe('NodeSlide OpenUI visual materials', () => {
  it('parses the canonical OpenUI Lang program with the bounded component library', () => {
    const parsed = createParser(nodeslideOpenUiMaterialLibrary.toJSONSchema()).parse(
      AI2027_OPENUI_PROGRAM,
    );
    expect(parsed.meta.errors).toEqual([]);
    expect(parsed.meta.unresolved).toEqual([]);
    expect(parsed.root).not.toBeNull();
    expect(parsed.meta.statementCount).toBe(1);
  });

  it('exposes only the allowlisted proposal action', () => {
    expect(NODESLIDE_OPENUI_ACTION).toBe('nodeslide.visual-material.propose');
    const prompt = nodeslideOpenUiMaterialLibrary.prompt({
      additionalRules: ['Never mutate a deck directly.'],
    });
    expect(prompt).toContain('TransformationLadder');
    expect(prompt).toContain('Never mutate a deck directly.');
  });

  it('compiles the mixed-unit ladder into one unapplied add-slide operation', () => {
    const { snapshot } = buildGoldenNodeSlide('openui-compile-proof', 1_700_000_000_000);
    const activeSlide = snapshot.slides[0];
    expect(activeSlide).toBeDefined();
    if (!activeSlide) return;
    const proposal = compileOpenUiMaterialProposal(
      AI2027_TRANSFORMATION_LADDER,
      snapshot.deck,
      activeSlide,
    );
    expect(proposal.operations).toHaveLength(1);
    expect(proposal.operations[0]?.op).toBe('add_slide');
    expect(snapshot.deck.slideOrder).not.toContain(proposal.slideId);
    if (proposal.operations[0]?.op !== 'add_slide') return;
    expect(
      proposal.operations[0].elements.filter((element) => element.role === 'metric'),
    ).toHaveLength(4);
    expect(proposal.operations[0].slide.notes).toContain('unverified');
  });

  it('fails closed when incompatible units are requested on one chart axis', () => {
    const invalid = validateOpenUiMaterialSpec({
      ...AI2027_TRANSFORMATION_LADDER,
      kind: 'chart',
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.issues).toContain('Mixed-unit claims cannot share one quantitative chart axis.');
  });

  it('requires scenario fixtures to remain visibly unverified', () => {
    const invalid = validateOpenUiMaterialSpec({
      ...AI2027_TRANSFORMATION_LADDER,
      provenanceLabel: 'Scenario brief',
    });
    expect(invalid.ok).toBe(false);
  });

  /*
   * The shipped fixture is a demo and stays labelled as one. This is the test that fails if
   * someone promotes the label to make a screenshot look better — which is the specific way this
   * capability could start lying, given that the numbers themselves are unchecked.
   */
  it('keeps the one shipped fixture declared as an unverified scenario', () => {
    expect(AI2027_TRANSFORMATION_LADDER.verification).toBe('unverified_scenario');
    expect(AI2027_TRANSFORMATION_LADDER.provenanceLabel).toMatch(/unverified/i);
    expect(AI2027_TRANSFORMATION_LADDER.eyebrow).toMatch(/scenario/i);
    expect(validateOpenUiMaterialSpec(AI2027_TRANSFORMATION_LADDER).ok).toBe(true);
  });
});
