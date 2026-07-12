import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchSourceSnapshot, normalizeSnapshot, paths } from './lib/news-agent-core.mjs';

let raw;

try {
  raw = JSON.parse(await fs.readFile(paths.rawSnapshot, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  raw = await fetchSourceSnapshot();
  await fs.mkdir(path.dirname(paths.rawSnapshot), { recursive: true });
  await fs.writeFile(paths.rawSnapshot, JSON.stringify(raw, null, 2));
}

const normalized = normalizeSnapshot(raw);
await fs.mkdir(path.dirname(paths.normalizedStories), { recursive: true });
await fs.writeFile(paths.normalizedStories, JSON.stringify(normalized, null, 2));
console.log(`Normalized ${normalized.storyCount} stories -> ${paths.normalizedStories}`);
