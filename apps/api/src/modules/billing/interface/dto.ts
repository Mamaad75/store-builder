import type { PaymentRow } from "../application/payment-ports.js";
import type { EntryRow, PlanRow, PurchaseRow, ReferralRow, SubscriptionRow } from "../application/ports.js";

export const planDto = (p: PlanRow) => ({ id: p.id, name: p.name, description: p.description, priceToman: p.priceToman, durationDays: p.durationDays, maxProducts: p.maxProducts, maxStaff: p.maxStaff, active: p.active });
export const subscriptionDto = (s: SubscriptionRow | null) => (s ? { planName: s.planName, startsAt: s.startsAt, endsAt: s.endsAt } : null);
export const purchaseDto = (p: PurchaseRow) => ({ id: p.id, planName: p.planName, priceToman: p.priceToman, discountToman: p.discountToman, walletUsedToman: p.walletUsedToman, cashToman: p.cashToman, periodStart: p.periodStart, periodEnd: p.periodEnd, note: p.note, createdAt: p.createdAt });
export const entryDto = (e: EntryRow) => ({ id: e.id, amountToman: e.amountToman, balanceAfter: e.balanceAfter, kind: e.kind, note: e.note, createdAt: e.createdAt });
export const referralDto = (r: ReferralRow) => ({ id: r.id, status: r.status, rewardToman: r.rewardToman, createdAt: r.createdAt, rewardedAt: r.rewardedAt });
export const paymentDto = (p: PaymentRow) => ({ id: p.id, purpose: p.purpose, planName: p.planName, priceToman: p.priceToman, discountToman: p.discountToman, walletHeldToman: p.heldToman, amountToman: p.amountToman, status: p.status, refId: p.refId, createdAt: p.createdAt, paidAt: p.paidAt });
