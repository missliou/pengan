// 演示数据层。
// 铁律：只有用户显式开启"演示模式"才会被引用；界面顶部常驻黄色警示条；
// 演示数据永远不与真实接口数据混在同一列表/同一图表里。
// 这里模拟的是"接口返回形状"，字段与 gateway 真实响应逐一对齐，方便联调对照。

const DAY = 86_400_000;

function wave(base, amp, phase, i) {
  return base + amp * Math.sin(i / 7 + phase);
}

export function demoHealth(now = Date.now()) {
  return { ok: true, mode: 'hardware', simulated: false, transport: 'demo-mode', hardwareConnected: true, demoNote: '演示数据，未连接后端' , _demo: true };
}

export function demoObservations(now = Date.now()) {
  // 30 个每 2 秒一帧的快照只保留最近一份作为"当前"，历史在 demoHistory 里。
  const t = now - 3000;
  return {
    schemaVersion: 1, mode: 'hardware', simulated: false, gatewayNow: now,
    hardware: {
      schemaVersion: 1, deviceId: 'hh-hsp101-001', source: 'demo', simulated: false,
      deviceOnline: true, reason: 'read_only_hardware', receivedAt: t, sampleAgeMs: 3000,
      uptimeMs: 432_100, climateAgeMs: 3200, gasAgeMs: 3150,
      values: { temperatureC: 25.6, humidityPct: 63.8, gasRaw: 1234, gasMv: 3210, coPpm: null, co2Ppm: null },
      quality: { temperatureValid: true, humidityValid: true, gasValid: true, coValid: false, co2Valid: false },
      actuationAvailable: false, controlSupported: false, admission: 'unknown_denied',
    },
    capabilities: { readEnvironment: true, actuate: false, co: false, co2: false },
    admission: 'unknown_denied', _demo: true,
  };
}

export function demoModelStatus(now = Date.now()) {
  return {
    configured: true, provider: 'deepseek', model: 'deepseek-chat',
    executesDevices: false, imageAnalysis: true,
    connectionCheck: { state: 'passed', checkedAt: now - 2 * DAY },
    workspaceId: '', _demo: true,
  };
}

export function demoHardwareHistory(now = Date.now()) {
  const items = [];
  for (let i = 0; i < 60; i++) {
    const seq = 60 - i; // 后端按新→旧返回
    const t = now - i * 2 * 60_000;
    const outage = i >= 20 && i < 24; // 制造一段真实感的"离线缺口"
    items.push({
      seq, hash: 'demo'.padEnd(64, '0'), historical: true, isCurrent: false,
      observation: {
        schemaVersion: 1, deviceId: 'hh-hsp101-001', source: 'demo', simulated: false,
        deviceOnline: !outage, reason: outage ? 'telemetry_stale' : 'read_only_hardware',
        receivedAt: outage ? null : t, sampleAgeMs: outage ? null : 1500,
        climateAgeMs: outage ? null : 1700, gasAgeMs: outage ? null : 1600, uptimeMs: null,
        values: outage
          ? { temperatureC: null, humidityPct: null, gasRaw: null, gasMv: null, coPpm: null, co2Ppm: null }
          : {
            temperatureC: Math.round(wave(25.4, 1.6, 0, i) * 10) / 10,
            humidityPct: Math.round(wave(62, 5, 1.2, i) * 10) / 10,
            gasRaw: Math.round(wave(1200, 90, 2.1, i)),
            gasMv: Math.round(wave(3100, 160, 0.6, i)),
            coPpm: null, co2Ppm: null,
          },
        quality: outage
          ? { temperatureValid: false, humidityValid: false, gasValid: false, coValid: false, co2Valid: false }
          : { temperatureValid: true, humidityValid: true, gasValid: true, coValid: false, co2Valid: false },
        actuationAvailable: false, admission: 'unknown_denied',
      },
    });
  }
  return {
    schemaVersion: 1, simulated: false, historical: true, isCurrent: false,
    storage: { enabled: true, healthy: true, records: items.length, bytes: items.length * 420, maxBytes: 64 * 1024 * 1024 },
    retainedInMemory: items.length, items, _demo: true,
  };
}

export function demoAnalysisHistory(now = Date.now()) {
  const items = [
    {
      seq: 3, hash: 'demo3'.padEnd(64, '0'), prompt: '当前温湿度适合育苗吗？（演示）',
      recordedAt: now - 3 * 3600_000, historical: true, isCurrent: false,
      analysis: {
        mode: 'hardware', kind: 'hardware_analysis', simulated: false, executed: false,
        hardwareControl: false, realAdmission: 'unknown_denied', steps: [],
        provider: 'deepseek', model: 'deepseek-chat',
        analyzedAt: now - 3 * 3600_000, observationReceivedAt: now - 3 * 3600_000 - 20_000,
        deviceOnline: true,
        summary: '【演示文本】温度 24.9℃、湿度 61%，处于常见育苗适宜区间；ADC 只能反映 MQ-2 原始值，不能当浓度。',
        findings: ['温度与湿度均在常见育苗区间'],
        unknowns: ['CO/CO₂ 未接入', '无执行器回执'],
      },
    },
    {
      seq: 2, hash: 'demo2'.padEnd(64, '0'), prompt: '夜里湿度会过高吗？（演示）',
      recordedAt: now - 26 * 3600_000, historical: true, isCurrent: false,
      analysis: {
        mode: 'hardware', kind: 'hardware_analysis', simulated: false, executed: false,
        hardwareControl: false, realAdmission: 'unknown_denied', steps: [],
        provider: 'deepseek', model: 'deepseek-chat',
        analyzedAt: now - 26 * 3600_000, observationReceivedAt: null,
        deviceOnline: false,
        summary: '【演示文本】采集当时离线，无法基于现场数据判断；历史窗口显示夜间湿度有上抬趋势。',
        findings: ['离线期间不给出安全结论'],
        unknowns: ['当时无有效读数', 'CO/CO₂ 未接入'],
      },
    },
  ];
  return {
    schemaVersion: 1, simulated: false, historical: true, isCurrent: false,
    storage: { enabled: true, healthy: true, records: items.length, bytes: items.length * 900, maxBytes: 16 * 1024 * 1024 },
    items, _demo: true,
  };
}

// 演示模式下的"后端调用"：带延迟、带一次性失败演示钩子。
export function demoCall(fn, delay = 260) {
  return new Promise((resolve, reject) => setTimeout(() => {
    try { resolve(fn()); } catch (e) { reject(e); }
  }, delay));
}

export const DEMO = {
  health: () => demoHealth(),
  observations: () => demoObservations(),
  modelStatus: () => demoModelStatus(),
  hardwareHistory: () => demoHardwareHistory(),
  analysisHistory: () => demoAnalysisHistory(),
};
