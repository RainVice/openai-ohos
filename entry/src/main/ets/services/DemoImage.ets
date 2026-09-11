import { photoAccessHelper } from '@kit.MediaLibraryKit';
import { fileIo } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { util } from '@kit.ArkTS';

export class DemoImage {
  uri: string = '';
  dataUrl: string = '';
  bytes: number = 0;
  label: string = '';
}

export async function pickDemoImage(): Promise<DemoImage | undefined> {
  let file: fileIo.File | undefined = undefined;
  let source: image.ImageSource | undefined = undefined;
  let pixelMap: image.PixelMap | undefined = undefined;
  let packer: image.ImagePacker | undefined = undefined;
  try {
    const selected = await new photoAccessHelper.PhotoViewPicker().select({
      MIMEType: photoAccessHelper.PhotoViewMIMETypes.IMAGE_TYPE, maxSelectNumber: 1
    });
    if (selected.photoUris.length === 0) return undefined;
    const uri = selected.photoUris[0];
    file = await fileIo.open(uri, fileIo.OpenMode.READ_ONLY);
    const stat = await fileIo.stat(file.fd);
    if (stat.size > 32 * 1024 * 1024) throw new Error('图片超过 32 MB，请选择较小的图片。');
    source = image.createImageSource(file.fd);
    const info = await source.getImageInfo();
    const scale = Math.min(1, 1600 / Math.max(info.size.width, info.size.height));
    pixelMap = await source.createPixelMap({ desiredSize: {
      width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale))
    } });
    packer = image.createImagePacker();
    const packed = await packer.packToData(pixelMap, { format: 'image/jpeg', quality: 85 });
    const result = new DemoImage();
    result.uri = uri;
    result.bytes = packed.byteLength;
    result.dataUrl = 'data:image/jpeg;base64,' + new util.Base64Helper().encodeToStringSync(new Uint8Array(packed));
    result.label = '已选择图片 · ' + Math.ceil(result.bytes / 1024).toString() + ' KB';
    return result;
  } catch (error) {
    throw new Error((error as Error).message);
  } finally {
    // A release failure must not prevent the remaining resources from being closed.
    try { if (packer) await packer.release(); } finally {
      try { if (pixelMap) await pixelMap.release(); } finally {
        try { if (source) await source.release(); } finally {
          if (file) {
            try { await fileIo.close(file); } catch (error) { throw new Error((error as Error).message); }
          }
        }
      }
    }
  }
}
