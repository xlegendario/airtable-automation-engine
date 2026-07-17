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
import { disableClaimDealButtons } from "./automations/disableClaimDealButtons.js";
import { disableSellerOfferButtons } from "./automations/disableSellerOfferButtons.js";
import { syncLowestOffer } from "./automations/syncLowestOffer.js";
import { setPartnerOrSeller } from "./automations/setPartnerOrSeller.js";
import { sendShipmentDelayWebhook } from "./automations/sendShipmentDelayWebhook.js";
import { markLinkedInventoryPaidIfAutoSeller } from "./automations/markLinkedInventoryPaidIfAutoSeller.js";
import { sendOfferRequestWebhook } from "./automations/sendOfferRequestWebhook.js";
import { touchStockLevelModified } from "./automations/touchStockLevelModified.js";
import {
  closeOrderConsignmentOffersWhenNotOutsource,
  closeMemberWtbConsignmentOffersWhenNotOutsource,
} from "./automations/closeConsignmentOffersWhenNotOutsource.js";
import { memberWtbShippingLabelReadyToShip } from "./automations/memberWtbShippingLabelReadyToShip.js";
import { memberWtbSendShippingLabelToDiscord } from "./automations/memberWtbSendShippingLabelToDiscord.js";
import { computeAndPushLowestOffer } from "./automations/computeAndPushLowestOffer.js";

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
  disableClaimDealButtons,
  disableSellerOfferButtons,
  syncLowestOffer,
  setPartnerOrSeller,
  sendShipmentDelayWebhook,
  markLinkedInventoryPaidIfAutoSeller,
  sendOfferRequestWebhook,
  touchStockLevelModified,
  closeOrderConsignmentOffersWhenNotOutsource,
  closeMemberWtbConsignmentOffersWhenNotOutsource,
  memberWtbShippingLabelReadyToShip,
  memberWtbSendShippingLabelToDiscord,
  computeAndPushLowestOffer,
];
