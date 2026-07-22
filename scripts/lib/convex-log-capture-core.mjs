const UDF_TYPES = new Set(['Query', 'Mutation', 'Action', 'HttpAction']);

/**
 * Accept only the execution-record shapes emitted by Convex's pinned JSONL
 * logs API. Generic JSON metadata must never count as production log evidence.
 */
export function isRecognizedConvexExecutionRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!UDF_TYPES.has(value.udfType)) return false;
  if (!finiteNonNegative(value.timestamp)) return false;
  if (!boundedText(value.identifier, 200)) return false;
  if (!boundedText(value.executionId, 500)) return false;
  if (!boundedText(value.requestId, 500)) return false;
  if (!Array.isArray(value.logLines)) return false;
  if (
    value.componentPath !== undefined &&
    value.componentPath !== null &&
    !boundedText(value.componentPath, 500)
  )
    return false;

  if (value.kind === 'Progress') return true;
  if (value.kind !== 'Completion') return false;
  return (
    typeof value.cachedResult === 'boolean' &&
    boundedText(value.caller, 500) &&
    boundedText(value.environment, 500) &&
    finiteNonNegative(value.executionTime) &&
    boundedText(value.identityType, 500) &&
    typeof value.willRetry === 'boolean' &&
    value.usageStats !== null &&
    typeof value.usageStats === 'object' &&
    !Array.isArray(value.usageStats)
  );
}

function boundedText(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
