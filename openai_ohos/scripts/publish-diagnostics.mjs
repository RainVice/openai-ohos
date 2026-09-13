export function publicationDiagnostic(error, secrets = []) {
  let text = [error.stdout, error.stderr].filter(Boolean).map(value => String(value)).join('\n');
  text = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  // Expose only documented error-message lines, never full terminal transcripts.
  text = text.split(/\r?\n/).filter(line => /^(?:\s*ohpm ERROR:|\s*Error(?: Message)?:|\s*Original Error:)/.test(line)).join(' ');
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join('[redacted]');
  text = text.replace(/security:[^\s]+/g, '[redacted ciphertext]')
    .replace(/https?:\/\/[^\s]+/g, '[URL omitted]')
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, '[redacted token]');
  return text.trim().slice(0, 1200) || 'No safe error details returned by the command';
}
