import {
  ExecutionScheduler,
  buildExecutionLayers as buildSharedExecutionLayers,
  type ExecutePlanInput,
  type ExecutionScheduleResult,
  type ExecutionSchedulerOptions,
  type ScheduledExecutionLayer,
} from "../../packages/workflow-core/src/index";
import type { RefactorExecutionUnit } from "./contract";
import type { RefactorExecutionRunResult, RefactorUnitExecutor } from "./execution-manager";

export interface RefactorExecutionSchedulerOptions extends ExecutionSchedulerOptions<
  RefactorExecutionUnit,
  RefactorExecutionRunResult["validations"][number]
> {
  executor: RefactorUnitExecutor;
}

export interface RefactorExecutionScheduleResult extends ExecutionScheduleResult<
  RefactorExecutionRunResult["validations"][number]
> {
  layers: ScheduledExecutionLayer<RefactorExecutionRunResult["validations"][number]>[];
}

export interface ExecuteRefactorPlanInput extends ExecutePlanInput<RefactorExecutionUnit> {}

export function buildExecutionLayers(
  executionUnits: RefactorExecutionUnit[],
): RefactorExecutionUnit[][] {
  return buildSharedExecutionLayers(executionUnits);
}

export class RefactorExecutionScheduler extends ExecutionScheduler<
  RefactorExecutionUnit,
  RefactorExecutionRunResult["validations"][number]
> {
  constructor(options: RefactorExecutionSchedulerOptions) {
    super(options);
  }
}
