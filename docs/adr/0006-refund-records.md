# ADR 0006 — Refund records for financial reporting

**Status:** Revision 3 (2026-11-25), awaiting final review before implementation. The core architecture and D-REF-1 to D-REF-9 are
**approved**. D-REF-10 (corrections) was **not** approved as a deferral; this revision proposes the adjustment mechanism the owner asked for.
Nothing is implemented; no schema has changed.
**Scope:** *recording* refunds and corrections, and reporting gross revenue, refunds and net revenue. **Out of scope:** any gateway refund
API, SUPER_ADMIN refunds, a general ledger, and M3.

## 1. Current system (inspected 2026-11-25)

| Concept | Where | Facts relevant to refunds |
|---|---|---|
| Order | `Order` | `total` (toman, BigInt; after discount, with shipping and COD fee), `status`, `paymentMethod` (COD / ONLINE / CARD_TRANSFER). The delivery time is the `OrderEvent` with `toStatus = DELIVERED`. |
| Online payment attempt | `Payment` (one row = one gateway session; there is no `PaymentAttempt` model) | `amountRial`. Status PAID or REFUND_REQUIRED always carries `refId` and `verifiedAt` (CHECK). The verify call sends the amount; only success codes are recorded. Later captures on a paid, expired or cancelled order become REFUND_REQUIRED. |
| Card-to-card receipt | `TransferReceipt` | At most one APPROVED per order (partial unique index). **No amount column.** |
| Cash on delivery | — | No capture record. |
| Gateway adapters | `zarinpal.ts`, `aqayepardakht.ts` | `request` / `verify` / `inquiry` only; no refund call is added. |
| Paid-then-cancelled | `canTransition` | MERCHANT can cancel from PLACED or CONFIRMED; CUSTOMER from PLACED. |
| Audit | `AuditEvent` | Written inside transactions elsewhere. |
| Immutability | `sb_immutable_row()` / `sb_no_direct_delete()` (phase 10) | The same trigger approach is reused here. |
| Store deletion | soft (ADR 0003) | Nothing hard-deletes stores or orders. |
| Store suspension | `AccessService` | While suspended, GET is allowed and the only allowed write is `orders.manage`. |

## 2. Owner decisions (2026-11-25)

| # | Decision |
|---|---|
| D-REF-1 | Net paid revenue is grouped by **order creation date**. "Refunds completed this period" is grouped by **refund completion date**. They are separate metrics with explicit labels. |
| D-REF-2 | Refund **writes are OWNER only**. Managers and operators can never create, complete, fail, cancel or adjust refunds. SUPER_ADMIN cannot act for a merchant. |
| D-REF-3 | The owner may record a refund completed outside the app directly as SUCCEEDED, under the conditions in §7. |
| D-REF-4 | Gross paid revenue, completed refunds and net paid revenue are displayed separately. |
| D-REF-5 | Existing approved card-to-card receipts get `approvedAmountToman = Order.total` with provenance **`LEGACY_BACKFILL`**. New approvals record **`EXPLICIT_APPROVAL`**. Backfilled amounts are never presented as explicitly recorded. |
| D-REF-6 | The owner may create and manage refunds **while the store is suspended**. This is a narrow exception for the refund routes only; no other restricted store or payment-management operation is re-enabled. |
| D-REF-7 | OWNER: read and write. MANAGER: **read-only**. OPERATOR: no access. SUPER_ADMIN: no creation or modification. All enforced server-side. |
| D-REF-8 | `completedAt` (actual refund time) may be backdated to any time between the capture time and now. `createdAt` (when the record was entered) is set by the database and never changes. Both are audited. |
| D-REF-9 | A provider reference stays reserved after FAILED or CANCELLED. A retry is a new refund and cannot reuse a reserved reference. |
| D-REF-10 | Completed refunds stay immutable. Corrections go through a separate, auditable **adjustment** (§10), proposed here for approval. |

## 3. Capture and captured amount per method

A refund returns money from exactly one **capture**. The capture row also carries the counter and is the **lock** for every refund operation on it (§5).

