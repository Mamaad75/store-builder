# ADR 0006 — Refund records for financial reporting

**Status:** Revised proposal (2026-11-25). The core architecture is **approved** by the owner, as are D-REF-1 to D-REF-4. This revision
adds the owner's eight technical clarifications and is **awaiting review**. Nothing is implemented; no schema has changed.
**Scope:** *recording* refunds (made in-app as PENDING, or recorded after the fact as SUCCEEDED) and reporting gross revenue, refunds and
net revenue. **Out of scope:** calling any gateway's refund API, SUPER_ADMIN refunds, and M3.

## 1. Current system (inspected 2026-11-25)

| Concept | Where | Facts relevant to refunds |
|---|---|---|
| Order | `Order` | `total` (toman, BigInt; after discount, with shipping and COD fee), `status`, `paymentMethod` (COD / ONLINE / CARD_TRANSFER). There is no `deliveredAt`; the delivery time is the `OrderEvent` row with `toStatus = DELIVERED`. |
| Online payment attempt | `Payment` (one row = one gateway session; there is no separate `PaymentAttempt` model) | `amountRial`; status PAID or REFUND_REQUIRED always carries `refId` + `verifiedAt` (CHECK). The verify call sends the amount and only a success code is accepted. At most one PAID attempt places the order; later captures become REFUND_REQUIRED. |
| Card-to-card receipt | `TransferReceipt` | At most one APPROVED per order (partial unique index `TransferReceipt_one_approved_per_order`). **No amount column**: approval means the merchant checked the bank statement for the order total (`card-transfer.ts`). The database does not store how much arrived. |
| Cash on delivery | — | No capture record. Business assumption (approved M2 rule): DELIVERED means the courier collected `Order.total`. |
| Gateway adapters | `zarinpal.ts`, `aqayepardakht.ts` | `request` / `verify` / `inquiry` only. No refund call (and none is added). |
| Paid-then-cancelled | `canTransition` | MERCHANT can cancel from PLACED and CONFIRMED; CUSTOMER from PLACED. The UI tells the merchant to return the money outside the app; nothing records that. |
| Audit | `AuditEvent` (store audit log) | Used inside transactions elsewhere (ADR 0005, V0). |
| Immutability pattern | `sb_immutable_row()` / `sb_no_direct_delete()` triggers (phase 10, published versions) | The same approach is reused here. |
| Store deletion | soft (ADR 0003) | Nothing hard-deletes a store or its orders today. |

## 2. Approved owner decisions (2026-11-25)

* **D-REF-1:** net paid revenue is grouped by **order creation date**. "Refunds completed this period" is grouped by **refund completion date**. They are separate metrics with explicit labels.
* **D-REF-2:** **OWNER only.**
  * Managers and operators can never create, complete, fail, cancel or otherwise modify refunds.
  * SUPER_ADMIN cannot record refunds for a merchant. There is no platform route, and the store access guard gives platform admins no store access.
* **D-REF-3:** the owner may record a refund completed outside the app directly as SUCCEEDED, subject to the conditions in §6.
* **D-REF-4:** gross paid revenue, completed refunds and net paid revenue are displayed separately.

## 3. What a refund references, and the captured amount per method (clarification 3)

A refund returns money from exactly one **capture**: the record proving the store received the money. The cap is the captured amount.

| Method | Capture | Captured amount (the cap) | Basis |
|---|---|---|---|
| ONLINE | the `Payment` row with status PAID or REFUND_REQUIRED | `Payment.amountRial` (refunds in toman reserve `amountToman × 10` rial) | **Verified by the gateway**: the verify call carries the amount and only a success code is recorded. |
| CARD_TRANSFER | the APPROVED `TransferReceipt` | **New column `TransferReceipt.approvedAmountToman`**, written in the same transaction as the approval | The current model does **not** guarantee the received amount, so the order total is not silently assumed. From now on, approving records the confirmed amount; the approve dialog shows it. Partial payments are not supported, so approval is refused unless the amount equals `Order.total`. Existing approvals: see D-REF-5. |
| COD | the `Order` once it is DELIVERED | `Order.total` | **Explicit business assumption:** delivery means the courier collected the full order total. If cash was not actually collected, this record cannot show it. That is a known limitation, not something the system verifies. |

Every refund also stores `storeId` and `orderId`, with the composite FK to `Order` that `Payment` uses. The source FK depends on the method:
* ONLINE: `paymentId`;
* CARD_TRANSFER: `receiptId`;
* COD: neither.

A CHECK enforces at most one of `paymentId` and `receiptId`. The service checks that the order's method matches the source.

## 4. Data model (indicative Prisma; final SQL in the migration)

