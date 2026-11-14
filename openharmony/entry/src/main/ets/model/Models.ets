export class EnvSnapshot {
  co: number = 4;
  co2: number = 680;
  temperature: number = 25.6;
  humidity: number = 64;
  soil: number = 48;
  light: number = 12600;
  sampledAt: number = Date.now();
  sensorOnline: boolean = true;
  emergency: boolean = false;
}

export class SafetyResult {
  allowed: boolean;
  reasons: string[];
  constructor(allowed: boolean, reasons: string[]) {
    this.allowed = allowed;
    this.reasons = reasons;
  }
}

export class EventRecord {
  id: number;
  at: number;
  time: string;
  title: string;
  detail: string;
  source: string;
  blocked: boolean;
  constructor(id: number, title: string, detail: string, source: string, blocked: boolean = false) {
    this.id = id;
    this.at = Date.now();
    this.time = new Date(this.at).toLocaleTimeString();
    this.title = title;
    this.detail = detail;
    this.source = source;
    this.blocked = blocked;
  }
}

export class ChatMessage {
  id: number;
  user: boolean;
  text: string;
  constructor(id: number, user: boolean, text: string) {
    this.id = id;
    this.user = user;
    this.text = text;
  }
}
