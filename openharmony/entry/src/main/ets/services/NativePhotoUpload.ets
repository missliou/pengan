import fileIo from '@ohos.file.fs';
import util from '@ohos.util';

export class NativePhotoUpload {
  static readCapturedJpeg(path: string, filesDir: string): string {
    const prefix = filesDir + '/';
    if (!path.startsWith(prefix) || !/^crop-[0-9]+\.jpg$/.test(path.slice(prefix.length))) throw new Error('只能发送本应用刚拍摄的照片');
    const file = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
    try {
      const size = fileIo.statSync(file.fd).size;
      if (!Number.isSafeInteger(size) || size < 32 || size > 2097152) throw new Error('照片为空、格式不完整或超过2MiB，请重新拍摄较小图片');
      const data = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        const chunk = new ArrayBuffer(Math.min(65536, size - offset));
        const read = fileIo.readSync(file.fd, chunk, { offset: offset, length: chunk.byteLength });
        if (read <= 0 || read > chunk.byteLength) throw new Error('照片读取不完整');
        data.set(new Uint8Array(chunk, 0, read), offset); offset += read;
      }
      if (data[0] !== 255 || data[1] !== 216 || data[2] !== 255 || data[size - 2] !== 255 || data[size - 1] !== 217) throw new Error('照片不是完整JPEG');
      return new util.Base64Helper().encodeToStringSync(data);
    } finally { fileIo.closeSync(file); }
  }
}