```prisma
enum RefundStatus  { PENDING SUCCEEDED FAILED CANCELLED }
enum RefundChannel { ZARINPAL AQAYEPARDAKHT BANK_TRANSFER CASH OTHER }   // how the money went back (recorded, never executed here)

model Refund {
  id                 String        @id @default(cuid())
  storeId            String
  orderId            String
  paymentId          String?       // ONLINE capture
  receiptId          String?       // CARD_TRANSFER capture
  amountToman        BigInt        // CHECK > 0
  status             RefundStatus
  channel            RefundChannel
  providerRef        String?       @db.VarChar(64)  // normalised (§7)
  details            String        @default("") @db.VarChar(500)  // required for CASH and OTHER (§6)
  reason             String        @db.VarChar(300)                // CHECK length(btrim(reason)) >= 3
  requestKey         String        @db.VarChar(64)                 // idempotency key
  external           Boolean       // true = recorded after the fact as SUCCEEDED (D-REF-3)
  createdById        String        // always the owner (D-REF-2)
  createdAt          DateTime      @default(now())
  completedAt        DateTime?     // ACTUAL completion date (business date, entered by the owner)
  completedById      String?
  completionRecordedAt DateTime?   // system time when SUCCEEDED was recorded
  failedAt           DateTime?
  cancelledAt        DateTime?
  failureNote        String        @default("") @db.VarChar(300)

  @@unique([storeId, requestKey])
  @@index([storeId, status, completedAt])
  @@index([storeId, orderId, createdAt])
}
```

Counter columns, used **only** for the cap (reports never read them):
* `Payment.refundCommittedRial BIGINT NOT NULL DEFAULT 0`, CHECK `0 <= x AND x <= "amountRial"`.
* `TransferReceipt.approvedAmountToman BIGINT NULL` and `TransferReceipt.refundCommittedToman BIGINT NOT NULL DEFAULT 0`:
  * CHECK `("status" = 'APPROVED') = ("approvedAmountToman" IS NOT NULL)`;
  * CHECK `0 <= "refundCommittedToman" AND "refundCommittedToman" <= COALESCE("approvedAmountToman", 0)`.
* `Order.codRefundCommittedToman BIGINT NOT NULL DEFAULT 0`, CHECK `0 <= x AND x <= "total"` and CHECK `"paymentMethod" = 'COD' OR x = 0`.

"Committed" means the sum of the capture's **PENDING + SUCCEEDED** refunds.

Row-level CHECKs on `Refund`:
* `amountToman > 0`;
* `num_nonnulls("paymentId","receiptId") <= 1`;
* the status determines the timestamps: SUCCEEDED requires `completedAt` and `completionRecordedAt`; FAILED requires `failedAt`; CANCELLED requires `cancelledAt`; PENDING has none of them;
* `external` implies status SUCCEEDED at insert (enforced by the insert path and the trigger in §9);
* `completedAt <= completionRecordedAt`;
* the channel rules from §6 (CASH or OTHER require non-empty `details`; gateway and bank channels require `providerRef`).

Foreign keys:
* `(storeId, orderId)` → `Order`, ON DELETE **RESTRICT**;
* `paymentId` → `Payment`, RESTRICT;
* `receiptId` → `TransferReceipt`, RESTRICT.

## 5. Concurrency and the cap: what the database enforces and what the transaction enforces (clarifications 1, 2, 7)

### 5.1 Row-level database constraints (single-row CHECK, unique indexes, triggers)
* A counter can never be negative or above the capture amount **on the same row** (CHECK).
* A refund row is internally consistent (amount, source, status timestamps, channel requirements).
* Uniqueness: idempotency key, provider reference (§7).
* Immutability and no deletion (§9).

**What a CHECK cannot do:** PostgreSQL CHECK constraints see only one row. They **cannot** enforce "the sum of PENDING + SUCCEEDED `Refund` rows ≤ the capture", and they cannot ensure the counter equals that sum. Those aggregate guarantees come from §5.2 and §5.3.

### 5.2 Transactional conditional update: the concurrency strategy
Every operation runs in **one** interactive transaction at PostgreSQL's default **READ COMMITTED** isolation:

```sql
-- reserve (create PENDING, or record external SUCCEEDED); ONLINE shown, CARD_TRANSFER and COD are the same shape
UPDATE "Payment"
   SET "refundCommittedRial" = "refundCommittedRial" + $rial
 WHERE "id" = $paymentId AND "storeId" = $storeId AND "orderId" = $orderId
   AND "status" IN ('PAID','REFUND_REQUIRED')
   AND "refundCommittedRial" + $rial <= "amountRial"
RETURNING "refundCommittedRial";
```

