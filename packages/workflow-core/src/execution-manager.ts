import * as path from "node:path";
import type { ManagedWorkspace } from "./workspace-manager";

export interface ExecutionUnitLike {
  id: string;
  dependsOn: string[];
}

export interface WorkspaceManagerLike {
  createWorkspace(name: string, destinationPath: string): Promise<ManagedWorkspace>;
  forgetWorkspace(name: string): Promise<void>;
}

export interface WorkerRunnerLike<Result> {
  run(input: { workspaceRoot: string; prompt: string; timeoutMs?: number }): Promise<Result>;
}

export interface WorkerPromptRenderInput<Unit> {
  executionUnit: Unit;
  approvedPlanSummary?: string;
  step?: number;
  totalSteps?: number;
}

export interface CompletedExecutionWorkerResult<Validation = unknown> {
  unitId: string;
  status: "completed";
  summary: string;
  changedFiles: string[];
  validations: Validation[];
}

export interface BlockedExecutionWorkerResult<Validation = unknown> {
  unitId: string;
  status: "blocked" | "failed";
  summary: string;
  blockers: string[];
  validations: Validation[];
}

export type ExecutionWorkerResult<Validation = unknown> =
  | CompletedExecutionWorkerResult<Validation>
  | BlockedExecutionWorkerResult<Validation>;

export interface ExecutionManagerIntegrationResult {
  summary?: string;
  changedFiles?: string[];
  conflicts?: string[];
}

export interface ExecutionManagerOptions<Unit extends ExecutionUnitLike, Validation = unknown> {
  repoRoot: string;
  workspaceManager: WorkspaceManagerLike;
  workerRunner: WorkerRunnerLike<ExecutionWorkerResult<Validation>>;
  renderWorkerPrompt: (input: WorkerPromptRenderInput<Unit>) => string;
  integrate?: (args: {
    workspace: ManagedWorkspace;
    executionUnit: Unit;
    workerResult: CompletedExecutionWorkerResult<Validation>;
  }) => Promise<ExecutionManagerIntegrationResult> | ExecutionManagerIntegrationResult;
  workspaceBaseDir?: string;
  buildWorkspaceName?: (executionUnit: Unit, step: number) => string;
}

export type ExecutionRunResult<Validation = unknown> =
  | {
      unitId: string;
      status: "completed";
      summary: string;
      changedFiles: string[];
      validations: Validation[];
    }
  | {
      unitId: string;
      status: "blocked" | "failed";
      summary: string;
      blockers: string[];
      validations: Validation[];
    };

export interface ExecuteUnitInput<Unit> {
  executionUnit: Unit;
  approvedPlanSummary?: string;
  step?: number;
  totalSteps?: number;
  timeoutMs?: number;
}

export interface ExecutionUnitExecutor<Unit, Validation = unknown> {
  executeUnit(input: ExecuteUnitInput<Unit>): Promise<ExecutionRunResult<Validation>>;
}

export class ExecutionManager<
  Unit extends ExecutionUnitLike,
  Validation = unknown,
> implements ExecutionUnitExecutor<Unit, Validation> {
  private readonly workspaceBaseDir: string;
  private readonly buildWorkspaceName: (executionUnit: Unit, step: number) => string;

  constructor(private readonly options: ExecutionManagerOptions<Unit, Validation>) {
    this.workspaceBaseDir =
      options.workspaceBaseDir ?? path.join(options.repoRoot, ".workflow-workspaces");
    this.buildWorkspaceName = options.buildWorkspaceName ?? defaultBuildWorkspaceName;
  }

  async executeUnit(input: ExecuteUnitInput<Unit>): Promise<ExecutionRunResult<Validation>> {
    const workspaceName = this.buildWorkspaceName(input.executionUnit, input.step ?? 1);
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

      if ((integrationResult?.conflicts?.length ?? 0) > 0) {
        return {
          unitId: workerResult.unitId,
          status: "failed",
          summary:
            integrationResult?.summary ?? `Integration blocked for '${workerResult.unitId}'.`,
          blockers: integrationResult!.conflicts!,
          validations: workerResult.validations,
        };
      }

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

function defaultBuildWorkspaceName(executionUnit: ExecutionUnitLike, step: number): string {
  const safeId = executionUnit.id.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return `execution-step-${step}-${safeId}`;
}
