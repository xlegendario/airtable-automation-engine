import { unfulfilledOrderCreated } from "./automations/unfulfilledOrderCreated.js";
import { unfulfilledOrderAllocated } from "./automations/unfulfilledOrderAllocated.js";
import { autoAllocateBestUnit } from "./automations/autoAllocateBestUnit.js";

export const automations = [
  unfulfilledOrderCreated,
  unfulfilledOrderAllocated,
  autoAllocateBestUnit,
];
