# 发布流程验证（2026-09-11）

模块版本 `openai_ohos@1.0.0`，上游版本 `openai@7.15.0`（本次查询的 npm 官方 latest）。未发布到 OHPM 仓库。

## 验证结果

- 官方包 SHA-512 与 npm 锁文件一致。
- 49 项行为测试通过：官方原包、Babel 对照包、最终 ESM 产物及平台适配。
- 1464 / 1464 个 JS 文件通过 es2abc 解析，包括 778 个双格式对照文件、681 个最终 ESM 入口/共享块及 5 个平台 JS 文件。
- 独立临时工程 release HAR 构建通过。
- `ohpm prepublish` 包内容检查通过。
- 第二个独立临时工程只安装最终 HAR，默认导出、命名导出、fetch、取消信号和 Responses 调用编译通过。没有连接本地源码模块。
- demo 临时切换为发布 HAR 依赖后，在已授权的模拟器完成真实文本和图片请求；测试结束后已恢复 demo 的源码模块依赖并重新构建。
- 升级流程在故障排查期间失败时，精确恢复旧 npm 锁文件和生成产物；修正后成功更新到 7.15.0。

## 发布 HAR 的设备证据

```text
23:13:17.370 Request start: image=false stream=true
23:13:18.992 回答完成 | 首字 1.6 秒 · 总计 1.6 秒
你好，我是由深度求索公司开发的 AI 助手 DeepSeek，很高兴为你提供帮助。

23:13:22.276 Request start: image=true stream=true
23:13:23.518 回答完成 | 首字 1.2 秒 · 总计 1.2 秒
图片中从左到右依次是红色圆形、蓝色正方形和绿色三角形。
```

接口为 `https://api.deepseek.com`，模型为 `deepseek-flash`。本记录无密钥。

## 新版模块图问题的根因

7.15.0 的 ESM 入口图包含同名 `.mjs` / `.js` 的跨格式导入。hvigor 将 `.mjs` 归一化为 `.js`，原路径发生冲突。发布流程改为 esbuild 构建共享分块 ESM 图，再进行 Babel 语法转换；官方源码不修改，不对特定文件应用字符串补丁。

## 范围

此验证不是完整 WHATWG Fetch 一致性验证。未包含 Node 专用功能、WebSocket Realtime、所有 SDK 子路径和所有 HarmonyOS 版本测试。`prepublish` 不验证仓库账户、包名占用和发布权限。

最终发布包与校验结果在 `openai_ohos/dist/`；用法和发布命令见 [模块 README](../openai_ohos/README.md)。
