import { unfulfilledOrderCreated } from "./automations/unfulfilledOrderCreated.js";
import { unfulfilledOrderAllocated } from "./automations/unfulfilledOrderAllocated.js";
import { autoAllocateBestUnit } from "./automations/autoAllocateBestUnit.js";
import { calculateLinkedUnitPrice } from "./automations/calculateLinkedUnitPrice.js";
import { setOutsourceStartTime } from "./automations/setOutsourceStartTime.js";
import { splitQuantityOrders } from "./automations/splitQuantityOrders.js";
import { shippingLabelReadyToShip } from "./automations/shippingLabelReadyToShip.js";
import { sendShippingLabelToDiscord } from "./automations/sendShippingLabelToDiscord.js";
import { updateQuickDealEmbed } from "./automations/updateQuickDealEmbed.js";
import { runOutsourceCheck } from "./automations/runOutsourceCheck.js";

export const automations = [
  unfulfilledOrderCreated,
  unfulfilledOrderAllocated,
  autoAllocateBestUnit,
  calculateLinkedUnitPrice,
  setOutsourceStartTime,
  splitQuantityOrders,
  shippingLabelReadyToShip,
  sendShippingLabelToDiscord,
  updateQuickDealEmbed,
  runOutsourceCheck,
];
