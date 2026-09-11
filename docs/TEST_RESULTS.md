# 初期移植测试记录（SDK 7.5.0）

日期：2026-09-11。官方 SDK：`openai@7.5.0`。设备：用户授权使用的已运行 Mate 80 Pro Max 模拟器，系统 `7.0.0.105(SP6DEVC00E999R4P11)`，`127.0.0.1:5555`。

## 最终结果

| 检查 | 结果 |
| --- | --- |
| 原包/转换包的 ESM、CommonJS 行为回归 | 28 / 28 通过 |
| fetch、URL 和 Web API 适配层回归 | 13 / 13 通过 |
| 本机 es2abc 解析 | 613 / 613 通过，含 SDK 608 个文件与平台 JS 5 个文件 |
| 清理缓存后的 entry HAP、openai_ohos HAR 构建 | 通过，无 ArkTS 警告 |
| 模拟器安装、启动、页面加载 | 通过 |
| 真实 DeepSeek 文本请求（非流式） | 通过，约 1.4 秒 |
| 真实 DeepSeek 文本请求（流式） | 通过，首字约 1.5 秒，总计约 1.6 秒 |
| 真实 DeepSeek 图片 + 文本请求（流式） | 通过，正确识别三个形状与颜色 |
| 停止生成 | 通过，页面回到可发送状态并显示“已停止” |
| 系统相册选择器打开与取消 | 通过 |
| 实际相册文件压缩、选择后上传 | 未实测：模拟器相册无可选照片 |

请求均使用 `https://api.deepseek.com` 与 `deepseek-flash`，无模型替换。更新后的有效测试密钥仅存于被忽略的本地配置；此记录不包含密钥。

## 真实模型证据

```text
22:40:44.874 Request complete: 回答完成 | 总计 1.4 秒
你好，我是由深度求索公司开发的AI助手DeepSeek，可以为你解答问题、处理信息并协助完成各类任务。

22:42:15.005 Request complete: 回答完成 | 首字 1.5 秒 · 总计 1.6 秒
我是一个乐于助人、可靠高效的 AI 助手，随时为你解答问题和提供帮助。

22:42:38.389 Request complete: 回答完成 | 首字 1.1 秒 · 总计 1.1 秒
从左到右依次是红色圆形、蓝色正方形和绿色三角形。
```

最终构建后的图片复测再次成功，界面显示首字 1.4 秒、总计 1.5 秒，见 [demo-result.png](demo-result.png)。输入是程序生成的 PNG 几何测试图；问题只要求描述图形和颜色，没有在问题中给出答案。

上述耗时为本次观测，不是性能保证。未把 Node.js 模拟传输测试当作鸿蒙设备测试，也未把测试图片当作相册上传测试。

## 已定位与修复的根因

1. `es2abc` 对对象 `async return()` 方法的解析问题：Babel 通用转换，SDK 源码不改。
2. 全局 `fetch` 缺失：独立 RCP 传输与 Web API 适配层。
3. `abort-controller` 浏览器入口只导出已有浏览器全局：构建明确选择其真正的 polyfill 入口，使用 neutral 打包目标。
4. 当前设备原生 URL 查询参数迭代器不能提供标准 `next()`：保留原生解析/编码，通过公开 `forEach` 生成标准 JS 迭代器，独立 URL 绑定测试覆盖查询与联动。
5. SDK 的 Responses 流辅助方法需要 `structuredClone`：独立标准库补齐，不改 SDK。
6. 最初用户提供的密钥返回 HTTP 401；更新有效密钥后完成真实请求。

## 回归命令

在 `openai_ohos`：

```sh
npm ci
npm run convert
npm test
npm run test:syntax
```

在工程根目录：

```sh
npx -y @deveco/deveco-cli build clean
npx -y @deveco/deveco-cli build --modules entry openai_ohos
npx -y @deveco/deveco-cli run --skip-build --module entry --device 127.0.0.1:5555
```

源码位置、实现边界和新环境密钥配置见 [README.md](../openai_ohos/README.md)。本次未宣称完整 WHATWG Fetch 一致性、所有 OpenAI SDK 功能或所有 HarmonyOS 版本均已验证。
