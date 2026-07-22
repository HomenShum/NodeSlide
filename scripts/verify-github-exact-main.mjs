#!/usr/bin/env node
import process from 'node:process';
import { verifyNodeSlideExactMainSource } from './lib/production-deployment-identity.mjs';

const commitSha = process.argv[2] ?? '';
const receipt = await verifyNodeSlideExactMainSource(commitSha, process.env.GITHUB_TOKEN);
console.log(
  `[production-source] PASS ${receipt.commitSha} is current main with successful trusted CI run ${receipt.ciRunId}`,
);
