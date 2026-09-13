// GitHub-hosted Linux runner setup. No self-hosted runner or per-tool user paths.
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { run } from './toolchain.mjs';
import { validateDownloadURL, downloadToolchainResponse } from './toolchain-download.mjs';
import { resolveHostedToolchain } from './hosted-toolchain-layout.mjs';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Hosted release setup requires Linux x64');
const source = process.env.HARMONY_CLT_URL;
if (!source) throw new Error('Set repository Variable HARMONY_CLT_URL to the official Linux x64 Command Line Tools 26.0.0.821 ZIP download URL.');
validateDownloadURL(source);
const destination = path.join(process.env.RUNNER_TEMP, 'harmony-clt');
fs.mkdirSync(destination, { recursive: true });
const archive = path.join(destination, 'tools.zip');
console.log('Downloading official HarmonyOS Command Line Tools on the hosted runner...');
try {
  const response = await downloadToolchainResponse(source);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  // Linux x64 26.0.0.821 distribution baseline. A different release must be
  // reviewed and its digest updated in code, rather than accepting any ZIP.
  if (hash.digest('hex') !== '58da7359019e9360a8bb82da0cd1d3b3b26fedc338379f257849f2162e3ac1fc') {
    throw new Error('Command Line Tools archive does not match the pinned 26.0.0.821 SHA-256');
  }
  run('python3', ['-c', `
import os, pathlib, stat, sys, zipfile
archive, destination = sys.argv[1:]
base = pathlib.Path(destination).resolve()
links = []
with zipfile.ZipFile(archive) as z:
    for item in z.infolist():
        name = pathlib.PurePosixPath(item.filename)
        if name.is_absolute() or '..' in name.parts:
            raise RuntimeError('Unsafe toolchain archive path')
        mode = item.external_attr >> 16
        if stat.S_ISLNK(mode):
            target = base.joinpath(*name.parts)
            link = z.read(item).decode('utf-8')
            if pathlib.Path(link).is_absolute() or not (target.parent / link).resolve().is_relative_to(base):
                raise RuntimeError('Unsafe toolchain symlink')
            links.append((target, link))
            continue
        target = z.extract(item, destination)
        if mode & 0o111 and not item.is_dir():
            os.chmod(target, 0o755)
for target, link in links:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.symlink_to(link)
for target, link in links:
    if not target.resolve().is_relative_to(base):
        raise RuntimeError('Unsafe toolchain symlink chain')
`, archive, destination]);
} finally { fs.rmSync(archive, { force: true }); }

const matches = [];
function find(directory, depth = 0) {
  if (fs.existsSync(path.join(directory, 'sdk/default/hms')) && fs.existsSync(path.join(directory, 'hvigor/bin/hvigorw.js'))) matches.push(directory);
  if (depth < 3) for (const child of fs.readdirSync(directory, { withFileTypes: true })) if (child.isDirectory()) find(path.join(directory, child.name), depth + 1);
}
find(destination);
if (matches.length !== 1) throw new Error('Expected one complete HarmonyOS Command Line Tools installation (including HMS SDK)');
const tools = matches[0];
const env = resolveHostedToolchain(tools);
for (const key of ['OHPM_BIN', 'HVIGOR_BIN', 'ES2ABC_BIN']) {
  fs.chmodSync(env[key], 0o755);
}
console.log(`ETS compiler: ${path.relative(tools, env.ES2ABC_BIN)}`);
// Detect architecture/shared-library problems during setup, before the large SDK build.
run(env.ES2ABC_BIN, ['--bc-version']);
if (!process.env.GITHUB_ENV) throw new Error('GITHUB_ENV is required');
for (const [name, value] of Object.entries(env)) fs.appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
console.log('Configured OHPM, Hvigor and the full HarmonyOS SDK. No user tool paths required.');
