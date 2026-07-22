#!/usr/bin/env node
import process from 'node:process';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';
import {
  requiredExactMainSha,
  validateNodeSlideConvexBuildIdentity,
} from './lib/production-deployment-identity.mjs';

const commitSha = requiredExactMainSha(process.argv[2] ?? '', 'commitSha');
const client = new ConvexHttpClient('https://agile-stoat-411.convex.cloud');
let lastError;
let verified = false;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const identity = await client.query(api.nodeslideBuildIdentity.get, {});
    validateNodeSlideConvexBuildIdentity(identity, commitSha);
    console.log(`[convex-build-identity] PASS ${commitSha}`);
    verified = true;
    break;
  } catch (error) {
    lastError = error;
    if (attempt < 12) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
if (!verified) {
  throw new Error(
    lastError instanceof Error
      ? `Production Convex identity did not activate: ${lastError.message}`
      : 'Production Convex identity did not activate.',
  );
}
