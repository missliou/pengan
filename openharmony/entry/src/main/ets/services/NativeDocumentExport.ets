import picker from '@ohos.file.picker';
import fileIo from '@ohos.file.fs';
import util from '@ohos.util';

export class NativeDocumentExport {
  static async saveJson(content: string, prefix: string = '棚安-台账', isCurrent: () => boolean = () => true): Promise<boolean> {
    try {
      // API11 uses the zero-argument constructor.
      const view = new picker.DocumentViewPicker();
      if (!/^[\u4e00-\u9fffA-Za-z0-9-]{1,40}$/.test(prefix)) throw new Error('导出名称无效');
      const options: picker.DocumentSaveOptions = { newFileNames: [prefix + '-' + Date.now().toString() + '.json'], fileSuffixChoices: ['.json'] };
      const uris = await view.save(options);
      if (uris.length === 0) return false;
      if (!isCurrent()) throw new Error('导出上下文已变化，未写入报告');
      const file = fileIo.openSync(uris[0], fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
      try {
        const data = new util.TextEncoder().encodeInto(content).slice().buffer;
        let offset = 0;
        while (offset < data.byteLength) {
          const written = fileIo.writeSync(file.fd, data.slice(offset));
          if (written <= 0 || written > data.byteLength - offset) throw new Error('台账文件未完整写入');
          offset += written;
        }
        return true;
      } finally {
        fileIo.closeSync(file);
      }
    } catch (error) {
      throw new Error('台账导出失败，文件可能未完整保存：' + (error as Error).message);
    }
  }
}