* **Zero rows → 422 `REFUND_EXCEEDS_CAPTURE`** (or `REFUND_NOT_ALLOWED` when the capture is not refundable). The transaction rolls back and nothing is written.
* **Why this is race-free without SERIALIZABLE or advisory locks:**
  1. `UPDATE` takes the row's exclusive lock.
  2. A concurrent transaction updating the **same capture** blocks until the first commits or rolls back.
  3. PostgreSQL then re-checks the `WHERE` clause against the **newly committed** row version (EvalPlanQual), so the second transaction sees the raised counter and fails the predicate if the cap would be exceeded.

  Refunds on different captures never contend.
* The `Refund` row and the `AuditEvent` row are inserted **after** the reservation, in the same transaction. Any failure (idempotency conflict, provider-reference conflict, CHECK) rolls back the reservation too.
* Release (PENDING → FAILED or CANCELLED) is a conditional update `… WHERE "id" = $refundId AND "status" = 'PENDING'` (exactly one row), followed by the counter decrement `… SET c = c - $amt WHERE … AND c - $amt >= 0`, followed by the audit row, all in one transaction.
* PENDING → SUCCEEDED changes no counter (the amount was already reserved). It is a conditional status update plus an audit row.

### 5.3 Aggregate invariant check (defence in depth)
* A `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` on `Refund` (insert and update) runs **at commit**.
* It recomputes `Σ amount of PENDING + SUCCEEDED` refunds for the affected capture and raises an exception if that differs from the capture's counter.
* This catches any future code path that writes a refund without moving the counter.
* At commit time the capture row is still locked by this transaction, so no concurrent change can interleave.
* A read-only reconciliation query listing captures whose counter ≠ Σ is part of the test suite and usable in operations.

### 5.4 Database concurrency tests (real PostgreSQL, parallel connections)
* Ten parallel 30 % refunds on one capture: exactly three succeed and seven get 422. The counter equals 90 % and equals the sum of committed rows.
* Ten parallel requests with the **same** idempotency key: one row and one reservation; all ten return the same refund.
* Parallel "succeed" and "cancel" on one PENDING refund: exactly one wins, the other gets 409. The counter is correct for the winner.
* An external SUCCEEDED racing a PENDING on one capture where only one fits: exactly one is written.
* The same provider reference recorded in parallel: one succeeds, the other gets 409, and no reservation leaks.
* Refunds on different captures in parallel: all succeed and the counters are independent.
* Invariant query is empty after every scenario. A direct SQL write of a `Refund` row without moving the counter fails at commit (deferred trigger).
* Direct SQL `UPDATE` of a terminal refund and `DELETE` of any refund fail (trigger).

## 6. Owner recording an externally completed refund as SUCCEEDED (D-REF-3 conditions)

| Condition | Rule |
|---|---|
| Required fields | `reason` (≥ 3 characters), `amountToman` (> 0), `channel`, and `completedAt` (the actual completion date). |
| Completion date | Must be ≥ the capture time and ≤ now. The capture time is `verifiedAt` (online), `reviewedAt` (card) or the DELIVERED event time (COD). It is stored separately from `completionRecordedAt` (system time). |
| Reference or details | ZARINPAL, AQAYEPARDAKHT and BANK_TRANSFER require `providerRef`. OTHER requires `details` (≥ 10 characters). |
| Cash | CASH requires `details` of at least 20 characters: who handed the cash, to whom, where. `providerRef` is optional. |
| Amount | Validated against the **remaining refundable amount, including PENDING reservations**: the same conditional reservation as §5.2. |
| Duplicates | Idempotency key (§8) and provider-reference uniqueness (§7). For CASH without a reference, only the idempotency key and a confirmation step guard against a second, different recording; that residual risk is visible in the audit log. |
| Audit | `order.refund_recorded_external` in the same transaction (§10). |

## 7. Provider-reference uniqueness (clarification 4)

* **Scope:** `(storeId, channel, providerRef)`. Bank tracking numbers are unique only within one bank's systems, and gateway references only within one merchant account. A store-wide, per-channel scope catches real duplicates without false clashes across stores.
* **Nullable behaviour:** partial unique index `… ON "Refund"("storeId","channel","providerRef") WHERE "providerRef" IS NOT NULL`. Refunds without a reference (allowed only for CASH and OTHER) never collide with one another.
* **Normalisation before storing:** trim; Persian and Arabic digits to ASCII; remove spaces and dashes; upper-case. So `۱۲۳-۴۵` and `12345` are the same reference.
* FAILED and CANCELLED rows keep their reference, so a retry carrying the same bank reference is refused (409 `REFUND_DUPLICATE_REFERENCE`). A failed attempt rarely has a valid bank reference; if a provider reuses one, the owner records the retry with the new reference. Decision D-REF-9 confirms this.

