import { unfulfilledOrderCreated } from "./automations/unfulfilledOrderCreated.js";
import { unfulfilledOrderAllocated } from "./automations/unfulfilledOrderAllocated.js";

export const automations = [
  unfulfilledOrderCreated,
  unfulfilledOrderAllocated,
];
