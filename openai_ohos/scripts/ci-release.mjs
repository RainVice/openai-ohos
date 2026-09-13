import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import { root, run } from './toolchain.mjs';
import { verifyReleaseHash } from './publish-ohpm.mjs';
import { planRelease, publishedVersions, stableVersion as stable } from './release-version.mjs';

const repo = path.dirname(root);
const manifestPath = path.join(root, 'oh-package.json5');
const manifest = JSON5.parse(fs.readFileSync(manifestPath, 'utf8'));
const output = (name, value) => {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
const step = process.argv[2];
if (step === 'plan') {
  const latest = stable(JSON.parse(run('npm', ['view', 'openai@latest', 'version', '--json', '--registry', 'https://registry.npmjs.org'], root, { encoding: 'utf8', stdio: 'pipe' })));
  const tags = run('git', ['tag', '--list', 'ohpm-v*'], repo, { encoding: 'utf8', stdio: 'pipe' }).trim().split('\n');
  const plan = planRelease({ latest, publishedVersions: await publishedVersions(manifest.name), submittedTags: tags });
  output('needed', String(plan.needed));
  output('upstream', plan.upstream);
  output('version', plan.version);
  output('reason', plan.reason);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `Official latest: **${latest}**. OHPM target: **${plan.version}**. Decision: **${plan.reason}**.\n\nPublishing uses a GitHub-hosted runner. Configure the three OHPM Secrets and \`HARMONY_CLT_URL\`; no self-hosted runner is needed.\n`);
} else if (step === 'commit') {
  const report = verifyReleaseHash(path.join(root, 'dist/openai_ohos.har'));
  const branch = run('git', ['branch', '--show-current'], repo, { encoding: 'utf8', stdio: 'pipe' }).trim();
  if (branch !== 'ohos') throw new Error('Release commits must target ohos');
  run('git', ['config', 'user.name', 'github-actions[bot]'], repo);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], repo);
  const files = ['package.json', 'package-lock.json', 'oh-package.json5', 'CHANGELOG.md', 'src/main/resources/rawfile/runtime-licenses.txt'];
  run('git', ['add', ...files.map(file => `openai_ohos/${file}`)], repo);
  const changed = run('git', ['diff', '--cached', '--name-only'], repo, { encoding: 'utf8', stdio: 'pipe' }).trim();
  if (changed) run('git', ['commit', '-m', `chore(release): openai_ohos ${report.version}, OpenAI ${report.upstreamVersion}`], repo);
  run('git', ['push', 'origin', 'HEAD:ohos'], repo);
} else if (step === 'tag') {
  const report = verifyReleaseHash(path.join(root, 'dist/openai_ohos.har'));
  const tag = `ohpm-v${stable(report.version)}`;
  const exists = run('git', ['tag', '--list', tag], repo, { encoding: 'utf8', stdio: 'pipe' }).trim();
  if (!exists) run('git', ['tag', '-a', tag, '-m', `Submitted openai_ohos ${report.version} to OHPM (review may be pending)`], repo);
  run('git', ['push', 'origin', `refs/tags/${tag}`], repo);
} else throw new Error('Usage: ci-release.mjs plan|commit|tag');
