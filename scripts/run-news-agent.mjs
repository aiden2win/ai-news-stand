import { runNewsAgent } from './lib/news-agent-core.mjs';

const result = await runNewsAgent();
console.log(`Agent completed: ${result.storyCount} stories from ${result.sourceCount} sources`);
