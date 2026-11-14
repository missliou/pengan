// Static historical receipt: real model call, synthetic environment, no device action.
export const PIPELINE_TEST_RECEIPT = {
  "testOnly": true,
  "syntheticEnvironment": true,
  "realProvider": true,
  "provider": "deepseek",
  "model": "deepseek-chat",
  "calls": 3,
  "stages": [
    {
      "stage": "decision",
      "state": "passed",
      "startedAt": 1793713393432,
      "finishedAt": 1793713396430,
      "durationMs": 2998,
      "summary": "意图「用户请求检索番茄温湿度资料，并仅生成\"查询环境\"的只读建议，明确不提出开门或任何实际设备操作（合成软件测试场景）。」，置信度 0.86，风险 low，候选 1 条",
      "error": null
    },
    {
      "stage": "generate",
      "state": "passed",
      "startedAt": 1793713396431,
      "finishedAt": 1793713399060,
      "durationMs": 2629,
      "summary": "生成 1 步计划，引用证据 8 条",
      "error": null
    },
    {
      "stage": "verify",
      "state": "passed",
      "startedAt": 1793713399060,
      "finishedAt": 1793713401038,
      "durationMs": 1978,
      "summary": "模型审核结论 allow，理由 5 条",
      "error": null
    }
  ],
  "verdict": "allow",
  "retrievalHits": 1,
  "executed": false,
  "events": [
    {
      "type": "retrieval_started"
    },
    {
      "type": "retrieval_completed"
    },
    {
      "type": "safety_checked"
    },
    {
      "type": "stage_started",
      "stage": "decision"
    },
    {
      "type": "stage_completed",
      "stage": "decision",
      "state": "passed"
    },
    {
      "type": "stage_started",
      "stage": "generate"
    },
    {
      "type": "stage_completed",
      "stage": "generate",
      "state": "passed"
    },
    {
      "type": "stage_started",
      "stage": "verify"
    },
    {
      "type": "stage_completed",
      "stage": "verify",
      "state": "passed"
    }
  ]
};