## 8. Idempotency and duplicate deductions

* `@@unique([storeId, requestKey])`. The client generates the key once per form submission.
  * A retry first finds the existing row and returns it.
  * If two retries race, the loser hits the unique violation, its whole transaction (including its reservation) rolls back, and it then reads and returns the winner's row.
* **Retries after failure are new refunds:** a FAILED or CANCELLED refund is never reopened (clarification 6). A retry is a new `Refund` row with a new key.
* Reports aggregate `Refund` rows only (one row = one refund). Counters are never added into reports.

## 9. Immutability and no deletion (clarifications 6 and 8)

* **Terminal states are final.** A `BEFORE UPDATE` trigger (`sb_refund_guard`) refuses:
  * any update when `OLD.status <> 'PENDING'`;
  * any change to `storeId`, `orderId`, `paymentId`, `receiptId`, `amountToman`, `channel`, `reason`, `details`, `requestKey`, `external`, `createdById` or `createdAt`;
  * any transition other than PENDING → SUCCEEDED, FAILED or CANCELLED.

  `providerRef` may only be filled in on the PENDING → SUCCEEDED transition, never changed afterwards.
* **No deletion:** a `BEFORE DELETE` trigger refuses every delete, including cascades. The source FKs are `ON DELETE RESTRICT`, so orders, payments and receipts with refunds cannot be deleted either. Stores are soft-deleted today. Any future hard purge must define financial-record retention explicitly; it cannot happen implicitly.
* **Corrections:** a completed refund recorded with a wrong amount cannot be edited. The correction is a documented follow-up decision (D-REF-10). The proposed approach is a new compensating record type in a later ADR, never an update.

## 10. Transactional consistency and audit (clarification 7)

| Operation | One transaction contains |
|---|---|
| Create PENDING | reservation `UPDATE` → `INSERT Refund` → `INSERT AuditEvent order.refund_created` |
| Record external SUCCEEDED | reservation `UPDATE` → `INSERT Refund (SUCCEEDED)` → `INSERT AuditEvent order.refund_recorded_external` |
| PENDING → SUCCEEDED | conditional status `UPDATE` (1 row) → `INSERT AuditEvent order.refund_succeeded` |
| PENDING → FAILED or CANCELLED | conditional status `UPDATE` (1 row) → counter decrement → `INSERT AuditEvent order.refund_failed` or `order.refund_cancelled` |
| Commit | the deferred invariant trigger (§5.3) |

* **Audit metadata:** `refundId`, `orderId`, capture type and id, `amountToman`, `channel`, `providerRef`, `external`, `completedAt`, and the status before and after.
* **Not in audit metadata:** free-text `details` (they may contain names; they stay on the immutable `Refund` row), buyer personal data, and card numbers.
* The actor is the owner's user id (D-REF-2).

## 11. Reporting rules (clarification 5; D-REF-1, D-REF-4)

Definitions, evaluated **at report time** from the current order status:
* **Revenue capture:** the capture behind an order that M2 counts as paid revenue:
  * online: the PAID payment of a PLACED…DELIVERED order;
  * card: the approved receipt of such an order;
  * COD: a DELIVERED order.
* **Excess capture:** any other capture. Money owed back to the buyer:
  * every REFUND_REQUIRED payment;
  * a PAID payment or approved receipt on an order that is now CANCELLED or EXPIRED.

### 11.1 Revenue (by order creation date, Tehran days; D-REF-1)

| Metric | Rule |
|---|---|
| Gross paid revenue | Unchanged: the approved M2 rule. |
| Refunds on these orders | Σ SUCCEEDED refunds against **revenue captures** of orders created in the period. |
| Net paid revenue | Gross paid revenue − refunds on these orders. |

* Gross, refunds and net are shown side by side (D-REF-4).
* Refunds of excess captures never reduce net revenue: that money was never revenue.
* A past period's net figure changes when a later refund completes, as D-REF-1 implies.

### 11.2 Refunds completed this period (by `completedAt`, Tehran days; D-REF-1)
* Σ of **all** SUCCEEDED refunds whose actual completion date falls in the period, on revenue and excess captures alike. This is the cash-out view.
* It is labelled differently from 11.1 so the two refund figures cannot be confused.

### 11.3 Money owed to buyers: three mutually exclusive buckets
For every capture, its amount splits **exactly** into: SUCCEEDED refunds + PENDING refunds + untouched remainder (the counter CHECK guarantees the remainder ≥ 0).