| Method | Capture row (lock + counter) | Captured amount (cap) | Basis |
|---|---|---|---|
| ONLINE | `Payment` with status PAID or REFUND_REQUIRED | `amountRial` (refunds reserve `toman × 10`) | Verified by the gateway at verify time. |
| CARD_TRANSFER | the APPROVED `TransferReceipt` | `approvedAmountToman` | **New column.** `EXPLICIT_APPROVAL`: written in the approval transaction and required to equal `Order.total` (partial payments are not supported). `LEGACY_BACKFILL`: approvals made before the migration, filled from `Order.total` (D-REF-5). |
| COD | the `Order` once DELIVERED | `total` | **Documented business assumption:** delivery means the courier collected the full total. The system cannot verify the cash. |

## 4. Data model (indicative Prisma; final SQL in the migration)

```prisma
enum RefundStatus        { PENDING SUCCEEDED FAILED CANCELLED }
enum RefundChannel       { ZARINPAL AQAYEPARDAKHT BANK_TRANSFER CASH OTHER }
enum ReceiptAmountSource { EXPLICIT_APPROVAL LEGACY_BACKFILL }

model Refund {
  id                   String        @id @default(cuid())
  storeId              String
  orderId              String
  paymentId            String?       // ONLINE capture
  receiptId            String?       // CARD_TRANSFER capture
  amountToman          BigInt        // CHECK > 0 (the amount as originally recorded; never changes)
  status               RefundStatus
  channel              RefundChannel
  providerRef          String?       @db.VarChar(64)
  details              String        @default("") @db.VarChar(500)
  reason               String        @db.VarChar(300)
  requestKey           String        @db.VarChar(64)
  external             Boolean
  createdById          String
  createdAt            DateTime      @default(now())   // entry time (D-REF-8): never changes
  completedAt          DateTime?     // actual completion time (may be backdated, D-REF-8)
  completedById        String?
  completionRecordedAt DateTime?     // system time when SUCCEEDED was recorded
  failedAt             DateTime?
  cancelledAt          DateTime?
  failureNote          String        @default("") @db.VarChar(300)

  @@unique([storeId, requestKey])
  @@index([storeId, status, completedAt])
  @@index([storeId, orderId, createdAt])
}

model RefundAdjustment {             // §10 — insert-only correction of a SUCCEEDED refund
  id           String   @id @default(cuid())
  storeId      String
  orderId      String
  refundId     String                // the original refund (FK RESTRICT)
  deltaToman   BigInt                // CHECK <> 0; negative = refunded less than recorded (or void), positive = more
  reason       String   @db.VarChar(300)   // CHECK length(btrim(reason)) >= 10
  requestKey   String   @db.VarChar(64)
  createdById  String                // the owner
  createdAt    DateTime @default(now())

  @@unique([storeId, requestKey])
  @@index([storeId, refundId, createdAt])
}
```

**Capture counters** (cap enforcement only; reports never read them). Each counter is checked on its own row:

| Column | CHECK |
|---|---|
| `Payment.refundCommittedRial` (default 0) | `0 <= x <= amountRial` |
| `TransferReceipt.approvedAmountToman` (nullable) | non-null exactly when `status = 'APPROVED'` |
| `TransferReceipt.approvedAmountSource` (nullable) | non-null exactly when `status = 'APPROVED'` |
| `TransferReceipt.refundCommittedToman` (default 0) | `0 <= x <= COALESCE(approvedAmountToman, 0)` |
| `Order.codRefundCommittedToman` (default 0) | `0 <= x <= total`, and `paymentMethod = 'COD' OR x = 0` |

**Definitions:**
* **Effective amount** of a refund = `amountToman + Σ deltaToman` of its adjustments. Only SUCCEEDED refunds have adjustments.
* **Committed** on a capture = Σ `amountToman` of its PENDING refunds + Σ **effective** amount of its SUCCEEDED refunds.
* **Invariant (§6):** every capture's counter equals its committed amount, and every SUCCEEDED refund's effective amount is ≥ 0.

**Row-level CHECKs on `Refund`:**
* `amountToman > 0`;
* `num_nonnulls(paymentId, receiptId) <= 1`;
* each status has its matching timestamps;
* `completedAt <= completionRecordedAt`;
* the channel requirements in §7.

**Foreign keys:** every FK to `Order`, `Payment`, `TransferReceipt` and `Refund` is `ON DELETE RESTRICT`.

## 5. Every path serializes on the same capture-row lock (requirement 1)

