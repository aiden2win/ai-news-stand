import { runNewsAgent } from './lib/news-agent-core.mjs';

runNewsAgent().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
