import fs from 'node:fs/promises';
import { assessLowQuality, eventTokenSimilarity, inferCategory, inferEntities } from './lib/news-agent-quality.mjs';

const fixtureUrl = new URL('../tests/fixtures/news-agent-eval.json', import.meta.url);
const fixture = JSON.parse(await fs.readFile(fixtureUrl, 'utf8'));

let categoryCorrect = 0;
let entityCorrect = 0;
for (const item of fixture.classificationCases) {
  if (inferCategory(item.title, item.description) === item.expectedCategory) categoryCorrect += 1;
  const actualEntities = inferEntities(item.title, item.description);
  if (item.expectedEntities.every((entity) => actualEntities.includes(entity))) entityCorrect += 1;
}
const rejected = fixture.rejectionCases.filter((item) => !assessLowQuality(item).accepted).length;
const duplicateSimilarity = fixture.duplicatePairs.map((item) => eventTokenSimilarity(item.left, item.right));
const metrics = {
  categoryAccuracy: categoryCorrect / fixture.classificationCases.length,
  entityRecall: entityCorrect / fixture.classificationCases.length,
  rejectionRecall: rejected / fixture.rejectionCases.length,
  duplicatePairRecall: duplicateSimilarity.filter((score) => score >= 0.34).length / fixture.duplicatePairs.length,
  duplicateSimilarity,
};
const passed = metrics.categoryAccuracy >= 0.8 && metrics.entityRecall >= 0.9 && metrics.rejectionRecall === 1 && metrics.duplicatePairRecall === 1;
process.stdout.write(`${JSON.stringify({ passed, metrics }, null, 2)}\n`);
if (!passed) process.exitCode = 1;