**Rules:**
* Each refund and adjustment belongs to exactly **one** capture row.
* Every write operation **first** takes that row's lock, then touches the refund or adjustment row, then writes the audit row, **in that order, in one transaction** (PostgreSQL default READ COMMITTED).
* All operations take locks in the same order (capture row → refund row) and touch a single capture, so they cannot deadlock with each other.

| Operation | 1. capture-row lock (taken by) | 2. refund / adjustment row | 3. audit |
|---|---|---|---|
| Create PENDING | `UPDATE capture SET counter = counter + amt WHERE … AND counter + amt <= cap` (0 rows → 422) | `INSERT Refund (PENDING)` | `order.refund_created` |
| Record external SUCCEEDED (D-REF-3) | same conditional `UPDATE` | `INSERT Refund (SUCCEEDED, external)` | `order.refund_recorded_external` |
| PENDING → SUCCEEDED | `SELECT … FROM capture WHERE id = … FOR UPDATE` (no counter change: the amount is already reserved) | `UPDATE Refund … WHERE id = … AND status = 'PENDING'` (exactly 1 row, else 409) | `order.refund_succeeded` |
| PENDING → FAILED or CANCELLED | `UPDATE capture SET counter = counter - amt WHERE … AND counter - amt >= 0` | `UPDATE Refund … WHERE status = 'PENDING'` (1 row, else the transaction rolls back) | `order.refund_failed` / `order.refund_cancelled` |
| Adjustment (§10) | `UPDATE capture SET counter = counter + delta WHERE … AND counter + delta BETWEEN 0 AND cap` | `SELECT … FROM Refund WHERE id = … AND status = 'SUCCEEDED' FOR UPDATE`; check that effective + delta ≥ 0; `INSERT RefundAdjustment` | `order.refund_adjusted` |

**Why concurrent operations on one capture are correct:**
1. The first `UPDATE` (or `SELECT … FOR UPDATE`) holds the capture row's lock until commit. A second transaction on the **same** capture blocks there.
2. When the first commits, PostgreSQL re-evaluates the second transaction's `WHERE` clause against the **new** row version (EvalPlanQual). The second transaction therefore sees the updated counter and fails the cap predicate if it would overflow.
3. Status transitions are conditional on `status = 'PENDING'`, so exactly one of "succeed / fail / cancel" wins. The others match 0 rows and get 409.

No SERIALIZABLE isolation and no advisory locks are needed. Refunds on different captures never contend.

## 6. The deferred invariant check under concurrency (requirement 2)

**What a CHECK cannot do:** PostgreSQL CHECKs see one row. They cannot compare a counter with the **sum** of related `Refund` and `RefundAdjustment` rows. The cap is enforced by §5. The aggregate invariant is verified by:

* **`CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED`**, fired **at commit**:
  * on `Refund` (insert/update) and `RefundAdjustment` (insert);
  * on the counter columns `Payment.refundCommittedRial`, `TransferReceipt.refundCommittedToman` and `Order.codRefundCommittedToman` (`AFTER UPDATE OF <column>`, so other updates to those tables pay nothing).
* **What it does:** recomputes the committed amount of the affected capture from `Refund` and `RefundAdjustment`, and checks that every SUCCEEDED refund's effective amount is ≥ 0. On any mismatch it raises, and the whole transaction rolls back.
* **Why it stays correct with concurrent transactions:**
  * The trigger runs inside the committing transaction, while that transaction **still holds the capture-row lock**. No other compliant transaction can change that capture's refunds in between, because it would first need the same lock (§5).
  * Under READ COMMITTED, the trigger's query sees this transaction's own writes plus everything already committed. That is exactly the state that becomes visible at commit.
  * A non-compliant path (a refund row written without the counter, or a counter moved without a refund row) is caught **in its own transaction**: its trigger sees counter ≠ Σ and aborts it.
* **Concurrency tests (real PostgreSQL, parallel connections):**
  * ten parallel 30 % refunds on one capture → exactly three commit;
  * parallel adjustments that together would exceed the cap or push an effective amount below 0 → only the fitting ones commit;
  * a refund and an adjustment racing on the same capture;
  * succeed versus cancel versus fail on one PENDING refund → exactly one wins;
  * same idempotency key ×10 → one row;
  * same provider reference in parallel → one row, and no reservation leaks;
  * different captures in parallel → no blocking;
  * after every scenario the reconciliation query (counter ≠ Σ) returns nothing;
  * a raw SQL write that bypasses the counter fails at commit;
  * raw SQL `UPDATE` and `DELETE` of terminal refunds and of adjustments fail.

