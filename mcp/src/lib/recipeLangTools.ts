import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  type RecipePatch,
  type RecipePatchReceipt,
  type RecipeSnapshot,
  applyRecipePatch,
  canonicalJson,
  compileRecipe,
  normalizeRecipeSnapshot,
  recipeHash,
  recipeLangJsonSchema,
  renderRecipeHtml,
  renderRecipeSvg,
  verifyRecipeGridAlignment,
} from '@nodeslide/recipelang';
import { z } from 'zod';

const MAX_RENDER_BYTES = 4 * 1024 * 1024;
const recipeInput = { recipe: z.unknown() };

type ToolConfig = {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
};

function register(
  server: McpServer,
  name: string,
  config: ToolConfig,
  handler: (args: Record<string, unknown>) => Promise<unknown>,
) {
  const registerTool = server.registerTool as unknown as (
    toolName: string,
    toolConfig: ToolConfig,
    toolHandler: (args: Record<string, unknown>) => Promise<unknown>,
  ) => void;
  registerTool.call(server, name, config, handler);
}

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

export function registerRecipeLangTools(server: McpServer): void {
  register(
    server,
    'recipelang.get_schema',
    {
      title: 'Get RecipeLang v1 schema',
      description:
        'Returns the versioned agent-neutral RecipeLang JSON schema. No model is called.',
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => result({ schema: recipeLangJsonSchema }),
  );
  register(
    server,
    'recipelang.validate',
    {
      title: 'Validate a RecipeLang snapshot',
      description: 'Runs bounded contract, topology, provenance, and render-profile checks.',
      inputSchema: recipeInput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ recipe }) => {
      const compiled = compileRecipe(recipe);
      return result({ ok: compiled.receipt.contractErrors === 0, receipt: compiled.receipt });
    },
  );
  register(
    server,
    'recipelang.normalize',
    {
      title: 'Normalize a RecipeLang snapshot',
      description: 'Returns canonical sorted RecipeLang JSON and its stable SHA-256 digest.',
      inputSchema: recipeInput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ recipe }) => {
      const snapshot = normalizeRecipeSnapshot(recipe);
      return result({
        snapshot,
        canonicalJson: canonicalJson(snapshot),
        contentHash: recipeHash(snapshot),
      });
    },
  );
  register(
    server,
    'recipelang.inspect',
    {
      title: 'Inspect an artifact edge contract',
      description: 'Returns shape, producer, consumers, invariants, and source lineage.',
      inputSchema: { ...recipeInput, artifactId: z.string().min(1) },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ recipe, artifactId }) => {
      const compiled = compileRecipe(recipe);
      const artifact = compiled.artifacts.find((item) => item.id === artifactId);
      if (!artifact) throw new Error(`Unknown artifact ${String(artifactId)}.`);
      return result({ artifact, receipt: compiled.receipt });
    },
  );
  register(
    server,
    'recipelang.verify_alignment',
    {
      title: 'Verify RecipeGrid alignment',
      description:
        'Checks shared row boundaries, merged spans, left-to-right order, and output convergence against the Cooking for Engineers TRN reference invariants.',
      inputSchema: recipeInput,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ recipe }) => result({ alignment: verifyRecipeGridAlignment(recipe) }),
  );
  register(
    server,
    'recipelang.create_proposal',
    {
      title: 'Validate a typed RecipeLang patch proposal',
      description: 'Previews a CAS-controlled patch without mutating or invoking a model.',
      inputSchema: { ...recipeInput, patch: z.unknown() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ recipe, patch }) => {
      const snapshot = normalizeRecipeSnapshot(recipe);
      const applied = applyRecipePatch(snapshot, patch as RecipePatch);
      return result({
        applied: false,
        candidateSnapshot: applied.snapshot,
        candidateHash: applied.receipt.afterHash,
        receipt: { ...applied.receipt, applied: false },
      });
    },
  );
  register(
    server,
    'recipelang.apply_patch',
    {
      title: 'Apply a CAS-controlled RecipeLang patch',
      description: 'Applies typed operations with version and idempotency enforcement.',
      inputSchema: {
        ...recipeInput,
        patch: z.unknown(),
        priorReceipts: z.array(z.unknown()).max(200).optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ recipe, patch, priorReceipts }) =>
      result(
        applyRecipePatch(
          normalizeRecipeSnapshot(recipe),
          patch as RecipePatch,
          (priorReceipts ?? []) as RecipePatchReceipt[],
        ),
      ),
  );
  for (const name of ['recipelang.render', 'recipelang.export'] as const) {
    register(
      server,
      name,
      {
        title: name === 'recipelang.render' ? 'Render RecipeLang' : 'Export RecipeLang',
        description: 'Deterministically renders the same normalized snapshot to SVG or HTML.',
        inputSchema: {
          ...recipeInput,
          target: z.enum(['svg', 'html']).default('svg'),
        },
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
      async ({ recipe, target }) => {
        const rendered = target === 'html' ? renderRecipeHtml(recipe) : renderRecipeSvg(recipe);
        const bytes = Buffer.byteLength(rendered.content);
        if (bytes > MAX_RENDER_BYTES)
          throw new Error(`RecipeLang render exceeds ${MAX_RENDER_BYTES} bytes.`);
        return result({
          artifact: {
            format: target,
            content: rendered.content,
            contentHash: recipeHash(rendered.content),
            bytes,
          },
          receipt: rendered.compiled.receipt,
        });
      },
    );
  }
}

export type { RecipeSnapshot };
