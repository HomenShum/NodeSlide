import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_NEBIUS_BRIEF_CONSENT,
  NODESLIDE_OPENROUTER_BRIEF_CONSENT,
  createDeckProviderAdmission,
  nodeSlideBriefProviderConsent,
} from './ProjectDialog';

const source = readFileSync('src/domains/nodeslide/components/ProjectDialog.tsx', 'utf8');

describe('create-deck provider admission', () => {
  it('names the consent each mode requires, and none for the local mode', () => {
    expect(nodeSlideBriefProviderConsent('nebius')).toBe(NODESLIDE_NEBIUS_BRIEF_CONSENT);
    expect(nodeSlideBriefProviderConsent('openrouter_free')).toBe(
      NODESLIDE_OPENROUTER_BRIEF_CONSENT,
    );
    expect(nodeSlideBriefProviderConsent('deterministic')).toBeNull();
  });

  it('admits a matching consent and carries the model and effort with it', () => {
    expect(
      createDeckProviderAdmission(
        'nebius',
        'z-ai/glm-5.2',
        'medium',
        NODESLIDE_NEBIUS_BRIEF_CONSENT,
      ),
    ).toEqual({
      providerMode: 'nebius',
      providerModel: 'z-ai/glm-5.2',
      providerEffort: 'medium',
      providerConsent: NODESLIDE_NEBIUS_BRIEF_CONSENT,
    });
    expect(createDeckProviderAdmission('deterministic', 'z-ai/glm-5.2', 'medium', null)).toEqual({
      providerMode: 'deterministic',
    });
  });

  /**
   * The regression this exists for: a user ticks consent while OpenRouter is selected, then
   * switches to Nebius. Deriving the consent string from the mode at submit time would record
   * a Nebius consent the user never gave.
   */
  it('refuses a consent granted for a different provider', () => {
    expect(
      createDeckProviderAdmission(
        'nebius',
        'z-ai/glm-5.2',
        'medium',
        NODESLIDE_OPENROUTER_BRIEF_CONSENT,
      ),
    ).toBeNull();
    expect(
      createDeckProviderAdmission('openrouter_free', 'z-ai/glm-5.2', 'medium', null),
    ).toBeNull();
  });

  /** Wiring guard: the dialog must submit the admission, not rebuild one inline. */
  it('is the dialog submit path', () => {
    expect(source).toContain('const providerAdmission = createDeckProviderAdmission(');
    expect(source).toContain('if (!providerAdmission) return;');
    expect(source).toContain('...providerAdmission,');
    expect(source).toContain(
      'grantedProviderConsent === nodeSlideBriefProviderConsent(providerMode)',
    );
    // The tick must be stored as the consent it granted, not as a bare boolean.
    expect(source).not.toContain('useState(false);\n  const providerConsent');
    expect(source).not.toMatch(/providerConsent:\s*\n?\s*providerMode === 'nebius'/u);
  });
});
