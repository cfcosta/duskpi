import type { RefactorExecutionUnit } from "./contract";
import type {
  ExecuteRefactorUnitInput,
  RefactorExecutionRunResult,
  RefactorUnitExecutor,
} from "./execution-manager";

export interface RefactorExecutionSchedulerOptions {
  executor: RefactorUnitExecutor;
}

export interface ScheduledExecutionLayer {
  layer: number;
  unitIds: string[];
  results: RefactorExecutionRunResult[];
}

export interface RefactorExecutionScheduleResult {
  status: "completed" | "failed";
  layers: ScheduledExecutionLayer[];
  remainingUnitIds: string[];
}

export interface ExecuteRefactorPlanInput {
  executionUnits: RefactorExecutionUnit[];
  approvedPlanSummary?: string;
  timeoutMs?: number;
}

export function buildExecutionLayers(
  executionUnits: RefactorExecutionUnit[],
): RefactorExecutionUnit[][] {
  const remainingDependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  const originalIndexes = new Map<string, number>();
  const unitsById = new Map<string, RefactorExecutionUnit>();

  for (const [index, executionUnit] of executionUnits.entries()) {
    remainingDependencies.set(executionUnit.id, new Set(executionUnit.dependsOn));
    dependents.set(executionUnit.id, []);
    originalIndexes.set(executionUnit.id, index);
    unitsById.set(executionUnit.id, executionUnit);
  }

  for (const executionUnit of executionUnits) {
    for (const dependencyId of executionUnit.dependsOn) {
      dependents.get(dependencyId)?.push(executionUnit.id);
    }
  }

  const layers: RefactorExecutionUnit[][] = [];
  const scheduled = new Set<string>();

  while (scheduled.size < executionUnits.length) {
    const ready = executionUnits.filter((executionUnit) => {
      if (scheduled.has(executionUnit.id)) {
        return false;
      }

      const dependencies = remainingDependencies.get(executionUnit.id);
      return !dependencies || dependencies.size === 0;
    });

    if (ready.length === 0) {
      throw new Error(
        "Unable to build execution layers: dependency cycle or missing prerequisite detected.",
      );
    }

    ready.sort((left, right) => {
      return (originalIndexes.get(left.id) ?? 0) - (originalIndexes.get(right.id) ?? 0);
    });
    layers.push(ready);

    for (const executionUnit of ready) {
      scheduled.add(executionUnit.id);
      for (const dependentId of dependents.get(executionUnit.id) ?? []) {
        remainingDependencies.get(dependentId)?.delete(executionUnit.id);
      }
    }
  }

  return layers.map((layer) => layer.map((executionUnit) => unitsById.get(executionUnit.id)!));
}

export class RefactorExecutionScheduler {
  constructor(private readonly options: RefactorExecutionSchedulerOptions) {}

  async execute(input: ExecuteRefactorPlanInput): Promise<RefactorExecutionScheduleResult> {
    const layers = buildExecutionLayers(input.executionUnits);
    const totalSteps = input.executionUnits.length;
    const stepById = new Map<string, number>();
    let nextStep = 1;

    for (const layer of layers) {
      for (const executionUnit of layer) {
        stepById.set(executionUnit.id, nextStep);
        nextStep += 1;
      }
    }

    const layerResults: ScheduledExecutionLayer[] = [];
    for (const [layerIndex, layer] of layers.entries()) {
      const results = await Promise.all(
        layer.map((executionUnit) => {
          const step = stepById.get(executionUnit.id) ?? 1;
          const args: ExecuteRefactorUnitInput = {
            executionUnit,
            approvedPlanSummary: input.approvedPlanSummary,
            step,
            totalSteps,
            timeoutMs: input.timeoutMs,
          };
          return this.options.executor.executeUnit(args);
        }),
      );

      layerResults.push({
        layer: layerIndex + 1,
        unitIds: layer.map((executionUnit) => executionUnit.id),
        results,
      });

      if (results.some((result) => result.status !== "completed")) {
        const executedIds = new Set(layerResults.flatMap((entry) => entry.unitIds));
        const remainingUnitIds = input.executionUnits
          .map((executionUnit) => executionUnit.id)
          .filter((unitId) => !executedIds.has(unitId));

        return {
          status: "failed",
          layers: layerResults,
          remainingUnitIds,
        };
      }
    }

    return {
      status: "completed",
      layers: layerResults,
      remainingUnitIds: [],
    };
  }
}
