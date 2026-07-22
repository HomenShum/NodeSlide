import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_FREE_ROUTER_CANDIDATES,
  NODESLIDE_OFFERED_AGENT_MODELS,
} from '../shared/nodeslide.ts';
import {
  NODE_SLIDE_FREE_ROUTE_CATALOG,
  NODE_SLIDE_OFFERED_ROUTE_CATALOG,
  validateModelFleetReceipt,
} from './lib/model-fleet-receipt-core.mjs';

function publicRouteShape(route) {
  return { id: route.id, provider: route.provider, upstreamId: route.upstreamId };
}

function validReceipt(schemaVersion, catalog) {
  const receipts = catalog.map((route) => ({
    model: route.id,
    upstreamModel: route.upstreamId,
    provider: route.provider,
    actualProvider: route.provider,
    actualModel:
      route.id === 'openrouter/free' ? 'meta-llama/llama-3.3-70b-instruct:free' : route.upstreamId,
    status: 'passed',
    latencyMs: 12,
    costMicroUsd: 0,
    inputTokens: 2,
    outputTokens: 3,
    response: { present: true, bytes: 17 },
  }));
  return {
    schemaVersion,
    catalogModelCount: catalog.length,
    probedModelCount: catalog.length,
    failedModelCount: 0,
    passed: true,
    receipts,
  };
}

