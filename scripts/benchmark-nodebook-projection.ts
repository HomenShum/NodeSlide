import { performance } from 'node:perf_hooks';

const slideIds = Array.from({ length: 100 }, (_, index) => `slide-${index}`);
const elements = Array.from({ length: 4_899 }, (_, index) => ({ id: `element-${index}`, slideId: slideIds[index % slideIds.length]! }));
const iterations = 200;

let beforeChecks = 0;
let startedAt = performance.now();
for (let run = 0; run < iterations; run += 1) {
  for (const slideId of slideIds) {
    elements.filter((element) => { beforeChecks += 1; return element.slideId === slideId; });
    elements.filter((element) => { beforeChecks += 1; return element.slideId === slideId; });
  }
}
const beforeMs = performance.now() - startedAt;

let afterChecks = 0;
startedAt = performance.now();
for (let run = 0; run < iterations; run += 1) {
  const bySlide = new Map(slideIds.map((id) => [id, [] as typeof elements]));
  for (const element of elements) { afterChecks += 1; bySlide.get(element.slideId)!.push(element); }
  for (const slideId of slideIds) void bySlide.get(slideId);
}
const afterMs = performance.now() - startedAt;
if (afterChecks !== elements.length * iterations) throw new Error('indexed projection check accounting drifted');
console.log(JSON.stringify({ scenario: "100 slides and 4899 elements across 200 projections", beforeMs: Number(beforeMs.toFixed(1)), afterMs: Number(afterMs.toFixed(1)), speedup: Number((beforeMs / afterMs).toFixed(2)), beforeMembershipChecks: beforeChecks, afterMembershipChecks: afterChecks, checkReduction: Number((beforeChecks / afterChecks).toFixed(0)) }));