| Bucket | Rule |
|---|---|
| A. Refunds in progress | Σ PENDING refunds (revenue and excess captures). |
| B. Owed, no refund started | Σ over **excess** captures of (amount − SUCCEEDED − PENDING). |
| C. Refunded | Σ SUCCEEDED refunds. |

* A, B and C are disjoint by construction: each toman of a capture lies in exactly one of them, or, for a revenue capture's untouched remainder, in revenue.
* A DB test checks, for every excess capture, that `amount = its part of A + its part of B + its part of C`.

### 11.4 Cancelled or expired orders with captured money (historical view)
* A separate line, by order creation date: "captured on cancelled/expired orders", with count and amount.
* It is shown **as a breakdown** into its own refunded, in-progress and owed parts.
* It is **never** added to buckets A, B or C, which already contain that money. The approved gross-revenue rule is unchanged (cancelled orders are still excluded from gross). The money in and the money out stay visible in the period the order was placed.

## 12. Permissions and access

* **New permission `refunds.manage`:** OWNER only. `ROLE_PERMISSIONS.MANAGER` excludes it explicitly, and OPERATOR never has it. Tests cover MANAGER and OPERATOR refused (403) on every refund write route, a stranger getting 404, and a SUPER_ADMIN with no membership getting 404.
* **Reading refunds:** proposed under `orders.view` (owner and manager, read-only). See D-REF-7.
* **Store suspension:** refund writes while a store is platform-suspended. See D-REF-6.

## 13. Migration impact

**One expand-only migration** (its name must sort after `20261203090000_g2_store_suspension`; `down.sql`; drill):
* enums `RefundStatus` and `RefundChannel`;
* table `Refund` with its CHECKs, indexes, partial unique index and RESTRICT FKs;
* the counter columns (`DEFAULT 0`: catalog-only on PostgreSQL 16) and their CHECKs;
* `TransferReceipt.approvedAmountToman`, with a **backfill** of existing APPROVED rows (D-REF-5);
* triggers: refund guard, no delete, and the deferred invariant check.

**Code outside the new module:**
* Approving a card-to-card receipt writes `approvedAmountToman` (`= Order.total`) in its existing transaction, and the approve dialog shows the amount being confirmed.
* No change to online verify and reconcile, order transitions, or the approved M2 rules.

**No existing data is rewritten** except the backfill in D-REF-5.

## 14. Implementation scope (estimate, after approval)

| Step | Content | Estimate |
|---|---|---|
| R1 | Migration (triggers, CHECKs, backfill, `down.sql`, drill); shared rules (caps, channel requirements, reference normalisation, dates, bucket maths) with unit tests | ~1.5 days |
| R2 | API: create PENDING, record external SUCCEEDED, succeed, fail, cancel, list per order; audit; `refunds.manage`; card approval amount. DB tests: §5.4 concurrency, idempotency, terminal immutability, no delete, roles, tenant isolation | ~2 days |
| R3 | Overview: §11.1–11.4 metrics; contract and OpenAPI; DB tests with full, multiple-partial, failed, cancelled, duplicate-capture and cancelled-after-payment scenarios | ~1 day |
| R4 | Dashboard: owner-only refund panel on the order page; overview figures (gross, refunds, net; completed this period; owed buckets); E2E | ~1.5 days |
| **Total** | | **~6 days** (was 4.5–5; the clarifications add triggers, concurrency tests and the card amount) |

## 15. Decisions still needed before implementation

* **D-REF-5:** captured amount for **existing** approved card-to-card receipts (the model never stored it).
  * Recommended: backfill `approvedAmountToman = Order.total`, marking these rows as backfilled. The approval rule required checking the bank statement for the exact total.
  * Alternative: no in-app refunds for card orders approved before the migration.
* **D-REF-6:** may the owner record refunds while the store is **platform-suspended**? Recommended: yes (extend the ADR 0003 allowlist), because buyers may be owed money.
* **D-REF-7:** may **managers read** refund records (no writes)? Recommended: yes, under `orders.view`.
* **D-REF-8:** **backdating** `completedAt` changes past "refunds completed this period" figures. Recommended: allow within [capture time, now], audited, with no further limit.
* **D-REF-9:** a reference used on a FAILED or CANCELLED refund stays reserved (§7). Recommended: yes.
* **D-REF-10:** corrections to a completed refund. Recommended: defer to a later ADR (compensating record); until then, wrong entries stay visible and audited.

Until refund records exist, the dashboard shows **gross** paid revenue only and states that completed refunds are not deducted (owner decision 2026-11-25).