describe('production model-fleet receipt validation', () => {
  it('keeps the verifier catalogs exactly aligned with the product catalogs', () => {
    expect(NODE_SLIDE_OFFERED_ROUTE_CATALOG).toEqual(
      NODESLIDE_OFFERED_AGENT_MODELS.map(publicRouteShape),
    );
    expect(NODE_SLIDE_FREE_ROUTE_CATALOG).toEqual(
      NODESLIDE_FREE_ROUTER_CANDIDATES.map(publicRouteShape),
    );
  });

  it.each([
    ['nodeslide.model-fleet-probe/v1', NODE_SLIDE_OFFERED_ROUTE_CATALOG],
    ['nodeslide.free-router-fleet-probe/v1', NODE_SLIDE_FREE_ROUTE_CATALOG],
    ['nodeslide.free-router-structured-probe/v1', NODE_SLIDE_FREE_ROUTE_CATALOG],
  ])('accepts a complete exact-catalog %s receipt', (schemaVersion, catalog) => {
    expect(() =>
      validateModelFleetReceipt(validReceipt(schemaVersion, catalog), schemaVersion),
    ).not.toThrow();
  });

  it('rejects duplicate, unknown, and provider-substituted routes', () => {
    const receipt = validReceipt(
      'nodeslide.model-fleet-probe/v1',
      NODE_SLIDE_OFFERED_ROUTE_CATALOG,
    );
    receipt.receipts[1] = structuredClone(receipt.receipts[0]);
    expect(() => validateModelFleetReceipt(receipt, receipt.schemaVersion)).toThrow(/duplicate/i);

    const unknown = validReceipt(
      'nodeslide.model-fleet-probe/v1',
      NODE_SLIDE_OFFERED_ROUTE_CATALOG,
    );
    unknown.receipts[0].model = 'attacker/unknown';
    expect(() => validateModelFleetReceipt(unknown, unknown.schemaVersion)).toThrow(/unknown/i);

    const substituted = validReceipt(
      'nodeslide.model-fleet-probe/v1',
      NODE_SLIDE_OFFERED_ROUTE_CATALOG,
    );
    substituted.receipts[0].actualProvider = 'different-provider';
    expect(() => validateModelFleetReceipt(substituted, substituted.schemaVersion)).toThrow(
      /exact provider/i,
    );
  });

  it('rejects pinned-model substitution and an unresolved dynamic free-router alias', () => {
    const pinned = validReceipt('nodeslide.model-fleet-probe/v1', NODE_SLIDE_OFFERED_ROUTE_CATALOG);
    const pinnedRoute = pinned.receipts.find((entry) => entry.model !== 'openrouter/free');
    pinnedRoute.actualModel = 'substituted/model';
    expect(() => validateModelFleetReceipt(pinned, pinned.schemaVersion)).toThrow(
      /resolved-model/i,
    );

    const dynamic = validReceipt(
      'nodeslide.free-router-fleet-probe/v1',
      NODE_SLIDE_FREE_ROUTE_CATALOG,
    );
    const freeRoute = dynamic.receipts.find((entry) => entry.model === 'openrouter/free');
    freeRoute.actualModel = 'openrouter/free';
    expect(() => validateModelFleetReceipt(dynamic, dynamic.schemaVersion)).toThrow(
      /resolved-model/i,
    );

    for (const invalidIdentity of [' ', 'unqualified-model', ' vendor/model', 'vendor/model ']) {
      const invalidDynamic = validReceipt(
        'nodeslide.free-router-fleet-probe/v1',
        NODE_SLIDE_FREE_ROUTE_CATALOG,
      );
      invalidDynamic.receipts.find((entry) => entry.model === 'openrouter/free').actualModel =
        invalidIdentity;
      expect(() => validateModelFleetReceipt(invalidDynamic, invalidDynamic.schemaVersion)).toThrow(
        /resolved-model identity/i,
      );
    }
  });

  it('requires exact integer metering and zero spend for a passing free route', () => {
    const charged = validReceipt(
      'nodeslide.free-router-fleet-probe/v1',
      NODE_SLIDE_FREE_ROUTE_CATALOG,
    );
    charged.receipts[0].costMicroUsd = 1;
    expect(() => validateModelFleetReceipt(charged, charged.schemaVersion)).toThrow(/zero-cost/i);

    for (const [field, value] of [
      ['latencyMs', 1.5],
      ['costMicroUsd', Number.MAX_SAFE_INTEGER + 1],
      ['inputTokens', 2.5],
      ['outputTokens', Number.NaN],
    ]) {
      const invalid = validReceipt(
        'nodeslide.model-fleet-probe/v1',
        NODE_SLIDE_OFFERED_ROUTE_CATALOG,
      );
      invalid.receipts[0][field] = value;
      expect(() => validateModelFleetReceipt(invalid, invalid.schemaVersion)).toThrow(
        new RegExp(`invalid ${field}`, 'i'),
      );
    }
    const fractionalBytes = validReceipt(
      'nodeslide.model-fleet-probe/v1',
      NODE_SLIDE_OFFERED_ROUTE_CATALOG,
    );
    fractionalBytes.receipts[0].response.bytes = 1.5;
    expect(() => validateModelFleetReceipt(fractionalBytes, fractionalBytes.schemaVersion)).toThrow(
      /response-presence/i,
    );
  });

  it('rejects contradictory aggregates, empty responses, and provider content', () => {
    const contradictory = validReceipt(
      'nodeslide.free-router-structured-probe/v1',
      NODE_SLIDE_FREE_ROUTE_CATALOG,
    );
    contradictory.failedModelCount = 1;
    expect(() => validateModelFleetReceipt(contradictory, contradictory.schemaVersion)).toThrow(
      /failed-route count/i,
    );

    const empty = validReceipt(
      'nodeslide.free-router-structured-probe/v1',
      NODE_SLIDE_FREE_ROUTE_CATALOG,
    );
    empty.receipts[0].response = { present: false, bytes: 0 };
    expect(() => validateModelFleetReceipt(empty, empty.schemaVersion)).toThrow(
      /response-presence/i,
    );

    const leaked = validReceipt('nodeslide.model-fleet-probe/v1', NODE_SLIDE_OFFERED_ROUTE_CATALOG);
    leaked.receipts[0].text = 'provider output';
    expect(() => validateModelFleetReceipt(leaked, leaked.schemaVersion)).toThrow(
      /forbidden provider-content/i,
    );
  });
});
