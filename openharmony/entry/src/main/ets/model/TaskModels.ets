export type StepState = 'waiting' | 'done' | 'blocked';
export class TaskStep {
  name: string;
  detail: string;
  state: StepState;
  constructor(name: string, detail: string, state: StepState) {
    this.name = name; this.detail = detail; this.state = state;
  }
}
export class TaskRecord {
  id: number;
  title: string;
  source: string;
  time: string;
  version: number = 0;
  steps: TaskStep[] = [];
  constructor(id: number, title: string, source: string) {
    this.id = id; this.title = title; this.source = source;
    this.time = new Date().toLocaleTimeString();
  }
}
