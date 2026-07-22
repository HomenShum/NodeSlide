#!/usr/bin/env node
import process from 'node:process';
import {
  captureWebDeploymentIdentity,
  requiredExactMainSha,
  requiredNodeSlideProductionOrigin,
} from './lib/production-deployment-identity.mjs';

const commitSha = requiredExactMainSha(process.argv[2] ?? '', 'commitSha');
const origin = requiredNodeSlideProductionOrigin(
  process.argv[3] ?? 'https://nodeslide.vercel.app/',
  'production origin',
);
const identity = await captureWebDeploymentIdentity(origin, commitSha);
console.log(
  `[web-live-identity] PASS ${commitSha} html=${identity.html.digest} assets=${identity.assets.length}`,
);
