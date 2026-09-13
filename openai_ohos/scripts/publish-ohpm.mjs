import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { root, run, ohpmBinary } from './toolchain.mjs';
import { publishedVersions } from './release-version.mjs';

export function validateCredentials(env) {
  for (const name of ['OHPM_PUBLISH_ID', 'OHPM_PRIVATE_KEY', 'OHPM_KEY_PASSPHRASE']) {
    if (!env[name]?.trim()) throw new Error(`Missing GitHub Secret: ${name}`);
  }
  if (/[\r\n]/.test(env.OHPM_PUBLISH_ID)) throw new Error('Invalid OHPM_PUBLISH_ID');
  const pem = env.OHPM_PRIVATE_KEY.replace(/\r\n/g, '\n');
  if (!/ENCRYPTED/.test(pem)) throw new Error('OHPM requires a password-encrypted PEM private key');
  if (!/^security:[^\r\n]+$/.test(env.OHPM_KEY_PASSPHRASE)) throw new Error('OHPM_KEY_PASSPHRASE must contain ohpm config encrypt ciphertext (security:...), not a raw password');
  if (!env.OHPM_CRYPTO_PATH || !fs.existsSync(env.OHPM_CRYPTO_PATH) || !fs.statSync(env.OHPM_CRYPTO_PATH).isDirectory()) throw new Error('Set OHPM_CRYPTO_PATH to the matching runner encryption component directory');
  return pem;
}

export function verifyReleaseHash(archive) {
  const report = JSON.parse(fs.readFileSync(`${archive}.verification.json`, 'utf8'));
  const hash = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (hash !== report.sha256 || report.prepublish !== 'passed' || report.isolatedConsumerBuild !== 'passed' || report.mode !== 'release') {
    throw new Error('Release hash or required verification results do not match');
  }
  return report;
}

export async function publish(env = process.env) {
  const archive = path.join(root, 'dist/openai_ohos.har');
  const report = verifyReleaseHash(archive);
  if (report.version !== report.upstreamVersion) throw new Error('Release version is not aligned with the official SDK');
  // Recheck immediately before publication; the registry can change after planning/building.
  if ((await publishedVersions(report.package)).includes(report.version)) {
    console.log(`Skipped ${report.package}@${report.version}: this version is already published on OHPM.`);
    return report;
  }
  const pem = validateCredentials(env);
  const temporary = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'ohpm-publish-'));
  const privateKey = path.join(temporary, 'private.pem');
  const cryptoDirectory = path.resolve(env.OHPM_CRYPTO_PATH);
  try {
    fs.writeFileSync(privateKey, pem, { mode: 0o600 });
    // OHPM config encrypt requires an interactive TTY. The operator generates
    // ciphertext on the runner once; CI uses that ciphertext and matching component.
    const fields = {
      publish_registry: 'https://ohpm.openharmony.cn/ohpm',
      publish_id: env.OHPM_PUBLISH_ID,
      key_path: privateKey.replace(/\\/g, '/'),
      crypto_path: cryptoDirectory.replace(/\\/g, '/'),
      key_passphrase: env.OHPM_KEY_PASSPHRASE,
      log_level: 'warn',
    };
    fs.writeFileSync(path.join(temporary, '.ohpmrc'), Object.entries(fields).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
    // No writes to the user's global .ohpmrc. Project config is scoped to this temporary cwd.
    run(ohpmBinary(), ['publish', archive], temporary, { stdio: 'pipe', timeout: 300000 });
    console.log(`Submitted ${report.package}@${report.version} to OHPM. Repository review may still be pending.`);
    return report;
  } catch (error) {
    // Child output can include authentication material; never forward it to Actions logs.
    throw new Error(`OHPM publication did not complete (${error.status ?? error.code ?? 'configuration error'}). Check OHPM account, public key and package review status before retrying.`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await publish();
