# 构建与发布维护指南

包使用者请阅读 [README](../openai_ohos/README.md)。本文件只面向维护者，不进入发布 HAR。

## 跨平台工具链

脚本不包含个人目录或默认安装路径。Node.js 脚本使用 `cross-spawn` 调用程序，支持 Windows `.cmd` 启动器；压缩包处理使用 Node `tar` 库，不依赖系统 tar。测试文件由 Node 枚举，不依赖 Shell 的通配符展开。

- Node.js：`^22.18.0 || >=24.11.0`，CI 使用 Node 24。
- npm：安装依赖使用 `npm ci --ignore-scripts`。
- `ohpm`：加入 PATH，或通过 `OHPM_BIN` 指向可执行文件/启动脚本。
- `es2abc`：加入 PATH，或通过 `ES2ABC_BIN` 指向对应系统的二进制文件。
- Windows/macOS：可使用官方 DevEco CLI 调用已安装的桌面工具链。
- Windows/macOS/Linux CI：可设置 `HVIGOR_BIN` 指向官方 Command Line Tools 的 `hvigorw.js` 或启动器。脚本会使用 ohpm 安装依赖，再运行 hvigor sync 和 build。需按华为官方说明配置 SDK、JDK（JAVA_HOME）、Hvigor 和依赖源。
- `TARGET_SDK_VERSION` 默认 `26.0.0`；`HARMONYOS_SDK_HOME` 等 SDK 环境配置由官方构建工具读取。

环境变量必须填写 **Runner 自己的实际安装路径**，不能复制另一台电脑的路径。Linux 构建需要包含 HarmonyOS RCP API 的完整 SDK；只有 OpenHarmony SDK 不足以构建本库。项目不下载或自动接受 SDK 许可证。

例（PowerShell，路径由你替换）：

```powershell
$env:OHPM_BIN = 'D:\HarmonyTools\ohpm\bin\ohpm.bat'
$env:ES2ABC_BIN = 'D:\HarmonySDK\ets\build-tools\ets-loader\bin\ark\build-win\bin\es2abc.exe'
$env:HVIGOR_BIN = 'D:\HarmonyTools\hvigor\bin\hvigorw.js'
```

例（POSIX shell，路径由你替换）：

```sh
export OHPM_BIN="$HARMONY_TOOLS/ohpm/bin/ohpm"
export ES2ABC_BIN="$HARMONY_SDK_ES2ABC"
export HVIGOR_BIN="$HARMONY_TOOLS/hvigor/bin/hvigorw.js"
```

GitHub `ci.yml` 在 Ubuntu、Windows、macOS 三种托管 Runner 上进行 JS 转换与行为测试。该矩阵不含华为 SDK，不能替代各平台的完整 HAR 构建验证。

## 命令

在 `openai_ohos` 目录：

```sh
npm ci --ignore-scripts
npm run upgrade
```

`upgrade` 查询 npm 官方 latest，锁定版本，校验下载包完整性，转换模块图和语法，生成运行时，测试并构建 release HAR，然后通过 OHPM 预检查与独立消费工程编译。失败恢复旧锁文件和生成目录；机器断电或强杀进程不在回滚保证内。

| 命令 | 用途 |
| --- | --- |
| `npm run upgrade` | 获取当前官方 latest 并生成验证过的 release 包 |
| `npm run upgrade -- --version 7.15.0` | 使用明确版本，供 CI 固定计划中的版本 |
| `npm run convert` | 按锁文件生成 HAR 与运行时 |
| `npm run convert:js` | 无 SDK 的跨平台 JS 检查；会重建 generated，之后发布前必须执行完整 convert |
| `npm test` | 原包、转换包、最终模块图、平台适配与脚本测试 |
| `npm run test:syntax` | 使用本机 es2abc 解析全部 JS |
| `npm run package` | 构建、检查和验证 release HAR，输出至 dist |
| `npm run verify:package -- package.har` | 验证指定 HAR |
| `npm run publish:ohpm` | 使用环境 Secrets 提交已验证 HAR 到 OHPM |

SDK 源码不手工修改；ESM/CommonJS 混合依赖图先经 esbuild 统一为共享分块 ESM，再由 Babel 转换语法。发布包内包含独立 fetch/Web API 适配和嵌套官方 SDK HAR。

`dist/openai_ohos.har.verification.json` 记录哈希和验证结果。发布脚本校验哈希与 release 状态，避免发布验证后被替换的包。仅有匹配的记录不等于完整安全审计。

## GitHub Actions 配置

工作流 `.github/workflows/sync-openai.yml` 每天 UTC 00:23（北京时间 08:23）检查。GitHub schedule 只在默认分支运行，仓库默认分支须为 `ohos`；手动触发也应选择 `ohos`。

