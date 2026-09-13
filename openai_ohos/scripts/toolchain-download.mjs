// Huawei serves developer archives from its DBank CDN as well as its web domains.
const domains = ['huawei.com', 'huaweicloud.com', 'dbankcdn.cn', 'dbankcdn.com'];

export function validateDownloadURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('HARMONY_CLT_URL must be a complete HTTPS download URL'); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      !domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    // Do not print the URL: its query can contain a signed download credential.
    throw new Error(`Unsupported toolchain download origin (${url.hostname || 'missing hostname'}). Expected HTTPS on Huawei or DBank CDN.`);
  }
  return url.href;
}

export async function downloadToolchainResponse(source, request = fetch) {
  let current = validateDownloadURL(source);
  const signal = AbortSignal.timeout(15 * 60 * 1000);
  for (let redirects = 0; redirects <= 5; redirects++) {
    // Validate each destination before following it, rather than checking only
    // after fetch has already followed an unknown redirect.
    const response = await request(current, { redirect: 'manual', signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Toolchain redirect is missing Location');
      current = validateDownloadURL(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Toolchain CDN returned HTTP ${response.status}. Check that the signed GET download link remains usable; no SDK was installed.`);
    }
    return response;
  }
  throw new Error('Too many toolchain download redirects');
}