## 7. Recording an externally completed refund (D-REF-3)

| Condition | Rule |
|---|---|
| Required fields | `reason` (≥ 3 characters), `amountToman` (> 0), `channel`, `completedAt` |
| `completedAt` | ≥ capture time and ≤ now (D-REF-8). The capture time is `verifiedAt` (online), `reviewedAt` (card) or the DELIVERED event time (COD). `createdAt` is the database's own entry time and is never set by the client. |
| Reference / details | ZARINPAL, AQAYEPARDAKHT and BANK_TRANSFER require `providerRef`. OTHER requires `details` (≥ 10 characters). CASH requires `details` (≥ 20 characters: who handed over the cash, to whom, where); `providerRef` is optional. |
| Amount | Validated against the remaining capture, **including PENDING reservations**: the same conditional `UPDATE` as §5. |
| Duplicates | Idempotency key and provider-reference uniqueness (§8). |
| Audit | `order.refund_recorded_external`, with `completedAt`, `createdAt` and the backdating gap. |

## 8. Provider-reference uniqueness and idempotency (D-REF-9)

* **Scope and nulls:** partial unique index `("storeId", "channel", "providerRef") WHERE "providerRef" IS NOT NULL`. Refunds without a reference never collide with each other.
* **Normalisation:** trim, Persian and Arabic digits → ASCII, remove spaces and dashes, upper-case.
* **Reserved forever:** the index covers every status, including FAILED and CANCELLED. Retrying with a reserved reference gets 409 `REFUND_DUPLICATE_REFERENCE`; a retry is always a new refund with a new reference (or, for CASH, a description).
* **Idempotency:** `@@unique([storeId, requestKey])` on both tables. A retry returns the existing row. If two retries race, the loser's whole transaction (including its reservation) rolls back, and it then returns the winner's row.
* **Residual risk:** two *different* CASH entries without a reference, made with different keys, cannot be told apart automatically. The audit log and the order page show both.

## 9. Immutability and no deletion

* **`Refund`:** a `BEFORE UPDATE` trigger refuses:
  * any update when `OLD.status <> 'PENDING'`;
  * any change to the identity, money or entry fields (`storeId`, `orderId`, `paymentId`, `receiptId`, `amountToman`, `channel`, `reason`, `details`, `requestKey`, `external`, `createdById`, `createdAt`);
  * any transition other than PENDING → SUCCEEDED, FAILED or CANCELLED.

  `providerRef` may only be filled on the transition to SUCCEEDED.
* **`RefundAdjustment`:** insert-only. A `BEFORE UPDATE` trigger refuses every update.
* **No deletion on either table:** a `BEFORE DELETE` trigger refuses every delete, including cascades. The RESTRICT FKs stop deletion of the orders, payments and receipts they reference. Any future hard purge of a store must define financial-record retention explicitly.
* **Retries:** a FAILED or CANCELLED refund is never reopened. A retry is a new refund.

## 10. Corrections: refund adjustments (D-REF-10, proposed)

The smallest safe mechanism: **one insert-only table of signed corrections**, each pointing at one SUCCEEDED refund. There are no new account types and no ledger.

| Requirement | How it is met |
|---|---|
| References the original refund | `refundId` (FK RESTRICT). Only a SUCCEEDED refund can be adjusted. A PENDING refund is cancelled and re-created instead, and FAILED or CANCELLED refunds have no financial effect to correct. |
| Reason and author | `reason` (≥ 10 characters), `createdById` (OWNER only, D-REF-2), `createdAt` (database time). |
| Original record and its audit preserved | The `Refund` row is never updated. Its audit rows are untouched. The adjustment adds its own row and its own audit event `order.refund_adjusted` (`refundId`, `delta`, effective amount before and after, reason). |
| Affects accounting exactly once | Reports use the **effective amount** (`amount + Σ deltas`), so each adjustment row is summed once. The idempotency key prevents duplicate submissions, and adjustments can never be edited or deleted. |
| Cannot break the cap or create double accounting (requirement 3) | A positive delta must fit the capture's remaining amount, through the same conditional counter `UPDATE` under the same capture lock (§5). A negative delta cannot push the effective amount below 0 (checked under the refund-row lock, and again by the deferred trigger). The counter moves by exactly the delta, in the same transaction. |
| No arbitrary edits | Only the amount can be corrected. **Voiding** a refund that never happened is an adjustment of −(effective amount): it releases the cap. A wrong date, channel or reference is **not** edited. The owner voids and records a new, correct refund, so both the error and the fix stay visible. |

