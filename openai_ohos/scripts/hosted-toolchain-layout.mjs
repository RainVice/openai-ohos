import fs from 'node:fs';
import path from 'node:path';

export function resolveHostedToolchain(tools) {
  // The Linux CLT ships ark/build/bin/es2abc, not ark/build-linux/bin/es2abc.
  // Resolve within the ETS compiler's own directory only. The JS/ace compiler
  // is a separate executable and must never be selected as a fallback.
  const ark = path.join(tools, 'sdk/default/openharmony/ets/build-tools/ets-loader/bin/ark');
  const compilers = [];
  if (fs.existsSync(ark)) {
    for (const relative of fs.readdirSync(ark, { recursive: true })) {
      const candidate = path.join(ark, relative);
      if (path.basename(relative) === 'es2abc' && fs.statSync(candidate).isFile()) compilers.push(candidate);
    }
  }
  if (compilers.length !== 1) {
    throw new Error(`Expected exactly one ETS es2abc in the verified archive; found ${compilers.length}. Check the CLT layout, not the JS/ace compiler.`);
  }
  const env = {
    OHPM_BIN: path.join(tools, 'ohpm/bin/ohpm'),
    HVIGOR_BIN: path.join(tools, 'hvigor/bin/hvigorw.js'),
    ES2ABC_BIN: compilers[0],
    DEVECO_SDK_HOME: path.join(tools, 'sdk'),
    TARGET_SDK_VERSION: '26.0.0',
  };
  for (const name of ['OHPM_BIN', 'HVIGOR_BIN', 'ES2ABC_BIN']) {
    if (!fs.existsSync(env[name]) || !fs.statSync(env[name]).isFile()) throw new Error(`Official archive is missing ${name}`);
  }
  const rcp = path.join(tools, 'sdk/default/hms/ets/api/@hms.collaboration.rcp.d.ts');
  if (!fs.existsSync(rcp)) throw new Error('The archive is missing the HarmonyOS RCP API required by this library');
  return env;
}
