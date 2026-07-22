#!/usr/bin/env node
import process from 'node:process';
import { assertNodeSlideProductionDeployKey } from './lib/production-deployment-identity.mjs';

assertNodeSlideProductionDeployKey(process.env.CONVEX_DEPLOY_KEY);
console.log('[production-secret-scope] PASS Convex key targets the pinned production deployment');
