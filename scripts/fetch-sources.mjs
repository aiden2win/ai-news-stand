import { fetchSourceSnapshot, paths } from './lib/news-agent-core.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';

const snapshot = await fetchSourceSnapshot();
await fs.mkdir(path.dirname(paths.rawSnapshot), { recursive: true });
await fs.writeFile(paths.rawSnapshot, JSON.stringify(snapshot, null, 2));
console.log(`Fetched ${snapshot.sources.length} sources -> ${paths.rawSnapshot}`);
