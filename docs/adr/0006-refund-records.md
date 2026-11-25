# ADR 0006 — Refund records for financial reporting

**Status:** Proposed (2026-11-25). Nothing in this document is implemented. No schema change has been made.
**Scope:** recording refunds so that reports can separate gross paid revenue, completed refunds, net paid revenue and money still owed to
buyers. It is **not** a refund *workflow* with provider APIs. Calling the gateways' refund APIs is listed as a later option only.

## 1. What exists today (inspected 2026-11-25)

| Concept | Where | Facts relevant to refunds |
|---|---|---|
| Order | `Order` | `total` (toman, BigInt, after discount, with shipping and COD fee), `status`, `paymentMethod` (COD / ONLINE / CARD_TRANSFER). No refund fields. |
| Online payment attempt | `Payment` (there is no separate `PaymentAttempt` model; one `Payment` row = one gateway session) | `amountRial`; `status` CREATED / VERIFYING / PAID / FAILED / EXPIRED / REFUND_REQUIRED. PAID and REFUND_REQUIRED always carry `refId` and `verifiedAt` (CHECK). Several attempts per order are possible. |
| Captured but not owed to the store | `Payment.status = REFUND_REQUIRED` | Money was verified on an order that was no longer payable: paid by another attempt, expired, or cancelled. It means "the merchant must return it". Nothing marks it returned. |
| Uncaptured gateway money | — | Zarinpal returns money it never verified itself (`GATEWAY_AUTO_REFUNDS.ZARINPAL = true`). Aghaye Pardakht does not, so its late captures become REFUND_REQUIRED. |
| Card-to-card capture | `TransferReceipt.status = APPROVED` | No amount field: approval means the order's `total` was received. |
| Cash on delivery | — | No capture record. Money is assumed collected at `DELIVERED` (approved M2 rule). |
| Gateway adapters | `zarinpal.ts`, `aqayepardakht.ts` | Only `request` / `verify` / `inquiry`. No refund call is integrated. |
| Audit | `AuditEvent` (store audit log), `OrderEvent` (status history only; requires a status change) | |
| Paid-then-cancelled | `canTransition` | MERCHANT can cancel PLACED and CONFIRMED orders; CUSTOMER can cancel PLACED. A paid online or card-to-card order can therefore end up CANCELLED, with no refund record. |

## 2. Decisions this ADR proposes

### 2.1 What a refund references (question 1)

A refund returns money from one **capture**, which is the record that proves the money was received:

| Order payment method | Capture referenced | Capture amount (the cap) |
|---|---|---|
| ONLINE | the `Payment` row (status PAID or REFUND_REQUIRED) — `paymentId` required | `Payment.amountRial` |
| CARD_TRANSFER | the order, once a `TransferReceipt` is APPROVED (`receiptId` stored for traceability) | `Order.total` |
| COD | the order, once it is DELIVERED | `Order.total` |

Every refund also carries `storeId` and `orderId`, with the same composite foreign key to `Order` that `Payment` uses. This scopes every query to one store and lets reports group by order. A duplicate online capture on the same order is its own `Payment` row, so each capture has its own cap.

### 2.2 A separate `Refund` model is necessary (question 2)

* There can be several partial refunds per capture, each with its own state, amount, provider reference and timestamps. One row per refund is the only shape that supports this.
* `Payment` cannot be reused. Its status machine is driven by the verify and reconcile jobs (`settlePaid`, `settleUnpaid`, and queries by `status, nextCheckAt`). Refund states there would interfere with them.
* Money rows stay immutable apart from their status transition. History and audit stay simple.

**Proposed model** (names indicative):

