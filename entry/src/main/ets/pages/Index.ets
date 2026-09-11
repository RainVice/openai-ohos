import OpenAI, { APIError, createHarmonyAbortController } from 'openai_ohos';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { util } from '@kit.ArkTS';
import { DEEPSEEK_API_KEY } from '../config/DemoSecrets';
import { pickDemoImage } from '../services/DemoImage';

@Entry
@Component
struct Index {
  @State private prompt: string = '你好，请用一句话介绍你自己。';
  @State private imageUrl: string = '';
  @State private imageUri: string = '';
  @State private imageLabel: string = '';
  @State private sampleImage: boolean = false;
  @State private busy: boolean = false;
  @State private picking: boolean = false;
  @State private streaming: boolean = true;
  @State private result: string = '';
  @State private errorText: string = '';
  @State private statusText: string = '准备就绪';
  @State private detailText: string = '';
  private stopped: boolean = false;
  private cancelRequest: (() => void) | undefined = undefined;
  private readonly scroller: Scroller = new Scroller();
  private readonly client: OpenAI = new OpenAI({
    baseURL: 'https://api.deepseek.com', apiKey: DEEPSEEK_API_KEY, timeout: 120000, maxRetries: 1
  });

  aboutToDisappear(): void { this.stop(); }

  private removeImage(): void {
    this.imageUrl = ''; this.imageUri = ''; this.imageLabel = ''; this.sampleImage = false;
  }

  private async useSample(): Promise<void> {
    if (this.busy || this.picking) return;
    try {
      const content = await this.getUIContext().getHostContext()!.resourceManager.getRawFileContent('vision_sample.png');
      this.imageUrl = 'data:image/png;base64,' + new util.Base64Helper().encodeToStringSync(content);
      this.imageUri = ''; this.sampleImage = true; this.imageLabel = '测试图片 · 三个几何图形';
      this.prompt = '请从左到右描述图片中的图形和颜色，用一句中文回答。';
      this.errorText = '';
    } catch (error) { this.errorText = '无法加载测试图片：' + (error as Error).message; }
  }

  private async chooseImage(): Promise<void> {
    if (this.busy || this.picking) return;
    this.picking = true; this.errorText = '';
    try {
      const selected = await pickDemoImage();
      if (selected) {
        this.imageUrl = selected.dataUrl; this.imageUri = selected.uri;
        this.imageLabel = selected.label; this.sampleImage = false;
        this.prompt = '请描述这张图片中的主要内容。';
      }
    } catch (error) { this.errorText = '无法读取图片：' + (error as Error).message; }
    finally { this.picking = false; }
  }

  private stop(): void {
    if (!this.busy) return;
    this.stopped = true;
    if (this.cancelRequest) this.cancelRequest();
  }

