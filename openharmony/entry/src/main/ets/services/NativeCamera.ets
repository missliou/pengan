import camera from '@ohos.multimedia.camera';
import image from '@ohos.multimedia.image';
import fileIo from '@ohos.file.fs';
import abilityAccessCtrl from '@ohos.abilityAccessCtrl';
import common from '@ohos.app.ability.common';
import { BusinessError } from '@ohos.base';

class PendingPhoto {
  resolve: (path: string) => void = () => {};
  reject: (error: Error) => void = () => {};
  timer: number = -1;
  processing: boolean = false;
}

export class NativeCamera {
  private input: camera.CameraInput | undefined = undefined;
  private preview: camera.PreviewOutput | undefined = undefined;
  private photo: camera.PhotoOutput | undefined = undefined;
  private session: camera.PhotoSession | undefined = undefined;
  private pending: PendingPhoto | undefined = undefined;
  private generation: number = 0;
  private starting: boolean = false;
  private startFinished: Promise<void> = Promise.resolve();
  private finishStart: () => void = () => {};
  private ready: boolean = false;
  private capturing: boolean = false;
  private filesDir: string = '';

  async start(context: common.UIAbilityContext, surfaceId: string): Promise<void> {
    if (this.starting || this.ready) throw new Error('相机正在启动或已启用');
    this.starting = true;
    this.startFinished = new Promise<void>((resolve) => { this.finishStart = resolve; });
    const token = ++this.generation;
    try {
      if (surfaceId.length === 0) throw new Error('预览画面未就绪');
      const permission = await abilityAccessCtrl.createAtManager().requestPermissionsFromUser(context, ['ohos.permission.CAMERA']);
      if (token !== this.generation) throw new Error('相机启动已取消');
      if (permission.authResults.length === 0 || permission.authResults[0] !== 0) throw new Error('摄像头权限未授予');
      this.filesDir = context.filesDir;
      const manager = camera.getCameraManager(context);
      const devices = manager.getSupportedCameras();
      if (devices.length === 0) throw new Error('当前镜像未识别到摄像头');
      const capability = manager.getSupportedOutputCapability(devices[0], camera.SceneMode.NORMAL_PHOTO);
      if (capability.previewProfiles.length === 0 || capability.photoProfiles.length === 0) throw new Error('摄像头缺少预览或拍照能力');
      let previewProfile = capability.previewProfiles[0];
      for (const candidate of capability.previewProfiles) {
        if (candidate.size.width <= 1280 && (previewProfile.size.width > 1280 || candidate.size.width >= previewProfile.size.width)) previewProfile = candidate;
      }
      let photoProfile = capability.photoProfiles[0];
      for (const candidate of capability.photoProfiles) {
        if (candidate.size.width <= 1920 && (photoProfile.size.width > 1920 || candidate.size.width >= photoProfile.size.width)) photoProfile = candidate;
      }
      const input = manager.createCameraInput(devices[0]);
      this.input = input;
      await input.open();
      if (token !== this.generation) throw new Error('相机启动已取消');
      this.preview = manager.createPreviewOutput(previewProfile, surfaceId);
      const photoOutput = manager.createPhotoOutput(photoProfile);
      this.photo = photoOutput;
      photoOutput.on('photoAvailable', (error: BusinessError, photo: camera.Photo) => {
        if (error) {
          this.rejectPending('抓拍数据不可用');
          return;
        }
        this.receivePhoto(photo, token).catch(() => { this.rejectPending('相机图像处理失败'); });
      });
      const session = manager.createSession<camera.PhotoSession>(camera.SceneMode.NORMAL_PHOTO);
      this.session = session;
      session.beginConfig();
      session.addInput(input);
      session.addOutput(this.preview);
      session.addOutput(photoOutput);
      await session.commitConfig();
      if (token !== this.generation) throw new Error('相机启动已取消');
      await session.start();
      if (token !== this.generation) throw new Error('相机启动已取消');
      this.ready = true;
    } catch (error) {
      await this.releaseResources();
      const reason = error as Error;
      throw new Error(reason.message || '相机启动失败');
    } finally {
      this.starting = false;
      this.finishStart();
    }
  }

  private rejectPending(message: string): void {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
  }

  private async receivePhoto(photo: camera.Photo, token: number): Promise<void> {
    if (token !== this.generation) { await photo.release(); return; }
    const pending = this.pending;
    if (!pending || pending.processing) { await photo.release(); return; }
    pending.processing = true;
    let createdPath: string = '';
    try {
      if (token !== this.generation || this.pending !== pending) throw new Error('抓拍已取消');
      const component = await photo.main.getComponent(image.ComponentType.JPEG);
      if (component.byteBuffer.byteLength === 0 || component.byteBuffer.byteLength > 20000000) throw new Error('抓拍图片大小异常');
      if (token !== this.generation || this.pending !== pending) throw new Error('抓拍已取消');
      const path = this.filesDir + '/crop-' + Date.now().toString() + '.jpg';
      const file = fileIo.openSync(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
      createdPath = path;
      try {
        let offset = 0;
        while (offset < component.byteBuffer.byteLength) {
          const written = fileIo.writeSync(file.fd, component.byteBuffer.slice(offset));
          if (written <= 0 || written > component.byteBuffer.byteLength - offset) throw new Error('抓拍图片未完整写入');
          offset += written;
        }
      }
      finally { fileIo.closeSync(file); }
      pending.resolve(path);
    } catch (error) {
      if (createdPath.length > 0) { try { fileIo.unlinkSync(createdPath); } catch (cleanupError) {} }
      pending.reject(new Error('图片保存失败或操作已取消'));
    } finally {
      clearTimeout(pending.timer);
      if (this.pending === pending) this.pending = undefined;
      await photo.release();
    }
  }

  async capture(): Promise<string> {
    if (!this.ready || !this.photo) throw new Error('请先启用摄像头');
    if (this.capturing) throw new Error('正在抓拍，请等待');
    this.capturing = true;
    const pending = new PendingPhoto();
    const waiting = new Promise<string>((resolve, reject) => {
      pending.resolve = resolve;
      pending.reject = reject;
      pending.timer = setTimeout(() => {
        if (this.pending === pending) this.rejectPending('抓拍超时，请重新检查摄像头');
      }, 10000);
    });
    waiting.catch(() => {});
    this.pending = pending;
    try {
      // An image may arrive before capture() acknowledgement. The actual image
      // or the bounded watchdog settles this operation; a stalled acknowledgement
      // must not keep the UI waiting forever.
      this.photo.capture().catch(() => {
        if (this.pending === pending) this.rejectPending('抓拍请求失败');
      });
      return await waiting;
    } catch (error) {
      this.rejectPending('抓拍请求失败');
      await this.stop();
      throw new Error('抓拍失败，没有生成图片');
    } finally {
      this.capturing = false;
    }
  }

  private async releaseResources(): Promise<void> {
    this.ready = false;
    const session = this.session;
    const preview = this.preview;
    const photo = this.photo;
    const input = this.input;
    this.session = undefined; this.preview = undefined; this.photo = undefined; this.input = undefined;
    if (session) { try { await session.stop(); } catch (error) {} }
    if (photo) { try { photo.off('photoAvailable'); await photo.release(); } catch (error) {} }
    if (preview) { try { await preview.release(); } catch (error) {} }
    if (input) { try { await input.close(); } catch (error) {} }
    if (session) { try { await session.release(); } catch (error) {} }
  }

  async stop(): Promise<void> {
    this.generation++;
    this.rejectPending('相机已停止');
    if (this.starting) await this.startFinished;
    await this.releaseResources();
  }
}
