// Decorative movement only. No device or task state is synthesized here.
@Component
export struct GreenhouseMotionImage {
  @Prop imageHeight: number = 124;
  @Prop motionEnabled: boolean = true;
  @State entered: boolean = false;
  @State travel: number = 0;

  private begin(): void {
    animateTo({ duration: this.motionEnabled ? 340 : 0, curve: Curve.EaseOut }, () => { this.entered = true; });
    if (!this.motionEnabled) return;
    animateTo({ duration: 5600, iterations: 2, playMode: PlayMode.Alternate, curve: Curve.EaseInOut }, () => {
      this.travel = 1;
    });
  }

  build() {
    Image($r('app.media.greenhouse_art')).width('100%').height(this.imageHeight).objectFit(ImageFit.Cover)
      .accessibilityText('温室主题插画，装饰动效，非现场照片')
      .scale({ x: this.motionEnabled ? 1.035 + this.travel * 0.015 : 1, y: this.motionEnabled ? 1.035 + this.travel * 0.015 : 1 })
      .translate({ x: this.motionEnabled ? this.travel * 4 : 0 })
      .opacity(this.entered || !this.motionEnabled ? 1 : 0.65)
      .onAppear(() => { this.begin(); })
  }
}

@Component
export struct NativeBusyIndicator {
  @Prop label: string = '正在处理';
  @Prop motionEnabled: boolean = true;
  build() {
    Row({ space: 10 }) {
      if (this.motionEnabled) {
        LoadingProgress().width(22).height(22).color('#0F766E')
      } else {
        Text('…').fontSize(20).fontColor('#0F766E')
      }
      Text(this.label).fontSize(14).lineHeight(21).fontColor('#0F766E').layoutWeight(1)
    }.width('100%').padding(12).backgroundColor('#E7F3F0').borderRadius(12)
      .accessibilityText(this.label)
  }
}
