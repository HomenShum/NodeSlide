/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as lib_nodeslideAccess from "../lib/nodeslideAccess.js";
import type * as lib_nodeslideAgenticControls from "../lib/nodeslideAgenticControls.js";
import type * as lib_nodeslideAgenticTelemetry from "../lib/nodeslideAgenticTelemetry.js";
import type * as lib_nodeslideAnalysisKernel from "../lib/nodeslideAnalysisKernel.js";
import type * as lib_nodeslideAuthority from "../lib/nodeslideAuthority.js";
import type * as lib_nodeslideCandidate from "../lib/nodeslideCandidate.js";
import type * as lib_nodeslideCreationCritique from "../lib/nodeslideCreationCritique.js";
import type * as lib_nodeslideData from "../lib/nodeslideData.js";
import type * as lib_nodeslideDataAttachment from "../lib/nodeslideDataAttachment.js";
import type * as lib_nodeslideDeckRepl from "../lib/nodeslideDeckRepl.js";
import type * as lib_nodeslideEditPlanner from "../lib/nodeslideEditPlanner.js";
import type * as lib_nodeslideEditShadowPlanner from "../lib/nodeslideEditShadowPlanner.js";
import type * as lib_nodeslideExecutionTrace from "../lib/nodeslideExecutionTrace.js";
import type * as lib_nodeslideExecutionTraceValidator from "../lib/nodeslideExecutionTraceValidator.js";
import type * as lib_nodeslideIds from "../lib/nodeslideIds.js";
import type * as lib_nodeslideImageSearch from "../lib/nodeslideImageSearch.js";
import type * as lib_nodeslideInspirationSearch from "../lib/nodeslideInspirationSearch.js";
import type * as lib_nodeslideManagedKernel from "../lib/nodeslideManagedKernel.js";
import type * as lib_nodeslideOtlp from "../lib/nodeslideOtlp.js";
import type * as lib_nodeslidePatches from "../lib/nodeslidePatches.js";
import type * as lib_nodeslidePreferenceEtl from "../lib/nodeslidePreferenceEtl.js";
import type * as lib_nodeslidePreferenceRetention from "../lib/nodeslidePreferenceRetention.js";
import type * as lib_nodeslidePropagation from "../lib/nodeslidePropagation.js";
import type * as lib_nodeslideProvider from "../lib/nodeslideProvider.js";
import type * as lib_nodeslideProviderConsent from "../lib/nodeslideProviderConsent.js";
import type * as lib_nodeslideQuota from "../lib/nodeslideQuota.js";
import type * as lib_nodeslideReadContext from "../lib/nodeslideReadContext.js";
import type * as lib_nodeslideRenderRepairLoop from "../lib/nodeslideRenderRepairLoop.js";
import type * as lib_nodeslideSeed from "../lib/nodeslideSeed.js";
import type * as lib_nodeslideShadowComparison from "../lib/nodeslideShadowComparison.js";
import type * as lib_nodeslideShadowComparisonValidator from "../lib/nodeslideShadowComparisonValidator.js";
import type * as lib_nodeslideSignatureProfiles from "../lib/nodeslideSignatureProfiles.js";
import type * as lib_nodeslideStoryBench from "../lib/nodeslideStoryBench.js";
import type * as lib_nodeslideTasteMismatch from "../lib/nodeslideTasteMismatch.js";
import type * as lib_nodeslideValidation from "../lib/nodeslideValidation.js";
import type * as lib_nodeslideValidators from "../lib/nodeslideValidators.js";
import type * as lib_nodeslideVariationHarness from "../lib/nodeslideVariationHarness.js";
import type * as lib_nodeslideWorkflowCandidate from "../lib/nodeslideWorkflowCandidate.js";
import type * as nodeslide from "../nodeslide.js";
import type * as nodeslideAgent from "../nodeslideAgent.js";
import type * as nodeslideImages from "../nodeslideImages.js";
import type * as nodeslideMemory from "../nodeslideMemory.js";
import type * as nodeslidePreferences from "../nodeslidePreferences.js";
import type * as nodeslideSignatures from "../nodeslideSignatures.js";
import type * as nodeslideTelemetry from "../nodeslideTelemetry.js";
import type * as nodeslideVariationProof from "../nodeslideVariationProof.js";
import type * as nodeslideVariationProvider from "../nodeslideVariationProvider.js";
import type * as nodeslideVariations from "../nodeslideVariations.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "lib/nodeslideAccess": typeof lib_nodeslideAccess;
  "lib/nodeslideAgenticControls": typeof lib_nodeslideAgenticControls;
  "lib/nodeslideAgenticTelemetry": typeof lib_nodeslideAgenticTelemetry;
  "lib/nodeslideAnalysisKernel": typeof lib_nodeslideAnalysisKernel;
  "lib/nodeslideAuthority": typeof lib_nodeslideAuthority;
  "lib/nodeslideCandidate": typeof lib_nodeslideCandidate;
  "lib/nodeslideCreationCritique": typeof lib_nodeslideCreationCritique;
  "lib/nodeslideData": typeof lib_nodeslideData;
  "lib/nodeslideDataAttachment": typeof lib_nodeslideDataAttachment;
  "lib/nodeslideDeckRepl": typeof lib_nodeslideDeckRepl;
  "lib/nodeslideEditPlanner": typeof lib_nodeslideEditPlanner;
  "lib/nodeslideEditShadowPlanner": typeof lib_nodeslideEditShadowPlanner;
  "lib/nodeslideExecutionTrace": typeof lib_nodeslideExecutionTrace;
  "lib/nodeslideExecutionTraceValidator": typeof lib_nodeslideExecutionTraceValidator;
  "lib/nodeslideIds": typeof lib_nodeslideIds;
  "lib/nodeslideImageSearch": typeof lib_nodeslideImageSearch;
  "lib/nodeslideInspirationSearch": typeof lib_nodeslideInspirationSearch;
  "lib/nodeslideManagedKernel": typeof lib_nodeslideManagedKernel;
  "lib/nodeslideOtlp": typeof lib_nodeslideOtlp;
  "lib/nodeslidePatches": typeof lib_nodeslidePatches;
  "lib/nodeslidePreferenceEtl": typeof lib_nodeslidePreferenceEtl;
  "lib/nodeslidePreferenceRetention": typeof lib_nodeslidePreferenceRetention;
  "lib/nodeslidePropagation": typeof lib_nodeslidePropagation;
  "lib/nodeslideProvider": typeof lib_nodeslideProvider;
  "lib/nodeslideProviderConsent": typeof lib_nodeslideProviderConsent;
  "lib/nodeslideQuota": typeof lib_nodeslideQuota;
  "lib/nodeslideReadContext": typeof lib_nodeslideReadContext;
  "lib/nodeslideRenderRepairLoop": typeof lib_nodeslideRenderRepairLoop;
  "lib/nodeslideSeed": typeof lib_nodeslideSeed;
  "lib/nodeslideShadowComparison": typeof lib_nodeslideShadowComparison;
  "lib/nodeslideShadowComparisonValidator": typeof lib_nodeslideShadowComparisonValidator;
  "lib/nodeslideSignatureProfiles": typeof lib_nodeslideSignatureProfiles;
  "lib/nodeslideStoryBench": typeof lib_nodeslideStoryBench;
  "lib/nodeslideTasteMismatch": typeof lib_nodeslideTasteMismatch;
  "lib/nodeslideValidation": typeof lib_nodeslideValidation;
  "lib/nodeslideValidators": typeof lib_nodeslideValidators;
  "lib/nodeslideVariationHarness": typeof lib_nodeslideVariationHarness;
  "lib/nodeslideWorkflowCandidate": typeof lib_nodeslideWorkflowCandidate;
  nodeslide: typeof nodeslide;
  nodeslideAgent: typeof nodeslideAgent;
  nodeslideImages: typeof nodeslideImages;
  nodeslideMemory: typeof nodeslideMemory;
  nodeslidePreferences: typeof nodeslidePreferences;
  nodeslideSignatures: typeof nodeslideSignatures;
  nodeslideTelemetry: typeof nodeslideTelemetry;
  nodeslideVariationProof: typeof nodeslideVariationProof;
  nodeslideVariationProvider: typeof nodeslideVariationProvider;
  nodeslideVariations: typeof nodeslideVariations;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
