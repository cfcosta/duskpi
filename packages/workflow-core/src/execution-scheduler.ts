import type {
  ExecuteUnitInput,
  ExecutionRunResult,
  ExecutionUnitExecutor,
  ExecutionUnitLike,
} from "./execution-manager";

export interface ExecutionSchedulerOptions<Unit extends ExecutionUnitLike, Validation = unknown> {
  executor: ExecutionUnitExecutor<Unit, Validation>;
}

export interface ScheduledExecutionLayer<Validation = unknown> {
  layer: number;
  unitIds: string[];
  results: ExecutionRunResult<Validation>[];
}

export interface ExecutionScheduleResult<Validation = unknown> {
  status: "completed" | "failed";
  layers: ScheduledExecutionLayer<Validation>[];
  remainingUnitIds: string[];
}

export interface ExecutePlanInput<Unit extends ExecutionUnitLike> {
  executionUnits: Unit[];
  approvedPlanSummary?: string;
  timeoutMs?: number;
}

export function buildExecutionLayers<Unit extends ExecutionUnitLike>(executionUnits: Unit[]): Unit[][] {
  const remainingDependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  const originalIndexes = new Map<string, number>();
  const unitsById = new Map<string, Unit>();

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

  const layers: Unit[][] = [];
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

export class ExecutionScheduler<Unit extends ExecutionUnitLike, Validation = unknown> {
  constructor(private readonly options: ExecutionSchedulerOptions<Unit, Validation>) {}

  async execute(input: ExecutePlanInput<Unit>): Promise<ExecutionScheduleResult<Validation>> {
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

    const layerResults: ScheduledExecutionLayer<Validation>[] = [];
    for (const [layerIndex, layer] of layers.entries()) {
      const results = await Promise.all(
        layer.map((executionUnit) => {
          const step = stepById.get(executionUnit.id) ?? 1;
          const args: ExecuteUnitInput<Unit> = {
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
