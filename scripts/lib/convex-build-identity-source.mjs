export function renderConvexBuildIdentitySource(commitSha) {
  if (typeof commitSha !== 'string' || !/^[0-9a-f]{40}$/u.test(commitSha)) {
    throw new Error('Convex build identity requires an exact 40-character commit SHA.');
  }
  return `/** Generated immediately before the production Convex deploy. */\nexport const NODESLIDE_DEPLOYED_BUILD_SHA = '${commitSha}' as const;\n`;
}
