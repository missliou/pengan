import { TaskRecord, TaskStep, StepState } from '../model/TaskModels';

export class TaskFlow {
  static append(task: TaskRecord, name: string, detail: string, state: StepState): TaskRecord {
    const next = TaskFlow.copy(task);
    next.steps = [...next.steps, new TaskStep(name, detail, state)];
    return next;
  }

  static settle(task: TaskRecord, detail: string, success: boolean): TaskRecord {
    const next = TaskFlow.copy(task);
    next.steps = next.steps.map((step: TaskStep) => {
      if (step.state !== 'waiting') return step;
      return new TaskStep(step.name, detail, success ? 'done' : 'blocked');
    });
    return next;
  }

  private static copy(task: TaskRecord): TaskRecord {
    const next = new TaskRecord(task.id, task.title, task.source);
    next.time = task.time;
    next.version = task.version + 1;
    next.steps = task.steps.slice();
    return next;
  }
}