* **Reporting date of a correction:** an adjustment **restates the original refund**. It counts in the period of the original refund's order date (net revenue, D-REF-1) and of its original `completedAt` (refunds completed this period).
* **Visibility:** the dashboard marks figures that include corrections. The order page lists each refund with its corrections in chronological order.

## 11. Reporting rules

**Definitions** (evaluated at report time from the current order status):
* **Revenue capture:** the capture behind an order counted in gross paid revenue (M2 rule).
* **Excess capture:** any other capture: REFUND_REQUIRED payments, or captures on orders that are now CANCELLED or EXPIRED.

**Revenue metrics** (by order creation date, Tehran days; D-REF-1, D-REF-4):

| Metric | Rule |
|---|---|
| Gross paid revenue | Unchanged (M2). |
| Refunds on these orders | Σ effective amount of SUCCEEDED refunds on **revenue captures** of orders created in the period. |
| Net paid revenue | Gross − refunds on these orders. |

**Refunds completed this period** (by `completedAt`): Σ effective amount of **all** SUCCEEDED refunds completed in the period. This is the cash-out view, labelled differently from the revenue metrics.

**Money owed to buyers: three mutually exclusive buckets.** Each capture's amount splits exactly into SUCCEEDED effective + PENDING + untouched remainder (≥ 0 by the counter CHECK).

| Bucket | Rule |
|---|---|
| A. Refunds in progress | Σ PENDING amounts. |
| B. Owed, no refund started | Σ untouched remainder of **excess** captures. |
| C. Refunded | Σ SUCCEEDED effective amounts. |

A revenue capture's untouched remainder is revenue, not owed money. DB tests check `amount = A part + B part + C part` for every excess capture.

**No double counting of cancelled or expired captures (requirement 4):**
* Gross, and therefore net, already **exclude** CANCELLED and EXPIRED orders.
* Refunds on their captures are **excess-capture refunds**: they appear in "refunds completed this period" and in bucket C, but **never** reduce net.
* Their untouched remainder appears **only** in bucket B. Their PENDING refunds appear **only** in bucket A.
* The historical line "captured on cancelled/expired orders" (by order date) is shown as a **breakdown** into its A/B/C parts and is never added to A, B, C or net.

Worked example: a 100-toman online order is paid, then cancelled; 60 has been refunded and 40 is still pending.

| Figure | Value |
|---|---|
| Gross | 0 |
| Net | 0 |
| A (in progress) | 40 |
| B (owed, not started) | 0 |
| C (refunded) | 60 |
| Historical line | captured 100 = refunded 60 + in progress 40 + owed 0 |

**Backfilled card amounts are distinguishable (requirement 5):**
* `approvedAmountSource` is on the receipt.
* The order page labels such a capture «مبلغ از جمع سفارش برداشته شده (تأیید پیش از ثبت مبلغ)».
* Refund API responses carry the capture's amount source.
* The overview shows how much of the captured and refunded totals rests on `LEGACY_BACKFILL` amounts, when it is non-zero.
* The migration writes one audit event per backfilled receipt (`receipt.approved_amount_backfilled`: actor null, `orderId`, amount, source).
* New approvals write `EXPLICIT_APPROVAL` and the amount into the existing approval audit event.

## 12. Permissions and suspension (D-REF-2, D-REF-6, D-REF-7)

* **New permissions:**
  * `refunds.view`: OWNER and MANAGER;
  * `refunds.manage`: OWNER only;
  * OPERATOR has neither.

  SUPER_ADMIN gets no platform refund route, and the store access guard gives platform admins no store access.
* **Suspension exception:** the allowlist is extended by **`refunds.manage` only** (alongside the existing `orders.manage`). Tests:
  * a suspended store's owner can create, complete, fail, cancel and adjust refunds;
  * the same owner still gets 403 `STORE_SUSPENDED` on other writes: bank cards, payment settings, products, publishing, secrets.
