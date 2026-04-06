import {
  WorkerRunner,
  type WorkerRunInput as SharedWorkerRunInput,
  type WorkerRunnerExec,
} from "../../packages/workflow-core/src/index";
import { parseTaggedWorkerResult, type RefactorWorkerResult } from "./worker-result";

export interface RefactorWorkerRunnerOptions {
  exec: WorkerRunnerExec;
  command?: string;
  timeoutMs?: number;
}

export interface RefactorWorkerRunInput extends SharedWorkerRunInput {}

export class RefactorWorkerRunner extends WorkerRunner<RefactorWorkerResult> {
  constructor(options: RefactorWorkerRunnerOptions) {
    super({
      ...options,
      parseResult: parseTaggedWorkerResult,
    });
  }
}
