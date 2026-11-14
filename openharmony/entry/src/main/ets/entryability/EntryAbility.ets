import UIAbility from '@ohos.app.ability.UIAbility';
import window from '@ohos.window';

export default class EntryAbility extends UIAbility {
  onWindowStageCreate(windowStage: window.WindowStage): void {
    this.loadMainWindow(windowStage);
  }

  private async loadMainWindow(windowStage: window.WindowStage): Promise<void> {
    // Native window policy applies on every app launch; it does not alter the
    // system sleep setting or claim to run before this application is opened.
    try {
      await windowStage.getMainWindowSync().setWindowKeepScreenOn(true);
      console.info('Pengan: foreground window keeps screen on');
    } catch (error) {
      console.warn('Pengan: keep-screen-on setup failed: ' + (error as Error).message);
    }
    // Ask WindowManager to size the content below system bars. A fixed top
    // padding would depend on pixel density and would fail after rotation.
    try {
      const mainWindow = windowStage.getMainWindowSync();
      await mainWindow.setWindowLayoutFullScreen(false);
      await mainWindow.setWindowSystemBarEnable(['status', 'navigation']);
      console.info('Pengan: non-immersive system-bar layout configured');
    } catch (error) {
      console.warn('Pengan: system bar layout setup failed: ' + (error as Error).message);
    }
    try {
      windowStage.loadContent('pages/Index', (error) => {
        if (error && error.code) {
          console.error('Pengan: Index loadContent failed, code=' + error.code.toString() + ', message=' + error.message);
          return;
        }
        console.info('Pengan: Index content loaded');
      });
    } catch (error) {
      console.error('Pengan: Index loadContent threw: ' + (error as Error).message);
    }
  }
}
