import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import { root, run } from './toolchain.mjs';
import { verifyReleaseHash } from './publish-ohpm.mjs';

const repo = path.dirname(root);
const manifestPath = path.join(root, 'oh-package.json5');
const manifest = JSON5.parse(fs.readFileSync(manifestPath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const stable = value => { if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) throw new Error('Expected a stable semantic version'); return value; };
const output = (name, value) => {
  console.log(`${name}=${value}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
const step = process.argv[2];
if (step === 'plan') {
  const latest = stable(JSON.parse(run('npm', ['view', 'openai@latest', 'version', '--json', '--registry', 'https://registry.npmjs.org'], root, { encoding: 'utf8', stdio: 'pipe' })));
  const current = lock.packages['node_modules/openai'].version;
  const version = stable(manifest.version);
  const tags = run('git', ['tag', '--list', `ohpm-v${version}`], repo, { encoding: 'utf8', stdio: 'pipe' }).trim();
  const pendingCurrent = !tags;
  // Complete a pending release before advancing again; avoids skipping versions on retry.
  const target = pendingCurrent ? current : latest;
  const updated = target !== current;
  const numbers = version.split('.').map(Number);
  const next = updated ? `${numbers[0]}.${numbers[1]}.${numbers[2] + 1}` : version;
  output('needed', updated || pendingCurrent ? 'true' : 'false');
  output('upstream', target);
  output('version', next);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `Official latest: **${latest}**. Planned: OpenAI **${target}**, OHPM **${next}**.\n\nSet repository variable \`OHPM_RELEASE_ENABLED=true\` only after configuring the \`ohos\` runner and the three OHPM Secrets.\n`);
} else if (step === 'prepare') {
  const version = stable(process.env.RELEASE_VERSION);
  const upstream = stable(process.env.OPENAI_VERSION);
  if (version !== manifest.version) {
    const previous = lock.packages['node_modules/openai'].version;
    manifest.version = version;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const changelog = path.join(root, 'CHANGELOG.md');
    const heading = `## ${version}`;
    const original = fs.readFileSync(changelog, 'utf8');
    if (!original.includes(heading)) fs.writeFileSync(changelog, original.replace('# 更新日志\n',
      `# 更新日志\n\n${heading} (${new Date().toISOString().slice(0, 10)})\n\n- 同步官方 OpenAI SDK：${previous} → ${upstream}。\n- 经语法转换、行为回归和独立 HAR 消费构建验证。\n`));
  }
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
  run('git', ['tag', '-a', tag, '-m', `Submitted openai_ohos ${report.version} to OHPM (review may be pending)`], repo);
  run('git', ['push', 'origin', `refs/tags/${tag}`], repo);
} else throw new Error('Usage: ci-release.mjs plan|prepare|commit|tag');
