import fs from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';

export function extractArchive(file, cwd, strip = 0) {
  fs.mkdirSync(cwd, { recursive: true });
  tar.x({ file, cwd, strip, sync: true, strict: true, preservePaths: false });
}
export function listArchive(file) {
  const entries = [];
  tar.t({ file, sync: true, onReadEntry(entry) { entries.push(entry.path.replace(/\/$/, '')); } });
  return entries;
}
export function readArchiveFile(file, name) {
  const chunks = [];
  let found = false;
  tar.t({ file, sync: true, onReadEntry(entry) {
    if (entry.path === name && entry.type === 'File') {
      found = true;
      entry.on('data', chunk => chunks.push(chunk));
    }
  } });
  if (!found) throw new Error(`Archive member missing: ${name}`);
  return Buffer.concat(chunks);
}
