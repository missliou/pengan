# WEB-CONTEXT-FIX-20261104

执行者pipeline_web，待根协调者汇总。范围仅admin-ui/src/pages/alerts.js、review.js、app.js徽标调用及相关测试。已原子认领独立锁，未碰Qwen的tasks/timeline/styles/dist、根agent-flow/index、共享待办进度或后端。

修复：
1. alerts详情重读开始清currentAlert并禁提交，提交再次要求currentAlert.alertId===selectedId。选B等待时不能把备注写A。
2. alerts提交捕获detailGeneration/alertId，回执和失败均只落对应选择上下文，旧A回执不覆盖B、不清B草稿；同项输入已变化时也不清新草稿。syncSubmitState纳入busy，旧提交最终结束后按当前详情恢复按钮。
3. review提交捕获revision及该form detail.version，不再借全局detailVersion；迟到成功/失败只处理原任务且revision未变化时的输入和反馈，切B后不刷新/重建B草稿。
4. app两个侧栏徽标直调API明确传第二参数gatewayId，解决多设备gateway_required导致徽标未知。

新增5项回归：alerts选B pending禁提交、A迟到成功/失败保留B、review迟到成功/失败保留B、提取真实app徽标函数验证两处请求带设备。执行node --test admin-ui/test/alerts.test.mjs admin-ui/test/review.test.mjs admin-ui/test/badge-scope.test.mjs =>42通过/0失败/0跳过；日志tmp/web-context-fix-tests.log。此前只读宿主已复现原错写：selected B时实际noteAlert({alertId:A,text:'comment intended for B'})。

未build dist（Qwen持锁），未浏览器视觉验收/真实后端写入/设备验收。需父协调者在Qwen释放后统一build和浏览器验证。本任务锁已completed/RELEASED。
