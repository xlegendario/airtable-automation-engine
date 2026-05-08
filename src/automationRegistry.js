import { unfulfilledOrderCreated } from "./automations/unfulfilledOrderCreated.js";
import { unfulfilledOrderAllocated } from "./automations/unfulfilledOrderAllocated.js";
import { autoAllocateBestUnit } from "./automations/autoAllocateBestUnit.js";
import { calculateLinkedUnitPrice } from "./automations/calculateLinkedUnitPrice.js";
import { setOutsourceStartTime } from "./automations/setOutsourceStartTime.js";

export const automations = [
  unfulfilledOrderCreated,
  unfulfilledOrderAllocated,
  autoAllocateBestUnit,
  calculateLinkedUnitPrice,
  setOutsourceStartTime,
];
