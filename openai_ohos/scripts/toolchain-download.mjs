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
  const maxRetries = 5;
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const signal = AbortSignal.timeout(15 * 60 * 1000);
      let target = current;
      let response = null;
      for (let redirects = 0; redirects <= 5; redirects++) {
        response = await request(target, { redirect: 'manual', signal, headers: defaultHeaders });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new Error('Toolchain redirect is missing Location');
          target = validateDownloadURL(new URL(location, target).href);
          continue;
        }
        break;
      }
      if (response && response.ok) {
        return response;
      }
      const status = response ? response.status : 'no-response';
      await response?.body?.cancel();
      if ([500, 502, 503, 504, 429, 408].includes(status) && attempt < maxRetries) {
        const delay = attempt * 8000;
        console.warn(`Toolchain CDN returned HTTP ${status}. Retrying attempt ${attempt + 1}/${maxRetries} in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`Toolchain CDN returned HTTP ${status}. Check that the signed GET download link remains usable; no SDK was installed.`);
    } catch (err) {
      if (attempt < maxRetries && !err.message.includes('Unsupported toolchain download origin') && !err.message.includes('HTTP 403') && !err.message.includes('HTTP 401') && !err.message.includes('HTTP 404')) {
        const delay = attempt * 8000;
        console.warn(`Toolchain download error: ${err.message}. Retrying attempt ${attempt + 1}/${maxRetries} in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}
