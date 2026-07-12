import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const remoteCheck = await runGit(['remote']).catch(() => ({ stdout: '' }));
const remotes = remoteCheck.stdout
  .split('\n')
  .map((item) => item.trim())
  .filter(Boolean);

if (!remotes.includes('origin')) {
  console.log('No git remote named origin. Skipping publish.');
  process.exit(0);
}

const diff = await runGit(['status', '--short']);

if (!diff.stdout.trim()) {
  console.log('No changes to publish.');
  process.exit(0);
}

await runGit(['add', 'src/data/live-intelligence.json']);
await runGit(['commit', '-m', `chore: refresh ai news stand digest (${new Date().toISOString().slice(0, 10)})`]).catch((error) => {
  if (!String(error.stderr || error.message).includes('nothing to commit')) throw error;
});
await runGit(['push']);
console.log('Published latest AI news stand digest.');

async function runGit(args) {
  return execFileAsync('git', args, { cwd: repoRoot });
}