1. 注册一个受信任的 self-hosted Runner，添加标签 `ohos`。
2. 在 Runner 服务环境配置上面的工具链变量并安装 SDK、JDK 和所需构建依赖。支持 Windows/macOS；Linux 使用 `HVIGOR_BIN` Command Line Tools 后端。配置 SDK 后先手动运行完整 package 验证。
3. 创建 GitHub Environment `ohpm`，添加下一节的三个 Secrets。
4. 仓库 Actions 必须允许 `contents: write`；`ohos` 分支保护需允许该工作流的机器人提交。若禁止直接推送，需改为 PR 审核流程后再启用自动发布。
5. 创建 Repository Variable `OHPM_RELEASE_ENABLED`，确认配置完成后设为 `true`。默认未设置时只检查版本，不占用自托管 Runner、不发布。
6. 首次手动触发工作流，检查 artifact、提交和 OHPM 审核状态。

只在可信 `ohos` 分支的 schedule/manual 事件运行发布，不在 fork PR 上使用自托管 Runner 或 Secrets。普通 PR 的 JS 测试使用 GitHub 托管 Runner。发布密钥仅在发布步骤注入。

## OHPM 发布码与公私钥

根据官方 [必要文件](https://ohpm.openharmony.cn/#/cn/help/publishrequirefile)、[创建及发布](https://ohpm.openharmony.cn/#/cn/help/createandpublish)、[认证管理](https://ohpm.openharmony.cn/#/cn/help/certifymanage)：

- 发布包根目录必须包含非空 `oh-package.json5`、`README.md`、`CHANGELOG.md`、`LICENSE`。脚本逐一校验并打包。
- 注册/登录 OHPM，在个人中心复制发布码，对应 `publish_id`。
- 使用 `ssh-keygen` 生成 RSA 4096 位 PEM 密钥，**必须输入私钥密码**，不能使用无密码私钥。先创建保存目录，再执行：

```sh
ssh-keygen -m PEM -t RSA -b 4096 -f <你选择的目录>/ohpm-release
```

- 将 `ohpm-release.pub` 内容上传到 OHPM【个人中心 → 认证管理 → 新增】。
- 私钥 `ohpm-release` 不上传到 OHPM 公钥输入框，不提交到 Git，也不要作为 Actions artifact。

在 GitHub Environment `ohpm` 添加：

| Secret | 内容 |
| --- | --- |
| `OHPM_PUBLISH_ID` | OHPM 个人中心复制的发布码 |
| `OHPM_PRIVATE_KEY` | 加密 PEM 私钥完整文本，含 BEGIN/END 行与换行 |
| `OHPM_KEY_PASSPHRASE` | `ohpm config encrypt` 输出的 `security:` 密文（不是明文密码） |

公钥保存在 OHPM，不需要 GitHub Secret。GitHub Token、OpenAI/DeepSeek API Key 均不能代替 OHPM 发布凭据。

发布 Runner 要求 OHPM >= 5.2。`key_passphrase` 必须为 `ohpm config encrypt` 生成的 `security:` 密文。当前 OHPM 的加密命令要求交互 TTY，不支持直接通过 CI pipe 自动输入。

在 **Runner 本机的交互终端** 执行（密码输入生成 RSA 私钥时的密码）：

```sh
ohpm config encrypt --crypto_path <Runner上的受保护加密组件目录>
```

1. 把输出的 `security:...` 完整值保存到 `OHPM_KEY_PASSPHRASE` Secret。
2. 在 Runner 服务环境设置 `OHPM_CRYPTO_PATH`，指向上面的加密组件目录。
3. 密文和组件必须成对保留；更换 Runner、加密组件或私钥密码后，重新生成并更新 Secret。组件目录需仅让 Runner 服务账户访问，不放入仓库或 artifact。

脚本会在临时目录写入加密私钥和项目 `.ohpmrc`：

```ini
publish_registry=https://ohpm.openharmony.cn/ohpm
publish_id=<发布码>
key_path=<临时加密私钥路径>
crypto_path=<OHPM_CRYPTO_PATH 指定的目录>
key_passphrase=security:<GitHub Secret 中的密文>
```

CI 不接收明文密码，不修改 Runner 全局 `.ohpmrc`，结束时清除临时私钥和配置；Runner 上的配套加密组件保留供下次发布使用。不要开启 ohpm debug 或 Shell 命令回显。

## 版本、重试与审核

- 当前首版 `1.0.0`；SDK 精确版本写入 npm 锁文件。
- 首次无 `ohpm-v1.0.0` 标签时提交当前锁定 SDK 的首版；之后检测到官方 SDK 更新时，自动增加鸿蒙包 patch 版本并添加 CHANGELOG。
- 若某次提交/发布中断，下一次先完成未打标签的当前包版本，不跨过它升级到更高版本。
- 构建通过后先提交锁文件与 CHANGELOG 到 `ohos`，推送成功才调用 OHPM 发布；发布命令成功后再推送 `ohpm-v版本` 标签。
- 若 OHPM 已接受但网络中断、tag push 失败或审核被拒，不能盲目认为失败。检查个人中心审核单与实际包版本，再补标签或增加版本重发，避免重复提交。不会自动忽略发布失败。
- `prepublish` 仅检查包内容，不验证账户、包名占用、发布权限。`publish` 成功表示提交上架审核，不代表已审核通过。

## 本地签名配置

仓库的 demo 构建配置不包含任何个人签名材料。请在 DevEco Studio 中自行配置签名；不要提交签名文件、密码和密钥。发布 HAR 的独立构建不依赖 demo 签名。