```prisma
enum RefundStatus { PENDING SUCCEEDED FAILED CANCELLED }
enum RefundMethod { GATEWAY BANK_TRANSFER CASH OTHER }   // how the money went back (recorded, not executed, in this scope)

model Refund {
  id            String       @id @default(cuid())
  storeId       String
  orderId       String
  paymentId     String?      // ONLINE: the capture; null for CARD_TRANSFER / COD
  receiptId     String?      // CARD_TRANSFER: the approved receipt (traceability)
  amountToman   BigInt       // > 0 (CHECK); gateway captures convert rial -> toman (amountRial / 10)
  status        RefundStatus @default(PENDING)
  method        RefundMethod
  providerRef   String?      @db.VarChar(64)   // bank / gateway / receipt reference typed by the merchant
  reason        String       @db.VarChar(300)
  requestKey    String       @db.VarChar(64)   // idempotency key from the client
  createdById   String                         // the merchant user who recorded it
  completedById String?
  failureNote   String       @default("") @db.VarChar(300)
  createdAt     DateTime     @default(now())
  completedAt   DateTime?    // SUCCEEDED only (CHECK: status = SUCCEEDED <=> completedAt IS NOT NULL)
  failedAt      DateTime?    // FAILED only (same kind of CHECK)
  cancelledAt   DateTime?    // CANCELLED only (same kind of CHECK)
  updatedAt     DateTime     @updatedAt

  @@unique([storeId, requestKey])                      // idempotency
  @@index([storeId, status, completedAt])              // reports
  @@index([storeId, orderId, createdAt])
  // partial unique index (SQL): (storeId, method, providerRef) WHERE providerRef IS NOT NULL
  // CHECK: paymentId IS NULL OR receiptId IS NULL
}
```

Columns added to existing tables, both **counters used only to enforce the cap** (the reports never read them):

* `Payment.refundCommittedRial BigInt DEFAULT 0`, with CHECK `0 <= refundCommittedRial <= amountRial`.
* `Order.refundCommittedToman BigInt DEFAULT 0`, with CHECK `0 <= refundCommittedToman <= total`. Used for CARD_TRANSFER and COD captures only; it stays 0 for ONLINE orders.

### 2.3 Total refunds can never exceed the captured amount (question 3)

* "Committed" means PENDING plus SUCCEEDED. A pending refund reserves its amount, so two concurrent requests cannot oversubscribe a capture.
* Recording a refund runs in **one transaction**:
  1. A conditional update of the capture's counter, for example `UPDATE "Payment" SET "refundCommittedRial" = "refundCommittedRial" + :rial WHERE id = :p AND status IN ('PAID','REFUND_REQUIRED') AND "refundCommittedRial" + :rial <= "amountRial"`.
  2. If that updates 0 rows, the refund is refused (422) and nothing is written.
  3. Otherwise, insert the `Refund` row and the audit row.
* The database CHECK on the counter is the last line of defence. Even a buggy code path cannot store more than the capture.
* FAILED and CANCELLED release the amount: the counter is decremented in the same transaction as the status change.
* Preconditions, checked before the update:
  * ONLINE: the payment belongs to this order and store, and is PAID or REFUND_REQUIRED.
  * CARD_TRANSFER: an APPROVED receipt exists.
  * COD: the order is DELIVERED.

### 2.4 Refunds can never be deducted twice (question 4)

| Risk | Guard |
|---|---|
| A client retries the same request | `@@unique([storeId, requestKey])`: the retry returns the existing refund and writes nothing. |
| The same bank or gateway refund is recorded twice | Partial unique index on `(storeId, method, providerRef)`. |
| Two concurrent "mark succeeded" calls | The transition is a conditional update `… WHERE id = :r AND status = 'PENDING'`. Only one call changes a row; the other gets 409. SUCCEEDED, FAILED and CANCELLED are terminal. |
| A report counts one refund twice | Reports aggregate `Refund` rows (one row = one refund). The counters are never summed into a report. |
| Reserved twice | The counter is incremented only when the row is inserted, and decremented only on PENDING → FAILED/CANCELLED. Both happen in the same transaction as the row change. |

**Audit:** every change writes an `AuditEvent` in the same transaction (`order.refund_recorded`, `order.refund_succeeded`, `order.refund_failed`, `order.refund_cancelled`). Each event records the actor, `refundId`, amount and `providerRef`. No card numbers or buyer personal data are stored.

### 2.5 Accounting rules (question 5)

All amounts are in toman. "Revenue capture" means the capture behind an order that M2 counts as paid: an online PAID payment on a PLACED…DELIVERED order, an approved receipt on such an order, or a delivered COD order. Any other capture is an **excess capture**, which is owed back to the buyer:
* a REFUND_REQUIRED payment;
* a capture on an order that was later CANCELLED or EXPIRED.

| Metric | Rule |
|---|---|
| **Gross paid revenue** | Unchanged: the approved M2 rule, by order creation date. |
| **Refunds completed** | Sum of SUCCEEDED refunds. |
| **Net paid revenue** | Gross paid revenue − SUCCEEDED refunds **against revenue captures** (for example, a partial refund for a returned item on a delivered order). Refunds of excess captures do not reduce net revenue: that money was never revenue, so returning it only settles a debt. |
| **Pending refunds (owed to buyers)** | (a) PENDING refunds, plus (b) the uncommitted remainder of excess captures: REFUND_REQUIRED payments and captures on cancelled or expired orders, minus their committed refunds. |

