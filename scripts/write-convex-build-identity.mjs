#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { renderConvexBuildIdentitySource } from './lib/convex-build-identity-source.mjs';

const commitSha = process.argv[2] ?? '';
const outputPath = path.resolve('convex/lib/nodeslideBuildIdentity.generated.ts');
await writeFile(outputPath, renderConvexBuildIdentitySource(commitSha), { mode: 0o600 });
console.log(`[convex-build-identity] stamped ${commitSha}`);
