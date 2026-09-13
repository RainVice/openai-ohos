import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createPrivateKey } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { root, run, ohpmBinary } from './toolchain.mjs';
import { publishedVersions } from './release-version.mjs';
import { publicationDiagnostic } from './publish-diagnostics.mjs';
import JSON5 from 'json5';
import { readArchiveFile } from './archive.mjs';
import { validateRegistryMetadata } from './registry-metadata.mjs';

export function validateCredentials(env) {
  for (const name of ['OHPM_PUBLISH_ID', 'OHPM_PRIVATE_KEY', 'OHPM_KEY_PASSPHRASE']) {
    if (!env[name]?.trim()) throw new Error(`Missing GitHub Secret: ${name}`);
  }
  if (/[\r\n]/.test(env.OHPM_PUBLISH_ID)) throw new Error('Invalid OHPM_PUBLISH_ID');
  const pem = env.OHPM_PRIVATE_KEY.replace(/\r\n/g, '\n');
  if (!/ENCRYPTED/.test(pem)) throw new Error('OHPM requires a password-encrypted PEM private key');
  if (/[\r\n\x00-\x1f\x7f]/.test(env.OHPM_KEY_PASSPHRASE)) throw new Error('Private-key passphrase must not contain control characters');
  try {
    const key = createPrivateKey({ key: pem, passphrase: env.OHPM_KEY_PASSPHRASE });
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 4096) throw new Error();
  } catch { throw new Error('Private key must be encrypted RSA 4096+ PEM and its passphrase must match'); }
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

export async function publish(env = process.env, { resubmit = false } = {}) {
  const archive = path.join(root, 'dist/openai_ohos.har');
  const report = verifyReleaseHash(archive);
  validateRegistryMetadata(JSON5.parse(readArchiveFile(archive, 'package/oh-package.json5').toString('utf8')));
  if (report.version !== report.upstreamVersion) throw new Error('Release version is not aligned with the official SDK');
  // Recheck immediately before publication; the registry can change after planning/building.
  if (!resubmit && (await publishedVersions(report.package)).includes(report.version)) {
    console.log(`Skipped ${report.package}@${report.version}: this version is already published on OHPM.`);
    return report;
  }
  const pem = validateCredentials(env);
  const temporary = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'ohpm-publish-'));
  const privateKey = path.join(temporary, 'private.pem');
  const cryptoDirectory = path.join(temporary, 'crypto');
  let stage = 'encrypt-private-key-password';
  let ciphertext = '';
  try {
    fs.writeFileSync(privateKey, pem, { mode: 0o600 });
    fs.mkdirSync(cryptoDirectory, { mode: 0o700 });
    // Supply a temporary terminal to the official encryption command. Users only
    // configure the original private-key password, never a machine-bound ciphertext.
    ciphertext = run(env.PYTHON_BIN || 'python3', [path.join(root, 'scripts/encrypt-passphrase.py')], temporary, {
      stdio: 'pipe', encoding: 'utf8', timeout: 40000,
      input: JSON.stringify({ password: env.OHPM_KEY_PASSPHRASE,
        command: [ohpmBinary(), 'config', 'encrypt', '--crypto_path', cryptoDirectory] }),
    }).trim();
    if (!/^security:[^\s]+$/.test(ciphertext)) throw new Error('Invalid OHPM ciphertext');
    const fields = {
      publish_registry: 'https://ohpm.openharmony.cn/ohpm',
      publish_id: env.OHPM_PUBLISH_ID,
      key_path: privateKey.replace(/\\/g, '/'),
      crypto_path: cryptoDirectory.replace(/\\/g, '/'),
      key_passphrase: ciphertext,
      log_level: 'warn',
    };
    fs.writeFileSync(path.join(temporary, '.ohpmrc'), Object.entries(fields).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
    // No writes to the user's global .ohpmrc. Project config is scoped to this temporary cwd.
    stage = 'submit-to-ohpm';
    run(ohpmBinary(), ['publish', archive], temporary, { stdio: 'pipe', timeout: 300000 });
    console.log(`Submitted ${report.package}@${report.version} to OHPM. Repository review may still be pending.`);
    return report;
  } catch (error) {
    // Child output can include authentication material; never forward it to Actions logs.
    const diagnostic = publicationDiagnostic(error, [pem, env.OHPM_PUBLISH_ID, env.OHPM_KEY_PASSPHRASE, ciphertext]);
    throw new Error(`OHPM ${stage} failed (${error.status ?? error.code ?? 'configuration error'}). ${diagnostic}`);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--resubmit')) throw new Error('Usage: npm run publish:ohpm -- [--resubmit]');
  await publish(process.env, { resubmit: args.includes('--resubmit') });
}