  private async send(): Promise<void> {
    if (this.busy || this.picking || this.prompt.trim().length === 0) return;
    this.busy = true; this.stopped = false; this.errorText = ''; this.result = ''; this.detailText = '';
    this.statusText = '正在连接…';
    const started = Date.now();
    let firstDelta = 0;
    const parts: OpenAI.Responses.ResponseInputContent[] = [{ type: 'input_text', text: this.prompt.trim() }];
    if (this.imageUrl.length > 0) parts.push({ type: 'input_image', image_url: this.imageUrl, detail: 'auto' });
    const input: OpenAI.Responses.ResponseInput = [{ role: 'user', content: parts }];
    hilog.info(0x0000, 'OpenAIDemo', 'Request start: image=%{public}s stream=%{public}s',
      (this.imageUrl.length > 0).toString(), this.streaming.toString());
    try {
      if (this.streaming) {
        const stream = this.client.responses.stream({ model: 'deepseek-flash', input, max_output_tokens: 1024 });
        this.cancelRequest = () => { stream.abort(); };
        stream.on('response.output_text.delta', event => {
          if (this.stopped) return;
          if (firstDelta === 0) firstDelta = Date.now() - started;
          this.statusText = '正在回答…'; this.result += event.delta;
        });
        const response = await stream.finalResponse();
        this.result = response.output_text || this.result;
        this.detailText = '首字 ' + (firstDelta / 1000).toFixed(1) + ' 秒 · 总计 ' + ((Date.now() - started) / 1000).toFixed(1) + ' 秒';
        if (response.status === 'incomplete') this.statusText = '已达到输出长度限制';
        else if (response.status === 'failed') throw new Error(response.error?.message || '模型生成失败');
        else this.statusText = '回答完成';
      } else {
        const controller = createHarmonyAbortController();
        this.cancelRequest = () => { controller.abort(); };
        const response = await this.client.responses.create({ model: 'deepseek-flash', input, max_output_tokens: 1024, stream: false }, { signal: controller.signal });
        this.result = response.output_text;
        this.detailText = '总计 ' + ((Date.now() - started) / 1000).toFixed(1) + ' 秒';
        if (response.status === 'failed') throw new Error(response.error?.message || '模型生成失败');
        this.statusText = response.status === 'incomplete' ? '已达到输出长度限制' : '回答完成';
      }
      if (this.stopped) this.statusText = '已停止';
      hilog.info(0x0000, 'OpenAIDemo', 'Request complete: %{public}s | %{public}s | %{public}s', this.statusText, this.detailText, this.result);
    } catch (caught) {
      const error = caught as Error;
      if (this.stopped) this.statusText = '已停止';
      else {
        this.statusText = '请求失败';
        this.errorText = error instanceof APIError ? 'HTTP ' + (error.status || 0).toString() + ' · ' + error.message : error.message;
        hilog.error(0x0000, 'OpenAIDemo', 'Request failed: %{public}s', this.errorText);
        hilog.error(0x0000, 'OpenAIDemo', 'Stack: %{public}s', error.stack || 'unavailable');
      }
    } finally {
      this.busy = false; this.cancelRequest = undefined;
      setTimeout(() => { this.scroller.scrollEdge(Edge.Bottom); }, 50);
    }
  }

