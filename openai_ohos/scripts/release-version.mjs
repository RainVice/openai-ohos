import fs from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';

export function stableVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) throw new Error('Expected a stable semantic version');
  return value;
}

export function planRelease({ latest, publishedVersions, submittedTags }) {
  const version = stableVersion(latest);
  const published = publishedVersions.includes(version);
  const submitted = submittedTags.includes(`ohpm-v${version}`);
  return {
    needed: !published && !submitted,
    upstream: version,
    version,
    reason: published ? 'version-already-published' : submitted ? 'version-already-submitted' : 'new-or-first-release',
  };
}

export async function publishedVersions(packageName, request = fetch) {
  const response = await request(`https://ohpm.openharmony.cn/ohpm/${encodeURIComponent(packageName)}`, {
    headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`OHPM version lookup failed: HTTP ${response.status}. Refusing to guess publication state.`);
  const metadata = await response.json();
  if (!metadata.versions || typeof metadata.versions !== 'object' || Array.isArray(metadata.versions)) {
    throw new Error('Invalid OHPM package metadata: missing versions');
  }
  return Object.keys(metadata.versions);
}

export function alignPackageVersion(root, version, date = new Date().toISOString().slice(0, 10)) {
  stableVersion(version);
  const file = path.join(root, 'oh-package.json5');
  const manifest = JSON5.parse(fs.readFileSync(file, 'utf8'));
  const changed = manifest.version !== version;
  manifest.version = version;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  const changelog = path.join(root, 'CHANGELOG.md');
  const original = fs.readFileSync(changelog, 'utf8');
  if (!original.split('\n').some(line => line === `## ${version}` || line.startsWith(`## ${version} (`))) {
    fs.writeFileSync(changelog, original.replace('# 更新日志\n',
      `# 更新日志\n\n## ${version} (${date})\n\n- 同步官方 OpenAI SDK ${version}，模块版本与官方 SDK 对齐。\n- 保留官方 API，实现 HarmonyOS 运行时适配。\n`));
  }
  return changed;
}
