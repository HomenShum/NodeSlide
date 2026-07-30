import { describe, expect, it } from 'vitest';
import { registerRecipeLangTools } from './recipeLangTools';

describe('RecipeLang MCP agent-neutral surface', () => {
  it('registers the complete deterministic compiler surface without a model tool', () => {
    const names: string[] = [];
    registerRecipeLangTools({
      registerTool(name: string) {
        names.push(name);
      },
    } as never);
    expect(names).toEqual([
      'recipelang.get_schema',
      'recipelang.validate',
      'recipelang.normalize',
      'recipelang.inspect',
      'recipelang.verify_alignment',
      'recipelang.create_proposal',
      'recipelang.apply_patch',
      'recipelang.render',
      'recipelang.export',
    ]);
    expect(names.every((name) => !/agent|model|generate/iu.test(name))).toBe(true);
  });

  it('serves validation, inspection, and SVG from one typed recipe under burst use', async () => {
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();
    registerRecipeLangTools({
      registerTool(
        name: string,
        _config: unknown,
        handler: (args: Record<string, unknown>) => Promise<unknown>,
      ) {
        handlers.set(name, handler);
      },
    } as never);
    const recipe = {
      schemaVersion: 'recipelang/v1',
      kind: 'Recipe',
      meta: { id: 'mcp-burst', title: 'MCP burst', version: 4 },
      inputs: [{ id: 'source', label: 'Source', produces: 'raw' }],
      artifacts: [
        { id: 'raw', shape: 'Item[]' },
        { id: 'brief', shape: 'Brief', invariants: ['source-bound'] },
      ],
      steps: [
        {
          id: 'synthesize',
          label: 'Synthesize',
          consumes: ['raw'],
          produces: ['brief'],
          executor: { kind: 'agent', deterministic: false },
        },
      ],
      outputs: [{ artifact: 'brief', label: 'Brief' }],
    };
    const validate = handlers.get('recipelang.validate');
    const inspect = handlers.get('recipelang.inspect');
    const verifyAlignment = handlers.get('recipelang.verify_alignment');
    const render = handlers.get('recipelang.render');
    if (!validate || !inspect || !verifyAlignment || !render)
      throw new Error('RecipeLang handlers were not registered.');
    const bursts = await Promise.all(Array.from({ length: 100 }, () => validate({ recipe })));
    expect(new Set(bursts.map((value) => JSON.stringify(value))).size).toBe(1);
    const inspected = JSON.parse(
      ((await inspect({ recipe, artifactId: 'brief' })) as { content: Array<{ text: string }> })
        .content[0]?.text ?? '{}',
    ) as { artifact?: { producer?: string } };
    expect(inspected.artifact?.producer).toBe('synthesize');
    const verified = JSON.parse(
      (
        (await verifyAlignment({ recipe })) as {
          content: Array<{ text: string }>;
        }
      ).content[0]?.text ?? '{}',
    ) as { alignment?: { passed?: boolean } };
    expect(verified.alignment?.passed).toBe(true);
    const rendered = JSON.parse(
      ((await render({ recipe, target: 'svg' })) as { content: Array<{ text: string }> }).content[0]
        ?.text ?? '{}',
    ) as { artifact?: { format?: string; content?: string } };
    expect(rendered.artifact?.format).toBe('svg');
    expect(rendered.artifact?.content).toContain('data-recipe-step');
  });
});
