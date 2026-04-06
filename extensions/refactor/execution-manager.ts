import * as path from "node:path";
import {
  ExecutionManager,
  type ExecuteUnitInput,
  type ExecutionManagerIntegrationResult,
  type ExecutionManagerOptions,
  type ExecutionRunResult,
  type WorkerPromptRenderInput,
} from "../../packages/workflow-core/src/index";
import type { RefactorExecutionUnit } from "./contract";
import type { WorkerPromptInput } from "./prompting";
import type { RefactorWorkerResult, RefactorWorkerValidation } from "./worker-result";
import type { ManagedWorkspace } from "./workspace-manager";

export interface WorkspaceManagerLike {
  createWorkspace(name: string, destinationPath: string): Promise<ManagedWorkspace>;
  forgetWorkspace(name: string): Promise<void>;
}

export interface WorkerRunnerLike {
  run(input: {
    workspaceRoot: string;
    prompt: string;
    timeoutMs?: number;
  }): Promise<RefactorWorkerResult>;
}

export interface RefactorExecutionManagerOptions {
  repoRoot: string;
  workspaceManager: WorkspaceManagerLike;
  workerRunner: WorkerRunnerLike;
  renderWorkerPrompt: (input: WorkerPromptInput) => string;
  integrate?: (args: {
    workspace: ManagedWorkspace;
    executionUnit: RefactorExecutionUnit;
    workerResult: Extract<RefactorWorkerResult, { status: "completed" }>;
  }) => Promise<ExecutionManagerIntegrationResult> | ExecutionManagerIntegrationResult;
  workspaceBaseDir?: string;
}

export type RefactorExecutionRunResult = ExecutionRunResult<RefactorWorkerValidation>;

export interface ExecuteRefactorUnitInput extends ExecuteUnitInput<RefactorExecutionUnit> {}

export interface RefactorUnitExecutor {
  executeUnit(input: ExecuteRefactorUnitInput): Promise<RefactorExecutionRunResult>;
}

export class RefactorExecutionManager
  extends ExecutionManager<RefactorExecutionUnit, RefactorWorkerValidation>
  implements RefactorUnitExecutor
{
  constructor(options: RefactorExecutionManagerOptions) {
    const sharedOptions: ExecutionManagerOptions<RefactorExecutionUnit, RefactorWorkerValidation> = {
      repoRoot: options.repoRoot,
      workspaceManager: options.workspaceManager,
      workerRunner: options.workerRunner,
      renderWorkerPrompt: (input: WorkerPromptRenderInput<RefactorExecutionUnit>) =>
        options.renderWorkerPrompt(input),
      integrate: options.integrate,
      workspaceBaseDir:
        options.workspaceBaseDir ?? path.join(options.repoRoot, ".refactor-workspaces"),
      buildWorkspaceName: (executionUnit, step) => buildWorkspaceName(executionUnit, step),
    };

    super(sharedOptions);
  }
}

function buildWorkspaceName(executionUnit: RefactorExecutionUnit, step: number): string {
  const safeId = executionUnit.id.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `refactor-step-${step}-${safeId}`;
}
