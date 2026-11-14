# WEB-THEME-RESTORE-20261104

用户最新明确要求恢复之前的风格；根协调者转交styles.css、agent-flow.css及dist唯一写入权。

精确恢复基线：当前styles.css中上轮WEB-UNIFIED-VISUAL新增`/* Shared console system: one visual language for every page. */`之前的原文件前缀（当时L515起的主题override及后续Numeric badges覆盖全部撤回）；agent-flow.css中`/* Shared console tokens: topology remains animated, surface matches all pages. */`之前的FLOW-DESIGN原文件前缀（当时L18起覆盖撤回）。未使用旧ZIP或整体旧文件替换，没有抹掉先前alerts/timeline及业务修改。

恢复深色渐变侧栏、青绿色渐变按钮、圆角卡片、柔和阴影和既有主题动效。保留原live-dashboard防闪段；flow方向轨道、活动光点、设备隔离支路、窄屏响应式与reduced-motion都未动。app.js没有修改，误导nav dot DOM仍已移除，真实数量badge保留。仅另加功能布局小段：卡片直接输入/textarea全宽与间距、pre折行、窄屏工具栏按钮不溢出；不覆盖主题色、阴影、圆角。

前端119/119通过、0失败，日志tmp/web-theme-restore-tests.log。node admin-ui/build.mjs通过，dist已更新。未改API、数据源、权限、业务、app/index/tasks/timeline或共享清单。浏览器刷新视觉由根协调者验收。自有锁completed/RELEASED。
