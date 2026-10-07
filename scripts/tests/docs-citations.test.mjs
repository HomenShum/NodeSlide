/**
 * The documentation guard: a citation must name what it points at.
 *
 * The situation this exists for. A new engineer clones the repository, reads a document, and
 * follows a pointer in it — a link to a config file, or a `file.ts:412` reference that claims a
 * particular function lives there. When the pointer is stale they do not conclude "the document
 * drifted"; they conclude the repository is untrustworthy, and they are right to.
 *
 * The version of this guard that everyone writes first checks that the cited LINE NUMBER is within
 * the file. That proves the anchor is stable, never that it is correct: a citation can point twenty
 * lines past the symbol it names and pass forever. Measured on this repository before the guard
 * existed: 14 `file:line` citations, of which 8 pointed at the wrong line — `convex/schema.ts:486`
 * for a table that starts at 1004, `convex/nodeslideAgent.ts:94` for an action at 481. Every one of
 * them was inside its file, so a range check saw nothing.
 *
 * So each citation carries the symbol or literal a reader should land on, written as
 *
 *     `convex/nodeslideAgent.ts:1801` (`publicCreationEnabled`)
 *
 * and this guard asserts the cited lines actually contain it. When code moves, the guard fails and
 * names the document, the line, and what it expected. When a citation was simply wrong, it fails on
 * the first run.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

/** README plus every markdown file under docs/ and promotion/ — what a stranger is pointed at. */
function documents() {
  const found = ['README.md'];
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(relative);
      else if (entry.name.endsWith('.md')) found.push(relative);
    }
  };
  walk('docs');
  walk('promotion');
  return found;
}

const DOCUMENTS = documents();

/**
 * A citation is a backticked source path with a line or line range. Requiring a source extension
 * keeps `localhost:5180` and `127.0.0.1:3210` out; they are addresses, not citations.
 */
const CITATION = /`([\w./-]+\.(?:ts|tsx|mjs|js|py|json|md)):([\d/-]+)`(?:\s*\(`([^`]+)`\))?/g;

/** One line or one contiguous range. `nodeslide.ts:368/382/396` is three claims wearing one anchor. */
const ANCHOR = /^(\d+)(?:-(\d+))?$/;

/**
 * A range wide enough to swallow a whole file would let `file.ts:1-9999` satisfy any expectation.
 * Forty lines is roughly one screen: enough to cite a function, not enough to cite a module.
 */
const MAX_CITED_LINES = 40;

function citations() {
  const found = [];
  for (const doc of DOCUMENTS) {
    read(doc)
      .split(/\r?\n/)
      .forEach((text, index) => {
        for (const match of text.matchAll(CITATION)) {
          const anchor = ANCHOR.exec(match[2]);
          found.push({
            where: `${doc}:${index + 1}`,
            citation: match[0],
            file: match[1],
            start: anchor ? Number(anchor[1]) : null,
            end: anchor ? Number(anchor[2] ?? anchor[1]) : null,
            expected: match[3],
          });
        }
      });
  }
  return found;
}

describe('documentation citations', () => {
  it('finds citations to check, so a silent zero cannot pass for a clean run', () => {
    expect(citations().length).toBeGreaterThan(0);
  });

  it('points every relative link at a path that exists', () => {
    const broken = [];
    let checked = 0;
    for (const doc of DOCUMENTS) {
      for (const match of read(doc).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1];
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        checked += 1;
        const file = decodeURI(target.split('#')[0]);
        if (!file) continue;
        if (!existsSync(path.resolve(repoRoot, path.dirname(doc), file))) {
          broken.push(`${doc} -> ${target}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(broken).toEqual([]);
  });

  it('makes every file:line citation name the symbol a reader should land on', () => {
    const missing = citations()
      .filter((entry) => !entry.expected)
      .map(
        (entry) =>
          `${entry.where}: ${entry.citation} carries no expected symbol. Write it as ${entry.citation} (\`symbolOnThatLine\`).`,
      );
    expect(missing).toEqual([]);
  });

  it('asserts the cited lines contain what the citation says they contain', () => {
    const wrong = [];
    for (const entry of citations()) {
      if (!entry.expected) continue;
      if (entry.start === null) {
        wrong.push(`${entry.where}: ${entry.citation} is not one line or one range`);
        continue;
      }
      const absolute = path.join(repoRoot, entry.file);
      if (!existsSync(absolute)) {
        wrong.push(`${entry.where}: ${entry.file} does not exist`);
        continue;
      }
      const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
      if (entry.end < entry.start || entry.end > lines.length) {
        wrong.push(
          `${entry.where}: ${entry.file} has ${lines.length} lines, citation asks for ${entry.start}-${entry.end}`,
        );
        continue;
      }
      if (entry.end - entry.start + 1 > MAX_CITED_LINES) {
        wrong.push(
          `${entry.where}: ${entry.citation} spans ${entry.end - entry.start + 1} lines; cite at most ${MAX_CITED_LINES}`,
        );
        continue;
      }
      const cited = lines.slice(entry.start - 1, entry.end).join('\n');
      if (!cited.includes(entry.expected)) {
        wrong.push(
          `${entry.where}: ${entry.file}:${entry.start}${entry.end === entry.start ? '' : `-${entry.end}`} does not contain "${entry.expected}"`,
        );
      }
    }
    expect(wrong).toEqual([]);
  });

  /**
   * The defect a cold reader hit: the quickstart produced an app whose Create button always failed,
   * because deck creation is admission-gated and the README named none of the three variables that
   * open the gate. Reading the names out of the source rather than restating them here means a
   * rename in `convex/nodeslideAgent.ts` fails this test instead of silently rotting the README.
   */
  it('names every deck-creation admission variable in the README', () => {
    const declared = [
      ...read('convex/nodeslideAgent.ts').matchAll(/const NODESLIDE_\w+_ENV = '([^']+)'/g),
    ].map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(0);
    const readme = read('README.md');
    expect(declared.filter((name) => !readme.includes(name))).toEqual([]);
    expect(readme).toContain('npx convex env set NODESLIDE_PUBLIC_CREATION true');
  });
});