  build() {
    Column() {
      Scroll(this.scroller) {
        Column({ space: 24 }) {
          Column({ space: 6 }) {
            Text('DeepSeek').fontSize(30).fontWeight(FontWeight.Bold).fontColor($r('app.color.demo_text'))
            Text('文本与图片理解').fontSize(16).fontColor($r('app.color.demo_secondary'))
            Text('deepseek-flash').fontSize(12).fontColor($r('app.color.demo_accent')).margin({ top: 8 })
          }.alignItems(HorizontalAlign.Start).width('100%')
          Column({ space: 16 }) {
            Text('想问些什么？').fontSize(20).fontWeight(FontWeight.Bold).fontColor($r('app.color.demo_text')).width('100%')
            TextArea({ text: this.prompt, placeholder: '输入问题，也可以添加一张图片' })
              .id('promptInput').height(136).fontSize(16).fontColor($r('app.color.demo_text'))
              .placeholderColor($r('app.color.demo_secondary')).backgroundColor($r('app.color.demo_input'))
              .borderRadius(12).maxLength(4000).enabled(!this.busy && !this.picking).onChange(value => { this.prompt = value; })
            Row({ space: 8 }) {
              Button('文本示例', { type: ButtonType.Normal }).id('textExample').layoutWeight(1)
                .fontSize(14).height(44).borderRadius(12).backgroundColor($r('app.color.demo_input')).fontColor($r('app.color.demo_accent'))
                .enabled(!this.busy && !this.picking).onClick(() => { this.removeImage(); this.prompt = '你好，请用一句话介绍你自己。'; })
              Button('测试图片', { type: ButtonType.Normal }).id('sampleImage').layoutWeight(1)
                .fontSize(14).height(44).borderRadius(12).backgroundColor($r('app.color.demo_input')).fontColor($r('app.color.demo_accent'))
                .enabled(!this.busy && !this.picking).onClick(() => { this.useSample(); })
            }.width('100%')
            Button(this.picking ? '正在读取图片…' : '从相册选择', { type: ButtonType.Normal })
              .id('pickImage').width('100%').height(44).borderRadius(12)
              .backgroundColor($r('app.color.demo_input')).fontColor($r('app.color.demo_accent'))
              .enabled(!this.busy && !this.picking).onClick(() => { this.chooseImage(); })
            if (this.imageUrl.length > 0) {
              Column({ space: 8 }) {
                if (this.sampleImage) {
                  Image($r('app.media.vision_sample')).width('100%').height(150).objectFit(ImageFit.Contain).borderRadius(8).accessibilityText('用于测试的红色圆形、蓝色方形和绿色三角形')
                } else {
                  Image(this.imageUri).width('100%').height(150).objectFit(ImageFit.Contain).borderRadius(8).accessibilityText('待发送的图片')
                }
                Row() {
                  Text(this.imageLabel).fontSize(12).fontColor($r('app.color.demo_secondary')).layoutWeight(1)
                  Button('移除').id('removeImage').fontSize(14).height(44).backgroundColor(Color.Transparent)
                    .fontColor($r('app.color.demo_accent')).enabled(!this.busy).onClick(() => { this.removeImage(); })
                }.width('100%')
              }.width('100%')
            }
            Row() {
              Text('流式输出').fontSize(14).fontColor($r('app.color.demo_secondary')).layoutWeight(1)
              Toggle({ type: ToggleType.Switch, isOn: this.streaming }).id('streamingToggle')
                .selectedColor($r('app.color.demo_accent')).enabled(!this.busy).onChange(value => { this.streaming = value; })
            }.width('100%')
          }.padding(16).backgroundColor($r('app.color.demo_surface')).borderRadius(16).width('100%')
          Column({ space: 12 }) {
            Row({ space: 8 }) {
              Text('回答').fontSize(20).fontWeight(FontWeight.Bold).fontColor($r('app.color.demo_text')).layoutWeight(1)
              if (this.busy) { LoadingProgress().width(20).height(20).color($r('app.color.demo_accent')) }
              Text(this.statusText).id('requestStatus').fontSize(12).fontColor($r('app.color.demo_secondary'))
            }.width('100%')
            if (this.errorText.length > 0) {
              Text(this.errorText).id('requestError').fontSize(14).fontColor($r('app.color.demo_error')).width('100%')
              Text('检查网络或请求内容后，点击发送重试。').fontSize(12).fontColor($r('app.color.demo_secondary')).width('100%')
            }
            Text(this.result || (this.busy ? '模型正在思考，请稍候。' : '发送一段文字，或添加图片开始提问。'))
              .id('responseText').fontSize(16).lineHeight(26).fontColor(this.result ? $r('app.color.demo_text') : $r('app.color.demo_secondary'))
              .copyOption(CopyOptions.LocalDevice).width('100%').constraintSize({ minHeight: 100 })
            if (this.detailText.length > 0) { Text(this.detailText).fontSize(12).fontColor($r('app.color.demo_secondary')).width('100%') }
          }.alignItems(HorizontalAlign.Start).width('100%').padding({ left: 4, right: 4, bottom: 16 })
        }.padding({ left: 16, right: 16, top: 24, bottom: 16 }).width('100%').constraintSize({ maxWidth: 680 })
      }.layoutWeight(1).width('100%').scrollBar(BarState.Off)
      Row() {
        Button(this.busy ? '停止生成' : '发送', { type: ButtonType.Normal })
          .id('sendButton').width('100%').height(48).borderRadius(16).fontSize(16).fontWeight(FontWeight.Medium)
          .backgroundColor($r('app.color.demo_accent')).fontColor($r('app.color.demo_on_accent'))
          .enabled(!this.picking && (this.busy || this.prompt.trim().length > 0))
          .onClick(() => { if (this.busy) this.stop(); else this.send(); })
      }.padding({ left: 16, right: 16, top: 8, bottom: 12 }).width('100%').constraintSize({ maxWidth: 680 })
    }.width('100%').height('100%').backgroundColor($r('app.color.demo_background'))
  }
}
