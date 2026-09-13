# 自动更新与发布：最小配置

在仓库 **Settings → Secrets and variables → Actions** 配置即可。

## 你需要填写的内容

### 3 个 Repository Secrets

| 名称 | 内容 |
| --- | --- |
| `OHPM_PUBLISH_ID` | OHPM 个人中心复制的发布码 |
| `OHPM_PRIVATE_KEY` | 带密码的 RSA 4096 位 PEM 私钥完整文本 |
| `OHPM_KEY_PASSPHRASE` | 该私钥的原始密码（不再要求手工生成 `security:` 密文） |

公钥仅登记到 **OHPM → 个人中心 → 认证管理**，不需要放 GitHub Secrets。

### 1 个 Repository Variable

| 名称 | 内容 |
| --- | --- |
| `HARMONY_CLT_URL` | 华为官方 Linux x64 Command Line Tools **26.0.0.821** ZIP 下载直链 |

官方下载页：https://developer.huawei.com/consumer/cn/download/command-line-tools-for-hmos 。该页面要求登录，因此下载直链需由账户持有人复制。必须是完整的 HarmonyOS Command Line Tools，内嵌 HMS SDK；不能用只有 OpenHarmony API 的 SDK 替代。若链接有有效期，过期后需更新。不要使用含账户令牌的私密链接作为公开 Variable；应获取可供 CI 无登录下载的官方分发直链。

**不再需要** self-hosted Runner、Environment、`OHPM_RELEASE_ENABLED`、`OHPM_CRYPTO_PATH` 或逐项配置工具路径。

## 工作流自动做什么

1. 每天北京时间 08:23（UTC 00:23）检查官方 npm `openai@latest`。
2. 相同版本已在 OHPM 发布，或有成功提交标签：跳过。
3. 使用 GitHub 托管 Ubuntu Runner，安装 Node 24、Java 21，下载并解压官方工具链，自动配置 SDK、ohpm、hvigor、es2abc。
4. 对齐官方版本，转换、测试、构建 HAR，再在独立工程验证。
5. 上传 HAR artifact，提交更新后的版本/锁文件/CHANGELOG。
6. 发布前再次查 OHPM，避免重复发布。
7. 使用临时 PTY 调用官方 `ohpm config encrypt`，自动将原始私钥密码变为本次使用的 `security:` 密文，生成临时加密组件；然后提交 OHPM 发布，成功后打标签。
8. 清理临时私钥、配置和加密组件。明文密码不放到命令参数或日志，私钥不提交 Git 或 artifact。

仓库默认分支须为 `ohos`（已配置）。GitHub 自动提供 `GITHUB_TOKEN`，无需另配 Token；分支规则需允许工作流推送。如果缺少配置，任务明确报错，不会跳过验证、绕过登录或假装发布成功。

OHPM `publish` 成功表示提交审核，不等于审核通过。若网络中断或审核被拒，先检查 OHPM 个人中心，不要盲目重复发布。

## 首次启用

1. 上传公钥到 OHPM。
2. 填写上面 3 个 Secrets 和下载链接。
3. 在 Actions → **Sync OpenAI and publish OHPM** → Run workflow，选择 `ohos`。
4. 检查任务结果与 OHPM 审核通知。之后无需手动更新 SDK。

生成公私钥无需由工作流每次执行：每次重新生成会导致 OHPM 中已登记的公钥失配。密钥丢失时生成新的一对，同时更新 OHPM 公钥与 GitHub Secrets。

## 本地维护（可选）

包使用者只需 `ohpm install openai_ohos`。维护者可在模块目录运行：

```sh
npm ci --ignore-scripts
npm run upgrade
```

本地转换/打包仍支持工具 PATH 或 `OHPM_BIN`、`ES2ABC_BIN`、`HVIGOR_BIN`；这些不是 GitHub 自动发布的用户配置。`npm run convert:js` 和 `npm test` 在 Windows、Linux、macOS 验证 JS；完整 HarmonyOS 构建需对应工具链。

`npm run publish:ohpm` 的自动密码输入使用 POSIX PTY，支持 Linux/macOS；Windows 本地发布可以直接运行官方 `ohpm publish` 交互输入密码。CI 固定使用 GitHub Ubuntu Runner，不受此限制。

版本严格对齐官方 SDK。升级失败会回滚锁文件、模块版本、CHANGELOG 和生成目录。只有当前版本首次发布或官方发布新版本时才提交；相同版本的适配层修改不能覆盖已发布包。

## 验证状态

- 原先三平台 JS 测试、HAR 构建和独立消费验证已通过。
- 新的无人值守密码加密已用一次性密码在真实 OHPM 上验证，不调用发布接口。
- GitHub 托管完整构建需提供官方工具链下载直链后验证；当前没有这个链接，不能声称已端到端发布成功。
