#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { validateNodeSlideBuiltHtmlIdentity } from './lib/production-deployment-identity.mjs';

const htmlPath = path.resolve(process.argv[2] ?? '');
const commitSha = process.argv[3] ?? '';
const html = await readFile(htmlPath, 'utf8');
validateNodeSlideBuiltHtmlIdentity(html, commitSha);
console.log(`[web-build-identity] PASS ${path.relative(process.cwd(), htmlPath)} -> ${commitSha}`);
