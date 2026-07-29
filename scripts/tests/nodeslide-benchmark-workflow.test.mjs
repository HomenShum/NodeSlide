import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const workflowUrl = new URL('../../.github/workflows/nodeslide-bench.yml', import.meta.url);

describe('NodeSlide benchmark workflow evidence semantics', () => {
  it('does not call a no-input push run a supplied-evidence failure', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const supplied = job(workflow, 'evidence');

    expect(supplied).toContain("github.event_name == 'workflow_dispatch'");
    expect(supplied).toContain("inputs.evidence_path != ''");
    expect(supplied).not.toContain("github.event_name == 'push'");
  });

  it('records push-time evidence absence as expected UNSCORED without weakening the gate', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const absence = job(workflow, 'evidence_absence');

    expect(absence).toContain("github.event_name == 'push'");
    expect(absence).toContain('npm run nodeslide:bench:evidence');
    expect(absence).toContain('test "$exit_code" -eq 2');
    expect(absence).toContain('"status": "UNSCORED"');
  });

  it('keeps scheduled and explicit no-path runs on the fixed live UX/Taste lane', async () => {
    const workflow = await readFile(workflowUrl, 'utf8');
    const live = job(workflow, 'live_evidence');

    expect(live).toContain("github.event_name == 'schedule'");
    expect(live).toContain("inputs.evidence_path == ''");
    expect(live).toContain('NODESLIDE_BENCH_ALLOW_LIVE_WRITE');
    expect(live).toContain('NODESLIDE_TASTE_JUDGE_OPENROUTER_KEY');
    expect(live).toContain('Missing required live-evidence configuration');
    expect(live).toContain('NODESLIDE_PRODUCTION_URL');
    expect(live).toContain('NODESLIDE_PRODUCTION_CONVEX_URL');
  });
});

function job(workflow, name) {
  const start = workflow.indexOf(`  ${name}:`);
  if (start < 0) return '';
  const tail = workflow.slice(start + 2);
  const next = tail.search(/\n {2}[a-z][a-z0-9_]*:\n/u);
  return next < 0 ? workflow.slice(start) : workflow.slice(start, start + 2 + next);
}
