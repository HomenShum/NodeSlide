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
import type * as http from "../http.js";
import type * as lib_nodeslideAccess from "../lib/nodeslideAccess.js";
import type * as lib_nodeslideAgenticControls from "../lib/nodeslideAgenticControls.js";
import type * as lib_nodeslideAgenticTelemetry from "../lib/nodeslideAgenticTelemetry.js";
import type * as lib_nodeslideAnalysisKernel from "../lib/nodeslideAnalysisKernel.js";
import type * as lib_nodeslideArtifactArena from "../lib/nodeslideArtifactArena.js";
import type * as lib_nodeslideArtifactPresence from "../lib/nodeslideArtifactPresence.js";
import type * as lib_nodeslideAssistantStream from "../lib/nodeslideAssistantStream.js";
import type * as lib_nodeslideAuthoredArtifact from "../lib/nodeslideAuthoredArtifact.js";
import type * as lib_nodeslideAuthority from "../lib/nodeslideAuthority.js";
import type * as lib_nodeslideAutoRoutingPolicy from "../lib/nodeslideAutoRoutingPolicy.js";
import type * as lib_nodeslideBudgetLedger from "../lib/nodeslideBudgetLedger.js";
import type * as lib_nodeslideBudgetedProvider from "../lib/nodeslideBudgetedProvider.js";
import type * as lib_nodeslideCandidate from "../lib/nodeslideCandidate.js";
import type * as lib_nodeslideClaimEvidenceReceipt from "../lib/nodeslideClaimEvidenceReceipt.js";
import type * as lib_nodeslideCompositionFanout from "../lib/nodeslideCompositionFanout.js";
import type * as lib_nodeslideCompositionGrammars from "../lib/nodeslideCompositionGrammars.js";
import type * as lib_nodeslideCreationCritique from "../lib/nodeslideCreationCritique.js";
import type * as lib_nodeslideCreationTelemetry from "../lib/nodeslideCreationTelemetry.js";
import type * as lib_nodeslideData from "../lib/nodeslideData.js";
import type * as lib_nodeslideDataAttachment from "../lib/nodeslideDataAttachment.js";
import type * as lib_nodeslideDataExport from "../lib/nodeslideDataExport.js";
import type * as lib_nodeslideDeckCi from "../lib/nodeslideDeckCi.js";
import type * as lib_nodeslideDeckDiversity from "../lib/nodeslideDeckDiversity.js";
import type * as lib_nodeslideDeckFork from "../lib/nodeslideDeckFork.js";
import type * as lib_nodeslideDeckRepl from "../lib/nodeslideDeckRepl.js";
import type * as lib_nodeslideDeckRows from "../lib/nodeslideDeckRows.js";
import type * as lib_nodeslideDeckScopeAccess from "../lib/nodeslideDeckScopeAccess.js";
import type * as lib_nodeslideDesignPlan from "../lib/nodeslideDesignPlan.js";
import type * as lib_nodeslideDurableSessionState from "../lib/nodeslideDurableSessionState.js";
import type * as lib_nodeslideEditPlanner from "../lib/nodeslideEditPlanner.js";
import type * as lib_nodeslideEditShadowPlanner from "../lib/nodeslideEditShadowPlanner.js";
import type * as lib_nodeslideErasureContract from "../lib/nodeslideErasureContract.js";
import type * as lib_nodeslideErrorRedaction from "../lib/nodeslideErrorRedaction.js";
import type * as lib_nodeslideEvidenceCapture from "../lib/nodeslideEvidenceCapture.js";
import type * as lib_nodeslideExecutionTrace from "../lib/nodeslideExecutionTrace.js";
import type * as lib_nodeslideExecutionTraceValidator from "../lib/nodeslideExecutionTraceValidator.js";
import type * as lib_nodeslideGoogleOAuth from "../lib/nodeslideGoogleOAuth.js";
import type * as lib_nodeslideGoogleSlidesRuntime from "../lib/nodeslideGoogleSlidesRuntime.js";
import type * as lib_nodeslideGymArtifactEvidence from "../lib/nodeslideGymArtifactEvidence.js";
import type * as lib_nodeslideGymShadow from "../lib/nodeslideGymShadow.js";
import type * as lib_nodeslideIds from "../lib/nodeslideIds.js";
import type * as lib_nodeslideImageSearch from "../lib/nodeslideImageSearch.js";
import type * as lib_nodeslideInspirationSearch from "../lib/nodeslideInspirationSearch.js";
import type * as lib_nodeslideJobJournal from "../lib/nodeslideJobJournal.js";
import type * as lib_nodeslideJobState from "../lib/nodeslideJobState.js";
import type * as lib_nodeslideJobValidators from "../lib/nodeslideJobValidators.js";
import type * as lib_nodeslideLiveDeckRepl from "../lib/nodeslideLiveDeckRepl.js";
import type * as lib_nodeslideLiveRenderRepair from "../lib/nodeslideLiveRenderRepair.js";
import type * as lib_nodeslideManagedKernel from "../lib/nodeslideManagedKernel.js";
import type * as lib_nodeslideMemoryPolicy from "../lib/nodeslideMemoryPolicy.js";
import type * as lib_nodeslideModelFleetProbe from "../lib/nodeslideModelFleetProbe.js";
import type * as lib_nodeslideMultiAgent from "../lib/nodeslideMultiAgent.js";
import type * as lib_nodeslideOtlp from "../lib/nodeslideOtlp.js";
import type * as lib_nodeslidePatches from "../lib/nodeslidePatches.js";
import type * as lib_nodeslidePdfExtraction from "../lib/nodeslidePdfExtraction.js";
import type * as lib_nodeslidePreferenceEtl from "../lib/nodeslidePreferenceEtl.js";
import type * as lib_nodeslidePreferenceRetention from "../lib/nodeslidePreferenceRetention.js";
import type * as lib_nodeslideProductionProbe from "../lib/nodeslideProductionProbe.js";
import type * as lib_nodeslidePropagation from "../lib/nodeslidePropagation.js";
import type * as lib_nodeslideProvider from "../lib/nodeslideProvider.js";
import type * as lib_nodeslideProviderConsent from "../lib/nodeslideProviderConsent.js";
import type * as lib_nodeslidePublishApprovalPolicy from "../lib/nodeslidePublishApprovalPolicy.js";
import type * as lib_nodeslideQuota from "../lib/nodeslideQuota.js";
import type * as lib_nodeslideReadContext from "../lib/nodeslideReadContext.js";
import type * as lib_nodeslideRenderRepairLoop from "../lib/nodeslideRenderRepairLoop.js";
import type * as lib_nodeslideRoomReady from "../lib/nodeslideRoomReady.js";
import type * as lib_nodeslideRoutingPolicy from "../lib/nodeslideRoutingPolicy.js";
import type * as lib_nodeslideRoutingReceipt from "../lib/nodeslideRoutingReceipt.js";
import type * as lib_nodeslideRunBudget from "../lib/nodeslideRunBudget.js";
import type * as lib_nodeslideSeed from "../lib/nodeslideSeed.js";
import type * as lib_nodeslideSemanticEvaluation from "../lib/nodeslideSemanticEvaluation.js";
import type * as lib_nodeslideShadowComparison from "../lib/nodeslideShadowComparison.js";
import type * as lib_nodeslideShadowComparisonValidator from "../lib/nodeslideShadowComparisonValidator.js";
import type * as lib_nodeslideSignatureProfiles from "../lib/nodeslideSignatureProfiles.js";
import type * as lib_nodeslideSourceLineage from "../lib/nodeslideSourceLineage.js";
import type * as lib_nodeslideSourceRefresh from "../lib/nodeslideSourceRefresh.js";
import type * as lib_nodeslideSourceRevision from "../lib/nodeslideSourceRevision.js";
import type * as lib_nodeslideStoryBench from "../lib/nodeslideStoryBench.js";
import type * as lib_nodeslideStoryContext from "../lib/nodeslideStoryContext.js";
import type * as lib_nodeslideSyntheticCreationFault from "../lib/nodeslideSyntheticCreationFault.js";
import type * as lib_nodeslideTasteMismatch from "../lib/nodeslideTasteMismatch.js";
import type * as lib_nodeslideUploadPolicy from "../lib/nodeslideUploadPolicy.js";
import type * as lib_nodeslideValidation from "../lib/nodeslideValidation.js";
import type * as lib_nodeslideValidators from "../lib/nodeslideValidators.js";
import type * as lib_nodeslideVariationHarness from "../lib/nodeslideVariationHarness.js";
import type * as lib_nodeslideWorkflowCandidate from "../lib/nodeslideWorkflowCandidate.js";
import type * as nodeslide from "../nodeslide.js";
import type * as nodeslideAgent from "../nodeslideAgent.js";
import type * as nodeslideArtifactArena from "../nodeslideArtifactArena.js";
import type * as nodeslideArtifactSpec from "../nodeslideArtifactSpec.js";
import type * as nodeslideAuthoringQuality from "../nodeslideAuthoringQuality.js";
import type * as nodeslideBudgets from "../nodeslideBudgets.js";
import type * as nodeslideBuildIdentity from "../nodeslideBuildIdentity.js";
import type * as nodeslideDataExport from "../nodeslideDataExport.js";
import type * as nodeslideDeckCi from "../nodeslideDeckCi.js";
import type * as nodeslideDeckGrants from "../nodeslideDeckGrants.js";
import type * as nodeslideGoogleAuth from "../nodeslideGoogleAuth.js";
import type * as nodeslideGoogleSlidesRuntime from "../nodeslideGoogleSlidesRuntime.js";
import type * as nodeslideGymShadow from "../nodeslideGymShadow.js";
import type * as nodeslideImages from "../nodeslideImages.js";
import type * as nodeslideJobControl from "../nodeslideJobControl.js";
import type * as nodeslideJobRunner from "../nodeslideJobRunner.js";
import type * as nodeslideJobWorkflow from "../nodeslideJobWorkflow.js";
import type * as nodeslideJobs from "../nodeslideJobs.js";
import type * as nodeslideMemory from "../nodeslideMemory.js";
import type * as nodeslideModelProbe from "../nodeslideModelProbe.js";
import type * as nodeslidePptxCreate from "../nodeslidePptxCreate.js";
import type * as nodeslidePptxSync from "../nodeslidePptxSync.js";
import type * as nodeslidePreferences from "../nodeslidePreferences.js";
import type * as nodeslidePublishApproval from "../nodeslidePublishApproval.js";
import type * as nodeslideRetention from "../nodeslideRetention.js";
import type * as nodeslideScopedMemory from "../nodeslideScopedMemory.js";
import type * as nodeslideSessions from "../nodeslideSessions.js";
import type * as nodeslideSignatures from "../nodeslideSignatures.js";
import type * as nodeslideSourceRefresh from "../nodeslideSourceRefresh.js";
import type * as nodeslideSync from "../nodeslideSync.js";
import type * as nodeslideTelemetry from "../nodeslideTelemetry.js";
import type * as nodeslideUploadExtraction from "../nodeslideUploadExtraction.js";
import type * as nodeslideUploads from "../nodeslideUploads.js";
import type * as nodeslideVariationProof from "../nodeslideVariationProof.js";
import type * as nodeslideVariationProvider from "../nodeslideVariationProvider.js";
import type * as nodeslideVariations from "../nodeslideVariations.js";
import type * as workflows from "../workflows.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  http: typeof http;
  "lib/nodeslideAccess": typeof lib_nodeslideAccess;
  "lib/nodeslideAgenticControls": typeof lib_nodeslideAgenticControls;
  "lib/nodeslideAgenticTelemetry": typeof lib_nodeslideAgenticTelemetry;
  "lib/nodeslideAnalysisKernel": typeof lib_nodeslideAnalysisKernel;
  "lib/nodeslideArtifactArena": typeof lib_nodeslideArtifactArena;
  "lib/nodeslideArtifactPresence": typeof lib_nodeslideArtifactPresence;
  "lib/nodeslideAssistantStream": typeof lib_nodeslideAssistantStream;
  "lib/nodeslideAuthoredArtifact": typeof lib_nodeslideAuthoredArtifact;
  "lib/nodeslideAuthority": typeof lib_nodeslideAuthority;
  "lib/nodeslideAutoRoutingPolicy": typeof lib_nodeslideAutoRoutingPolicy;
  "lib/nodeslideBudgetLedger": typeof lib_nodeslideBudgetLedger;
  "lib/nodeslideBudgetedProvider": typeof lib_nodeslideBudgetedProvider;
  "lib/nodeslideCandidate": typeof lib_nodeslideCandidate;
  "lib/nodeslideClaimEvidenceReceipt": typeof lib_nodeslideClaimEvidenceReceipt;
  "lib/nodeslideCompositionFanout": typeof lib_nodeslideCompositionFanout;
  "lib/nodeslideCompositionGrammars": typeof lib_nodeslideCompositionGrammars;
  "lib/nodeslideCreationCritique": typeof lib_nodeslideCreationCritique;
  "lib/nodeslideCreationTelemetry": typeof lib_nodeslideCreationTelemetry;
  "lib/nodeslideData": typeof lib_nodeslideData;
  "lib/nodeslideDataAttachment": typeof lib_nodeslideDataAttachment;
  "lib/nodeslideDataExport": typeof lib_nodeslideDataExport;
  "lib/nodeslideDeckCi": typeof lib_nodeslideDeckCi;
  "lib/nodeslideDeckDiversity": typeof lib_nodeslideDeckDiversity;
  "lib/nodeslideDeckFork": typeof lib_nodeslideDeckFork;
  "lib/nodeslideDeckRepl": typeof lib_nodeslideDeckRepl;
  "lib/nodeslideDeckRows": typeof lib_nodeslideDeckRows;
  "lib/nodeslideDeckScopeAccess": typeof lib_nodeslideDeckScopeAccess;
  "lib/nodeslideDesignPlan": typeof lib_nodeslideDesignPlan;
  "lib/nodeslideDurableSessionState": typeof lib_nodeslideDurableSessionState;
  "lib/nodeslideEditPlanner": typeof lib_nodeslideEditPlanner;
  "lib/nodeslideEditShadowPlanner": typeof lib_nodeslideEditShadowPlanner;
  "lib/nodeslideErasureContract": typeof lib_nodeslideErasureContract;
  "lib/nodeslideErrorRedaction": typeof lib_nodeslideErrorRedaction;
  "lib/nodeslideEvidenceCapture": typeof lib_nodeslideEvidenceCapture;
  "lib/nodeslideExecutionTrace": typeof lib_nodeslideExecutionTrace;
  "lib/nodeslideExecutionTraceValidator": typeof lib_nodeslideExecutionTraceValidator;
  "lib/nodeslideGoogleOAuth": typeof lib_nodeslideGoogleOAuth;
  "lib/nodeslideGoogleSlidesRuntime": typeof lib_nodeslideGoogleSlidesRuntime;
  "lib/nodeslideGymArtifactEvidence": typeof lib_nodeslideGymArtifactEvidence;
  "lib/nodeslideGymShadow": typeof lib_nodeslideGymShadow;
  "lib/nodeslideIds": typeof lib_nodeslideIds;
  "lib/nodeslideImageSearch": typeof lib_nodeslideImageSearch;
  "lib/nodeslideInspirationSearch": typeof lib_nodeslideInspirationSearch;
  "lib/nodeslideJobJournal": typeof lib_nodeslideJobJournal;
  "lib/nodeslideJobState": typeof lib_nodeslideJobState;
  "lib/nodeslideJobValidators": typeof lib_nodeslideJobValidators;
  "lib/nodeslideLiveDeckRepl": typeof lib_nodeslideLiveDeckRepl;
  "lib/nodeslideLiveRenderRepair": typeof lib_nodeslideLiveRenderRepair;
  "lib/nodeslideManagedKernel": typeof lib_nodeslideManagedKernel;
  "lib/nodeslideMemoryPolicy": typeof lib_nodeslideMemoryPolicy;
  "lib/nodeslideModelFleetProbe": typeof lib_nodeslideModelFleetProbe;
  "lib/nodeslideMultiAgent": typeof lib_nodeslideMultiAgent;
  "lib/nodeslideOtlp": typeof lib_nodeslideOtlp;
  "lib/nodeslidePatches": typeof lib_nodeslidePatches;
  "lib/nodeslidePdfExtraction": typeof lib_nodeslidePdfExtraction;
  "lib/nodeslidePreferenceEtl": typeof lib_nodeslidePreferenceEtl;
  "lib/nodeslidePreferenceRetention": typeof lib_nodeslidePreferenceRetention;
  "lib/nodeslideProductionProbe": typeof lib_nodeslideProductionProbe;
  "lib/nodeslidePropagation": typeof lib_nodeslidePropagation;
  "lib/nodeslideProvider": typeof lib_nodeslideProvider;
  "lib/nodeslideProviderConsent": typeof lib_nodeslideProviderConsent;
  "lib/nodeslidePublishApprovalPolicy": typeof lib_nodeslidePublishApprovalPolicy;
  "lib/nodeslideQuota": typeof lib_nodeslideQuota;
  "lib/nodeslideReadContext": typeof lib_nodeslideReadContext;
  "lib/nodeslideRenderRepairLoop": typeof lib_nodeslideRenderRepairLoop;
  "lib/nodeslideRoomReady": typeof lib_nodeslideRoomReady;
  "lib/nodeslideRoutingPolicy": typeof lib_nodeslideRoutingPolicy;
  "lib/nodeslideRoutingReceipt": typeof lib_nodeslideRoutingReceipt;
  "lib/nodeslideRunBudget": typeof lib_nodeslideRunBudget;
  "lib/nodeslideSeed": typeof lib_nodeslideSeed;
  "lib/nodeslideSemanticEvaluation": typeof lib_nodeslideSemanticEvaluation;
  "lib/nodeslideShadowComparison": typeof lib_nodeslideShadowComparison;
  "lib/nodeslideShadowComparisonValidator": typeof lib_nodeslideShadowComparisonValidator;
  "lib/nodeslideSignatureProfiles": typeof lib_nodeslideSignatureProfiles;
  "lib/nodeslideSourceLineage": typeof lib_nodeslideSourceLineage;
  "lib/nodeslideSourceRefresh": typeof lib_nodeslideSourceRefresh;
  "lib/nodeslideSourceRevision": typeof lib_nodeslideSourceRevision;
  "lib/nodeslideStoryBench": typeof lib_nodeslideStoryBench;
  "lib/nodeslideStoryContext": typeof lib_nodeslideStoryContext;
  "lib/nodeslideSyntheticCreationFault": typeof lib_nodeslideSyntheticCreationFault;
  "lib/nodeslideTasteMismatch": typeof lib_nodeslideTasteMismatch;
  "lib/nodeslideUploadPolicy": typeof lib_nodeslideUploadPolicy;
  "lib/nodeslideValidation": typeof lib_nodeslideValidation;
  "lib/nodeslideValidators": typeof lib_nodeslideValidators;
  "lib/nodeslideVariationHarness": typeof lib_nodeslideVariationHarness;
  "lib/nodeslideWorkflowCandidate": typeof lib_nodeslideWorkflowCandidate;
  nodeslide: typeof nodeslide;
  nodeslideAgent: typeof nodeslideAgent;
  nodeslideArtifactArena: typeof nodeslideArtifactArena;
  nodeslideArtifactSpec: typeof nodeslideArtifactSpec;
  nodeslideAuthoringQuality: typeof nodeslideAuthoringQuality;
  nodeslideBudgets: typeof nodeslideBudgets;
  nodeslideBuildIdentity: typeof nodeslideBuildIdentity;
  nodeslideDataExport: typeof nodeslideDataExport;
  nodeslideDeckCi: typeof nodeslideDeckCi;
  nodeslideDeckGrants: typeof nodeslideDeckGrants;
  nodeslideGoogleAuth: typeof nodeslideGoogleAuth;
  nodeslideGoogleSlidesRuntime: typeof nodeslideGoogleSlidesRuntime;
  nodeslideGymShadow: typeof nodeslideGymShadow;
  nodeslideImages: typeof nodeslideImages;
  nodeslideJobControl: typeof nodeslideJobControl;
  nodeslideJobRunner: typeof nodeslideJobRunner;
  nodeslideJobWorkflow: typeof nodeslideJobWorkflow;
  nodeslideJobs: typeof nodeslideJobs;
  nodeslideMemory: typeof nodeslideMemory;
  nodeslideModelProbe: typeof nodeslideModelProbe;
  nodeslidePptxCreate: typeof nodeslidePptxCreate;
  nodeslidePptxSync: typeof nodeslidePptxSync;
  nodeslidePreferences: typeof nodeslidePreferences;
  nodeslidePublishApproval: typeof nodeslidePublishApproval;
  nodeslideRetention: typeof nodeslideRetention;
  nodeslideScopedMemory: typeof nodeslideScopedMemory;
  nodeslideSessions: typeof nodeslideSessions;
  nodeslideSignatures: typeof nodeslideSignatures;
  nodeslideSourceRefresh: typeof nodeslideSourceRefresh;
  nodeslideSync: typeof nodeslideSync;
  nodeslideTelemetry: typeof nodeslideTelemetry;
  nodeslideUploadExtraction: typeof nodeslideUploadExtraction;
  nodeslideUploads: typeof nodeslideUploads;
  nodeslideVariationProof: typeof nodeslideVariationProof;
  nodeslideVariationProvider: typeof nodeslideVariationProvider;
  nodeslideVariations: typeof nodeslideVariations;
  workflows: typeof workflows;
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

export declare const components: {
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  persistentTextStreaming: import("@convex-dev/persistent-text-streaming/_generated/component.js").ComponentApi<"persistentTextStreaming">;
};
