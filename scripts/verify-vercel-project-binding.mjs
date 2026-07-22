#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { validateNodeSlideVercelProjectBinding } from './lib/production-deployment-identity.mjs';

const bindingPath = path.resolve(process.argv[2] ?? '.vercel/project.json');
const binding = JSON.parse(await readFile(bindingPath, 'utf8'));
const receipt = validateNodeSlideVercelProjectBinding(
  binding,
  process.env.VERCEL_ORG_ID,
  process.env.VERCEL_PROJECT_ID,
);
console.log(`[vercel-project-binding] PASS ${receipt.projectName}`);
