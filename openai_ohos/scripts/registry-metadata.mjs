// OHPM server validation is stricter than the CLI's prepublish schema:
// author.name alone is insufficient, even when package.homepage is populated.
export function validateRegistryMetadata(manifest) {
  if (manifest.repository !== undefined) {
    let validRepository = false;
    try {
      const url = new URL(manifest.repository);
      validRepository = typeof manifest.repository === 'string' &&
        ['https:', 'http:', 'ftp:', 'rtsp:', 'mms:'].includes(url.protocol) && !url.username && !url.password;
    } catch { /* invalid repository */ }
    if (!validRepository) throw new Error('OHPM repository must be a URL string, not an npm-style repository object');
  }
  const author = manifest.author;
  const name = typeof author === 'string' ? author.split(/[<(]/, 1)[0].trim() : author?.name?.trim();
  const email = typeof author === 'string' ? author.match(/<([^>]+)>/)?.[1] : author?.email;
  const url = typeof author === 'string' ? author.match(/\((https?:\/\/[^)]+)\)/)?.[1] : author?.url;
  let hasURL = false;
  try {
    const parsed = new URL(url);
    hasURL = ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch { /* no valid author homepage */ }
  const hasEmail = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || (!hasURL && !hasEmail)) {
    throw new Error('OHPM author must include a name and an author.url or author.email. Package homepage/repository do not satisfy this requirement.');
  }
}
