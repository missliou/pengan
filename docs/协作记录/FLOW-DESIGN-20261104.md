# FLOW-DESIGN-20261104

执行者pipeline_web，根FLOW-REPAIR临时转交唯一写入权，范围仅src/pages/agent-flow.js、src/agent-flow.css、test/agent-flow.test.mjs。重新设计为5节点软件轨道：检索→决策→生成→审核→保存，编号/符号锚点、真实方向连线、运行节点沿连线移动光点，摘要使用轻量边线排版；执行/回传移为独立虚线隔离支路，始终未接入/未执行。没有大方框堆砌或状态轮询闪屏。

桌面5列连续轨道；760以下变为垂直轨道与朝下箭头/移动点，覆盖705宽；420以下工具栏/摘要重新分配，覆盖390宽。支持dark与reduced-motion。历史播放按钮保留，新增暂停/继续；只在显式回放时启动演示节奏，不冒充实时执行。当前既有4测试保留通过，新增分离拓扑与暂停恢复回归，合计5/5通过，日志tmp/flow-design-tests.log。

未修改app/index/全局styles/tasks/timeline，也未build dist；待父协调者统一build及浏览器桌面/705/390截图检验。无外网依赖，无HTML注入。未改共同待办进度，自有子锁已completed/RELEASED。
