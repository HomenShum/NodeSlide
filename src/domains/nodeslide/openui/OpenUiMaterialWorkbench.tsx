import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { type ActionEvent, Renderer, createLibrary, defineComponent } from '@openuidev/react-lang';
import { ArrowRight, Check, Layers3, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';
import { useRef, useState } from 'react';
import { z } from 'zod';
import type { Deck, PatchOperation, Slide } from '../../../../shared/nodeslide';
import {
  AI2027_OPENUI_PROGRAM,
  AI2027_TRANSFORMATION_LADDER,
  NODESLIDE_OPENUI_ACTION,
  type OpenUiMaterialSpec,
  compileOpenUiMaterialProposal,
  validateOpenUiMaterialSpec,
} from './openUiMaterials';

const ladderProps = z.object({
  eyebrow: z.string(),
  title: z.string(),
  subtitle: z.string(),
  step1Label: z.string(),
  step1Value: z.string(),
  step1Unit: z.string(),
  step2Label: z.string(),
  step2Value: z.string(),
  step2Unit: z.string(),
  step3Label: z.string(),
  step3Value: z.string(),
  step3Unit: z.string(),
  step4Label: z.string(),
  step4Value: z.string(),
  step4Unit: z.string(),
  provenance: z.string(),
});

type OpenUiMaterialAction = Pick<ActionEvent, 'type' | 'params'>;

/**
 * Verification copy is DERIVED from `spec.verification`, never written beside it.
 *
 * The failure this prevents is the cheap one: someone edits the visible sentence to sound better
 * while the field underneath still says `unverified_scenario`, and the surface starts making a
 * claim the data does not support. Keying the sentence off the field makes the two impossible to
 * disagree, and `OpenUiMaterialWorkbench.test.tsx` fails if the fixture's field is promoted.
 */
const VERIFICATION_COPY: Record<OpenUiMaterialSpec['verification'], string> = {
  unverified_scenario:
    'Unverified scenario fixture. These numbers came from a user-supplied brief and are not bound to a source.',
  source_bound: 'Source-bound material. Every claim carries a bound source.',
};

const TransformationLadder = defineComponent({
  name: 'TransformationLadder',
  description:
    'A four-stage visual transformation ladder for claims with incompatible units. It must never imply a shared quantitative axis.',
  props: ladderProps,
  component: ({ props }) => {
    const steps = [
      [props.step1Label, props.step1Value, props.step1Unit],
      [props.step2Label, props.step2Value, props.step2Unit],
      [props.step3Label, props.step3Value, props.step3Unit],
      [props.step4Label, props.step4Value, props.step4Unit],
    ];
    /*
     * trust-surfaces: the provenance line carries an icon, and the icon is a claim. Parity drew
     * a ShieldCheck — a tick inside a shield — next to the words "· unverified". A checkmark is
     * acceptance iconography; putting one beside an unverified label is the same bug class as
     * the AgentThread card that painted an undecided proposal in the Accept button's fill. The
     * icon is chosen from the label, so unverified material cannot be drawn as if it passed.
     */
    const provenanceIsUnverified = /unverified/i.test(props.provenance);
    return (
      <article className="ns-openui-material" data-testid="openui-transformation-ladder">
        <div className="ns-openui-material-heading">
          <span>{props.eyebrow}</span>
          <h3>{props.title}</h3>
          <p>{props.subtitle}</p>
        </div>
        <ol className="ns-openui-ladder" aria-label="Transformation ladder">
          {steps.map(([label, value, unit], index) => (
            <li key={label}>
              <span className="ns-openui-step-number">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <small>{label}</small>
                <strong>{value}</strong>
                <span>{unit}</span>
              </div>
              {index < steps.length - 1 ? <ArrowRight size={13} aria-hidden="true" /> : null}
            </li>
          ))}
        </ol>
        <div className="ns-openui-material-footer">
          <span data-provenance-verified={provenanceIsUnverified ? 'false' : 'true'}>
            {provenanceIsUnverified ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}{' '}
            {props.provenance}
          </span>
        </div>
      </article>
    );
  },
});

export const nodeslideOpenUiMaterialLibrary = createLibrary({
  components: [TransformationLadder],
  root: 'TransformationLadder',
});

export interface OpenUiMaterialWorkbenchProps {
  deck: Deck;
  slide: Slide;
  disabled?: boolean;
  onPropose: (operations: PatchOperation[], summary: string) => Promise<void>;
}

export function OpenUiMaterialWorkbench({
  deck,
  slide,
  disabled = false,
  onPropose,
}: OpenUiMaterialWorkbenchProps) {
  const [status, setStatus] = useState<'idle' | 'working' | 'proposed' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const spec = AI2027_TRANSFORMATION_LADDER;
  const validation = validateOpenUiMaterialSpec(spec);
  /*
   * trust-surfaces clause 1: the posture is on the DOM, always, not only once a proposal exists.
   * A gate that asserts presence cannot distinguish "no proposal yet" from "attribute dropped in
   * a redesign" if the attribute only appears in one state — that is the data-agent-web-consent
   * regression, restated. This workbench can never legitimately read "accepted": it hands the
   * proposal to the host and the accept/reject decision is made in the thread, not here.
   */
  const decision = status === 'proposed' ? 'undecided' : 'none';

  const proposeVisualMaterial = async () => {
    if (disabled || actionInFlight.current) {
      return;
    }
    actionInFlight.current = true;
    setStatus('working');
    setMessage(null);
    try {
      const proposal = compileOpenUiMaterialProposal(spec, deck, slide);
      await onPropose(proposal.operations, proposal.summary);
      setStatus('proposed');
      setMessage('Proposal created. The deck is unchanged until you accept it.');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'The proposal could not be created.');
      actionInFlight.current = false;
    }
  };

  const handleAction = (event: OpenUiMaterialAction) => {
    if (event.type !== NODESLIDE_OPENUI_ACTION || event.params['specId'] !== spec.id) {
      return;
    }
    void proposeVisualMaterial();
  };

  return (
    <Collapsible
      className="ns-openui-workbench"
      data-testid="openui-visual-workbench"
      data-verification={spec.verification}
      data-decision={decision}
    >
      <CollapsibleTrigger>
        <span className="ns-openui-summary-icon">
          <Layers3 size={14} />
        </span>
        <span>
          <strong>Visual material lab</strong>
          <small>OpenUI · deterministic Phase 0</small>
        </span>
        {/*
         * "Unit-safe" is the validator's verdict on the spec's axes. It is deliberately NOT a
         * statement about provenance — the tick means the mixed-unit rule passed, and the
         * verification banner inside the body carries the separate, unflattering fact that the
         * numbers are unverified. Two different questions, two different indicators.
         */}
        <span className={validation.ok ? 'is-valid' : 'is-invalid'}>
          {validation.ok ? <Check size={12} /> : null}
          {validation.ok ? 'Unit-safe' : 'Blocked'}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="ns-openui-workbench-body" aria-busy={status === 'working'}>
        {/*
         * The lab ships exactly one hardcoded spec. Whenever it shows that spec it shows the
         * spec's verification status in the same breath — not in a tooltip, not only in the
         * compiled slide's speaker notes.
         */}
        {/*
         * `data-verification` lives on the root Collapsible only — one writer, one owning node,
         * so a scanner can never read two attributes that disagree. This banner is the human
         * half of the same fact and reads from the same field.
         */}
        <p className="ns-openui-verification" data-testid="openui-verification">
          <ShieldAlert size={12} aria-hidden="true" />
          <span>{VERIFICATION_COPY[spec.verification]}</span>
        </p>
        <Renderer
          response={AI2027_OPENUI_PROGRAM}
          library={nodeslideOpenUiMaterialLibrary}
          isStreaming={status === 'working' || disabled}
          onAction={handleAction}
        />
        <div className="ns-openui-host-action">
          <span>NodeSlide will create one reviewable add-slide proposal.</span>
          <button
            type="button"
            className="ns-button ns-button--accent"
            data-testid="openui-create-proposal"
            disabled={disabled || status === 'working' || status === 'proposed'}
            onClick={() => void proposeVisualMaterial()}
          >
            <Sparkles size={13} /> Create slide proposal
          </button>
        </div>
        {message ? (
          <output
            className={`ns-openui-status is-${status}`}
            data-testid="openui-proposal-status"
            data-decision={decision}
          >
            {message}
          </output>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
