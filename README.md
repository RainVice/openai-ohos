# openai_ohos

适用于 HarmonyOS 的 OpenAI JavaScript SDK 适配库。提供原生 HTTP 传输、Web API 和 URL 适配，支持文本生成、图片理解、流式输出与请求取消。

保留官方 SDK 的 API 调用形式与类型声明，接口资源、重试和 SSE 解析由官方 SDK 实现。官方 SDK 源码不手工修改，发布时通过模块图打包与语法转换适配 HarmonyOS。

本库由社区维护，非 OpenAI 官方发布的 HarmonyOS SDK。包版本号与内置官方 SDK 版本一致，例如 `openai_ohos@7.15.0` 对应 `openai@7.15.0`。

## 下载安装

```sh
ohpm install openai_ohos
```

## 环境要求

- HarmonyOS API 23 及以上。
- 设备支持 Remote Communication Kit。
- 应用调用代码符合 ArkTS 语法规则。

在应用的 `module.json5` 中声明网络权限：

```json
{
  "module": {
    "requestPermissions": [
      { "name": "ohos.permission.INTERNET" }
    ]
  }
}
```

## 使用说明

### 创建客户端

```ts
import OpenAI from 'openai_ohos';

const client = new OpenAI({
  apiKey: YOUR_API_KEY,
  baseURL: 'https://api.deepseek.com',
  timeout: 120000,
  maxRetries: 1
});
```

`YOUR_API_KEY` 由应用提供，库中不包含密钥。`baseURL` 和模型由调用方指定；连接 OpenAI 官方服务时可以省略 `baseURL`。

### 文本生成

```ts
const response = await client.responses.create({
  model: 'deepseek-flash',
  input: '你好，请介绍一下你自己。'
});
console.info(response.output_text);
```

### 图片理解

```ts
const response = await client.responses.create({
  model: 'deepseek-flash',
  input: [{
    role: 'user',
    content: [
      { type: 'input_text', text: '请描述这张图片。' },
      { type: 'input_image', image_url: IMAGE_DATA_URL, detail: 'auto' }
    ]
  }]
});
console.info(response.output_text);
```

`IMAGE_DATA_URL` 可以是 `data:image/jpeg;base64,...`，也可以是所选服务允许访问的 HTTPS 图片地址。图片格式、大小及模型能力以服务提供方要求为准。

### 流式输出

```ts
const stream = client.responses.stream({
  model: 'deepseek-flash',
  input: '讲一个简短的故事。'
});
stream.on('response.output_text.delta', event => {
  console.info(event.delta);
});
const response = await stream.finalResponse();
```

用户停止生成或页面离开时，可以调用 `stream.abort()`。

### 取消普通请求

```ts
import { createHarmonyAbortController } from 'openai_ohos';

const controller = createHarmonyAbortController();
const request = client.responses.create(
  { model: 'deepseek-flash', input: '你好' },
  { signal: controller.signal }
);
// 用户取消时调用 controller.abort()。
const response = await request;
```

### 处理错误

```ts
import { APIError } from 'openai_ohos';

try {
  const response = await client.responses.create({
    model: 'deepseek-flash', input: '你好'
  });
  console.info(response.output_text);
} catch (caught) {
  const error = caught as Error;
  if (error instanceof APIError) {
    console.error('HTTP status: ' + error.status);
  }
  console.error(error.message);
}
```

HTTP 4xx/5xx、网络错误、超时及取消会交由官方 SDK 处理，应用应捕获并展示对应状态。

## 主要接口

| 导出 | 说明 |
| --- | --- |
| `OpenAI` 默认导出 / 命名导出 | 官方客户端及其 API |
| 官方 SDK 类型与错误类 | 通过模块根入口重新导出 |
| `harmonyFetch` | 使用 HarmonyOS 原生网络能力的 fetch 适配 |
| `installHarmonyRuntime()` | 初始化缺失的 Web API；导入模块时自动执行 |
| `createHarmonyAbortController()` | 创建可用于请求取消的控制器 |

如需显式指定网络实现：

```ts
import OpenAI, { harmonyFetch } from 'openai_ohos';
const client = new OpenAI({ apiKey: YOUR_API_KEY, fetch: harmonyFetch });
```

## 支持范围与约束

- 已验证文本、图片输入、SSE 流式输出、取消、重试和 HTTP 错误处理。
- 提供 SDK 使用的 fetch、Headers、Request、Response、Streams、Abort、编码、URL、Blob、File、FormData 和 structuredClone 能力；仅初始化缺失的全局对象。
- 这不是完整浏览器 WHATWG Fetch 实现：不提供浏览器 Cookie jar、CORS/opaque response、HTTP cache 或 `Response.formData()`。
- 上传请求体先缓冲到内存；未消费的响应队列超过约 16 MiB 时会报错并取消。原生连接超时 30 秒、传输上限 5 分钟，SDK 配置的更短超时仍生效。
- 自动重定向最多 20 次；跨源跳转移除 Authorization、Cookie 和 Proxy-Authorization；保留系统 TLS 校验。
- `structuredClone` 不支持 transfer 所有权转移。
- WebSocket Realtime、Node 文件流、AWS/Bedrock、Zod 等可选扩展未完成适配，不应视为全部 SDK 功能均可使用。
- 平台实现依赖 HarmonyOS RCP，不保证其他 OpenHarmony 发行版兼容。

## 示例与问题反馈

[图文示例应用](https://github.com/RainVice/openai-ohos/tree/ohos/entry) · [提交问题](https://github.com/RainVice/openai-ohos/issues) · [官方 OpenAI SDK](https://github.com/openai/openai-node)

## 开源协议

本项目使用 [Apache License 2.0](LICENSE)。包中包含官方 OpenAI SDK 许可证及运行时第三方依赖许可证；第三方归属信息位于 `src/main/resources/rawfile/NOTICE.txt` 和 `runtime-licenses.txt`。