**Date attribution (needs your decision, D-REF-1):**
* **Option A — order date (recommended):** net revenue for a period = gross for that period − refunds on that period's orders. This matches the approved M2 rule. A past period's net figure changes when a later refund completes.
* **Option B — completion date (cash basis):** history never changes, but a period's net figure can go negative.
* **My recommendation:** use Option A for net revenue, and also show "refunds completed in this period" by `completedAt`. Then both views are visible.

### 2.6 Cancelled orders with captured money stay in historical reports (question 6)

The approved gross-revenue rule stays as it is: cancelled orders are excluded. A separate line, by order creation date, shows them instead:

* **Captured on cancelled/expired orders:**
  * online: PAID and REFUND_REQUIRED payments on CANCELLED or EXPIRED orders;
  * card-to-card: an approved receipt on a CANCELLED order;
  * count and amount.
* Next to it: how much of that has been refunded (SUCCEEDED) and how much is still owed.

Money received and then returned thus stays visible in the period it was received, without changing the approved revenue rule. COD orders cannot be cancelled after DELIVERED, so they never appear here.

## 3. Migration impact

* **One expand-only migration.**
  * The name must sort after `20261203090000_g2_store_suspension`.
  * It adds `down.sql` and goes through the usual drill.
  * New enums `RefundStatus` and `RefundMethod`.
  * New table `Refund` with CHECKs and indexes:
    * a composite FK `(storeId, orderId)` to `Order`, cascading like `Payment`;
    * an FK from `paymentId` to `Payment`;
    * an FK from `receiptId` to `TransferReceipt`.
  * Two new BIGINT columns with `DEFAULT 0` and CHECKs. Adding a column with a constant default takes only a catalog update on PostgreSQL 16; no table rewrite.
* **No backfill:** no refunds exist yet, so every counter starts at 0, which is correct. Existing REFUND_REQUIRED payments simply appear as "owed to buyers".
* **No change** to the payment verify/reconcile code, order transitions, the M2 approved rules, or existing endpoints. The overview response gains fields; nothing is removed.
* **New permission:** `refunds.manage`. Which roles get it is your decision (D-REF-2). Recording a manual refund moves no money, so OWNER + MANAGER would work; calling a gateway refund API later should be OWNER-only, like `payout.manage` (D-3).

## 4. Estimated implementation scope (after approval; not M3)

| Step | Content | Estimate |
|---|---|---|
| R1 | Migration (+ down, drill), shared rules (caps, transitions, rial↔toman), unit tests | ~1 day |
| R2 | API: record a refund (idempotent), mark succeeded / failed / cancelled, list per order; audit; permission; DB tests (cap under concurrency, idempotency, duplicate provider reference, terminal states, roles, tenant isolation) | ~1.5 days |
| R3 | Overview: refunds completed, net paid revenue, pending refunds, captured-on-cancelled line; contract and OpenAPI; DB tests with mixed scenarios (full, several partials, failed, cancelled, duplicate capture) | ~1 day |
| R4 | Dashboard: a refunds panel on the order page (record, complete, fail, cancel) plus the new overview lines and wording; E2E | ~1–1.5 days |
| **Total** | | **~4.5–5 days** |

**Not included:** calling gateway refund APIs. The adapters have no refund call, and the providers' refund API terms have not been verified. That is a separate decision; `RefundMethod.GATEWAY` only records that the merchant refunded through the gateway panel.

## 5. Decisions needed

* **D-REF-1:** how refunds are dated: by order date, by completion date, or both (recommended: both, as described in §2.5).
* **D-REF-2:** which roles get `refunds.manage`.
* **D-REF-3:** may a merchant record a refund directly as SUCCEEDED (already done outside the system), or must every refund start as PENDING? Recommended: allow both. A direct SUCCEEDED requires `providerRef` (or method CASH) and a reason.
* **D-REF-4:** does "net paid revenue" replace "gross" as the dashboard's main figure, or sit next to it? Recommended: show both side by side.

Until these records exist, the dashboard shows **gross** figures only and says that completed refunds are not deducted (owner decision 2026-11-25).