* **Role tests:**
  * MANAGER: refunds read 200, every write 403;
  * OPERATOR: read and write 403;
  * other store's owner: 404;
  * SUPER_ADMIN without membership: 404.

## 13. Exact migration impact

One expand-only migration, named after `20261203090000_g2_store_suspension`, with `down.sql` and a drill. Steps, in order:

1. **Enums:** `RefundStatus`, `RefundChannel`, `ReceiptAmountSource`.
2. **New columns** (constant defaults, so catalog-only on PostgreSQL 16; no table rewrite):
   * `Payment.refundCommittedRial`;
   * `TransferReceipt.approvedAmountToman`, `approvedAmountSource`, `refundCommittedToman`;
   * `Order.codRefundCommittedToman`.
3. **Backfill**, inside the migration transaction:
   * `UPDATE "TransferReceipt" r SET "approvedAmountToman" = o."total", "approvedAmountSource" = 'LEGACY_BACKFILL' FROM "Order" o WHERE r."status" = 'APPROVED' AND o."storeId" = r."storeId" AND o."id" = r."orderId"`;
   * one `INSERT` into `"AuditEvent"` per backfilled receipt.
4. **CHECKs on the new columns**, added `NOT VALID` and then `VALIDATE`d, so the scan happens under a lighter lock.
5. **New tables** `Refund` and `RefundAdjustment`, with their CHECKs, RESTRICT FKs and indexes:
   * the two idempotency unique indexes;
   * the partial unique index on the provider reference;
   * the report and order indexes.
6. **Triggers:**
   * `Refund` update guard;
   * `RefundAdjustment` no-update;
   * no-delete on both tables;
   * deferred invariant constraint triggers on `Refund`, `RefundAdjustment` and the three counter columns.
7. **`down.sql`:**
   * refuses to run (RAISE) if any `Refund` or `RefundAdjustment` row exists, so a rollback can never silently drop financial records;
   * otherwise drops everything above in reverse order.

**Existing code that changes:**
* Card-to-card approval writes `approvedAmountToman = Order.total` and `EXPLICIT_APPROVAL` in its existing transaction, and the dialog shows the amount.
* The access permission table and the suspension allowlist (§12).

No change to online verify and reconcile, order transitions, or the approved M2 rules.

## 14. Unresolved technical risks

| Risk | Status |
|---|---|
| COD collection is assumed at DELIVERED; cash actually collected is never verified | Accepted assumption; documented in the UI and here |
| `LEGACY_BACKFILL` card amounts rest on the approval rule ("check the bank statement for the total"), not on a stored figure | Flagged in data, reports and audit (§11) |
| Duplicate CASH entries without a reference, made with different idempotency keys | Not detectable automatically; visible on the order page and in audit |
| Restatement: backdated `completedAt` and adjustments change past periods' figures; there is no period close | Accepted for this version; audited; a period lock would be a future decision |
| Refunds are recorded, not verified with the provider (no gateway refund API) | Out of scope by decision |
| The deferred invariant check raises at COMMIT, where Prisma surfaces a generic error | It fires only on a programming error; mapped to 500 and logged |
| Migration `CHECK … VALIDATE` scans `Order`, `Payment` and `TransferReceipt` | Negligible at pilot data sizes; `NOT VALID` + `VALIDATE` keeps the lock light |

## 15. Implementation scope (estimate, after approval)

| Step | Content | Estimate |
|---|---|---|
| R1 | Migration (counters, backfill and audit, tables, triggers, guarded `down.sql`, drill); shared rules (caps, channels, normalisation, dates, effective amounts, buckets) with unit tests | ~2 days |
| R2 | API: refunds (create, external, succeed, fail, cancel, list) and adjustments; audit; `refunds.view` / `refunds.manage`; suspension exception; card approval amount. DB tests: §6 concurrency, idempotency, immutability, roles, suspension, isolation | ~2.5 days |
| R3 | Overview: gross, refunds on these orders, net; completed this period; buckets A/B/C; cancelled breakdown; legacy-backfill share; contract and OpenAPI; DB tests | ~1 day |
| R4 | Dashboard: owner refund and adjustment panel on the order page (manager read-only); overview figures; E2E | ~1.5 days |
| **Total** | | **~7 days** |

Until refund records exist, the dashboard shows **gross** paid revenue only and states that completed refunds are not deducted.
