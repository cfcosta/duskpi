import * as path from "node:path";
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

export interface ExecutionManagerIntegrationResult {
  summary?: string;
  changedFiles?: string[];
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

export type RefactorExecutionRunResult =
  | {
      unitId: string;
      status: "completed";
      summary: string;
      changedFiles: string[];
      validations: RefactorWorkerValidation[];
    }
  | {
      unitId: string;
      status: "blocked" | "failed";
      summary: string;
      blockers: string[];
      validations: RefactorWorkerValidation[];
    };

export interface ExecuteRefactorUnitInput {
  executionUnit: RefactorExecutionUnit;
  approvedPlanSummary?: string;
  step?: number;
  totalSteps?: number;
  timeoutMs?: number;
}

export class RefactorExecutionManager {
  private readonly workspaceBaseDir: string;

  constructor(private readonly options: RefactorExecutionManagerOptions) {
    this.workspaceBaseDir =
      options.workspaceBaseDir ?? path.join(options.repoRoot, ".refactor-workspaces");
  }

  async executeUnit(input: ExecuteRefactorUnitInput): Promise<RefactorExecutionRunResult> {
    const workspaceName = buildWorkspaceName(input.executionUnit, input.step ?? 1);
    const workspacePath = path.join(this.workspaceBaseDir, workspaceName);
    let workspace: ManagedWorkspace | undefined;

    try {
      workspace = await this.options.workspaceManager.createWorkspace(workspaceName, workspacePath);
      const prompt = this.options.renderWorkerPrompt({
        executionUnit: input.executionUnit,
        approvedPlanSummary: input.approvedPlanSummary,
        step: input.step,
        totalSteps: input.totalSteps,
      });
      const workerResult = await this.options.workerRunner.run({
        workspaceRoot: workspace.root,
        prompt,
        timeoutMs: input.timeoutMs,
      });

      if (workerResult.status !== "completed") {
        return {
          unitId: workerResult.unitId,
          status: workerResult.status,
          summary: workerResult.summary,
          blockers: workerResult.blockers,
          validations: workerResult.validations,
        };
      }

      const integrationResult = await this.options.integrate?.({
        workspace,
        executionUnit: input.executionUnit,
        workerResult,
      });

      return {
        unitId: workerResult.unitId,
        status: "completed",
        summary: integrationResult?.summary ?? workerResult.summary,
        changedFiles: integrationResult?.changedFiles ?? workerResult.changedFiles,
        validations: workerResult.validations,
      };
    } catch (error) {
      return {
        unitId: input.executionUnit.id,
        status: "failed",
        summary: `Execution manager failed while running '${input.executionUnit.id}'.`,
        blockers: [error instanceof Error ? error.message : String(error)],
        validations: [],
      };
    } finally {
      if (workspace) {
        try {
          await this.options.workspaceManager.forgetWorkspace(workspace.name);
        } catch {
          // Best-effort cleanup; do not hide the primary execution result in this pass.
        }
      }
    }
  }
}

function buildWorkspaceName(executionUnit: RefactorExecutionUnit, step: number): string {
  const safeId = executionUnit.id.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `refactor-step-${step}-${safeId}`;
}
