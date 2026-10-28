# Quality of Life (QoL) Improvements & On-the-Spot Payment System
**Comprehensive Development Changelog & Architecture Guide**
*Date: October 28, 2026*

---

## Executive Summary
This document provides a complete, granular record of all Quality of Life (QoL) improvements, business logic refinements, accounting enhancements, and safety guardrails implemented during this development session.

Key areas of improvement:
1. **Mine Ledger & Inventory Tagging / Supplier Filtering**
2. **Multi-Material Purchase Order (PO) Creation & Dispatch Integration**
3. **PO Material Locking for Active Dispatches**
4. **Material Settings Safe Management & Usage Badging**
5. **PO Target Tonnage Validation with Native iOS Liquid Glass Modal**
6. **On-the-Spot Payment Recording for Truck Dispatches & Inward Deliveries**
7. **Linked Payment Protection, Receipt Adjustments, and Direct Navigation**

---

## 1. Mine Ledger & Inventory Tagging / Supplier Filtering

### Context & Problem
- In [src/pages/Inventory.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/Inventory.tsx), mines were previously displaying a generic `"Supplier"` tag rather than their dedicated `"Direct Mine"` badge.
- In [src/pages/MineLedger.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/MineLedger.tsx), when recording an inward stock delivery, the supplier dropdown listed all suppliers—including other direct mines. In real-world factory logistics, Mine A's owner cannot supply coal extracted from Mine B.

### What Was Built
1. **Inventory Page Tagging**:
   - Differentiated mines from third-party suppliers using `isDirectMine` and `linkedMineId` flags.
   - Applied the distinct iOS purple `"Direct Mine"` badge to mine entries in inventory and stock breakdowns.
2. **Mine Inward Supplier Filter**:
   - Filtered the supplier selection dropdown in the Mine Ledger inward sheet to only display:
     - Regular third-party suppliers, and
     - The current specific mine itself.
   - Completely excluded other mines to ensure strict supply-chain data integrity.

---

## 2. Multi-Material Purchase Order (PO) Support

### Context & Problem
- In [src/pages/PartyLedger.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/PartyLedger.tsx), contract purchase orders could previously only be created for Coal, even though the application natively supports custom materials (Laterite, Bauxite, Iron Ore, etc.).

### What Was Built
1. **Material Selector in PO Form**:
   - Added an iOS material selector dropdown in the Create/Edit PO modal in [src/pages/PartyLedger.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/PartyLedger.tsx).
   - Saved `materialId` (and `materialName`) directly on the `PurchaseOrder` record.
2. **Dispatch Form Material Inheritance**:
   - When a buyer dispatch selects a PO in [src/pages/DispatchForm.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/DispatchForm.tsx), it automatically inherits the PO's designated material, loading the matching pricing model (e.g. flat rate, pro-rata GCV, or purity percentage).

---

## 3. PO Material Locking on Active Dispatches

### Context & Problem
- If a user created a 100-ton PO for Coal and already dispatched 60 tons against it (using coal quality formulas), changing the PO's material to Laterite would corrupt the calculation logic of the 60 tons already fulfilled.

### What Was Built
- In [src/pages/PartyLedger.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/PartyLedger.tsx):
  - Added a validation check: if `poDispatches.length > 0`, the material selector is disabled.
  - Rendered an informative iOS lock banner:
    > *"Material is locked because this PO has active dispatches attached. To change the material, remove or reassign the attached dispatches first."*
  - Allowed full editing of PO number, date, rate, target tonnage, and notes while protecting the material association.

---

## 4. Material Settings Safe Management & Usage Badging

### Context & Problem
- Editing or deleting a material from [src/pages/Settings.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/Settings.tsx) / [src/components/MaterialSettingsPanel.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/MaterialSettingsPanel.tsx) could inadvertently affect existing dispatches, inventory lots, and supplier accounts.

### What Was Built
1. **Usage Reference Counter**:
   - Calculated live reference counts across dispatches, inward lots, and parties for each material.
   - Displayed an iOS badge on each material card: e.g. `Used in 12 dispatches, 4 lots`.
2. **Soft Deactivation vs Hard Deletion**:
   - Prevented hard deletion of materials that have historical entries attached.
   - Implemented an `isActive` archive toggle. Inactive materials remain intact for historical reports, receipts, and ledger balances, but are hidden from new entry dropdowns.
3. **Calculation Isolation**:
   - Ensured that updating default base rates on a material only applies to newly created entries, never retroactively altering previously settled trucks.

---

## 5. PO Target Tonnage Validation with Native iOS Modal (Option B)

### Context & Problem
- In contract PO management, a user can increase target tonnage (e.g. from 100t to 120t) or cap it at the already fulfilled weight (e.g. 60t) to close it early. However, they cannot reduce it below what was already dispatched.
- Previously, this rule triggered an evasive toast message. The user requested an interactive native iOS dialog.

### What Was Built
- Replaced the toast notification with an **iOS Liquid Glass Modal** (`IOSConfirmModal`):
  - **Title**: `Target Below Dispatched Weight`
  - **Icon**: Amber warning icon (`icon="warning"`)
  - **Message**:
    > *"You entered {enteredTons} tons, but {dispatchedTons} tons have already been dispatched across {dispatchesCount} dispatches.*  
    >  
    > *Target tonnage cannot be lower than fulfilled weight. Would you like to cap this PO at exactly {dispatchedTons} tons to complete it early?"*
  - **Primary Button**: `Cap at {dispatchedTons}t & Save` (sets `isActive: false` and saves the PO as fulfilled).
  - **Secondary Button**: `Adjust Target` (returns to the form so the user can enter a valid tonnage).

---

## 6. On-the-Spot Payment Recording (Dispatches & Inward Deliveries)

### Context & Problem
- In physical truck operations, trucks do not always operate strictly on account credit. Often, a driver receives a partial payment, fare payment, or cash advance on the spot when leaving the facility or delivering stock.
- The user requested a streamlined payment entry field on truck dispatches and inward stock to directly record payments made/received on the spot, with automated accounting and reporting adjustments.

### What Was Built

#### A. Data Model & Database Persistence
- Updated `Dispatch` and `InventoryLot` in [src/types.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/types.ts):
  - `paidOnSpot?: number;`
  - `paidOnSpotMode?: 'cash' | 'bank' | 'online' | 'cheque';`
  - `paidOnSpotNote?: string;`
  - `linkedPaymentId?: string;`
- Sanitized and persisted these attributes in `sanitizeDispatch` and `sanitizeLot` in [src/lib/db.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/lib/db.ts).

#### B. Automatic Double-Entry Synchronization
1. **Buyer Dispatch ([DispatchForm.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/DispatchForm.tsx))**:
   - Added an iOS Section: **"On-the-Spot Payment (Optional)"** with amount input, mode picker, note field, and live balance preview.
   - When `paidOnSpot > 0`: automatically saves a linked `Payment` in `idb.payments` (`type: 'received'`).
   - When cleared or set to `0`: automatically deletes the linked payment via `deletePayment(linkedPaymentId)`.
2. **Supplier Inward ([SupplierInwardSheet.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/SupplierInwardSheet.tsx) & [SupplierLedgerView.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/SupplierLedgerView.tsx))**:
   - Added matching payment inputs for inward deliveries.
   - Automatically saves a linked `Payment` (`type: 'paid'`) or deletes it if cleared to `0`.
3. **Cascade Deletion**:
   - Updated `deleteDispatch` and `deleteLot` in [src/lib/db.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/lib/db.ts) to automatically delete any associated `linkedPaymentId` when a truck record is deleted.

#### C. Presentation & Status Badges
- **Ledger Statement Cards** ([PartyLedger.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/PartyLedger.tsx), [SupplierLedgerView.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/SupplierLedgerView.tsx), [AllEntries.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/AllEntries.tsx)):
  - Added clean status tags on truck cards:
    - **Green `PAID`**: Fully settled on the spot (`paidOnSpot >= grossAmount`).
    - **Amber `PAID Rs. XX,XXX`**: Partially paid on the spot.

#### D. Receipts & Exports
- **Image & PDF Receipts** ([DispatchReceipt.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/DispatchReceipt.tsx) & [SupplierDeliveryReceipt.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/SupplierDeliveryReceipt.tsx)):
  - Added a dedicated **"Payment and Account Balance"** summary box:
    - **Total Invoiced / Value**
    - **Paid on Spot (Mode)**
    - **Remaining Balance Due**
    - **Payment Reference Note**
- **Dispatch Preview Modal & WhatsApp Sharing** ([DispatchPreviewModal.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/DispatchPreviewModal.tsx) & [exportSharing.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/utils/exportSharing.ts)):
  - Formatted the breakdown into the generated WhatsApp message text.
- **Excel & PDF Statements** ([exportSharing.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/utils/exportSharing.ts)):
  - Added `Paid on Spot (Rs)` and `Balance Due (Rs)` columns in the Dispatches Excel worksheet with totals.
  - Included payment notes in the logistics section of PDF dispatches.

---

## 7. Linked Payment Protection & Direct Navigation System

### Context & Problem
- Because on-the-spot payments create an entry in `idb.payments`, editing or deleting that payment directly from the generic payment list would desynchronize the parent truck dispatch (e.g. the dispatch invoice would still display Rs. 40,000 paid while the payment list was edited to Rs. 50,000 or deleted).
- The user requested preventing direct edits/deletions on linked payments, intercepting them with an explanatory popup that redirects to the parent truck entry, and explicitly noting that setting the amount to `0` removes the payment.

### What Was Built

#### A. Data Model & Reverse Lookup
- Added `linkedDispatchId?: string;` and `linkedLotId?: string;` to `Payment` in [src/types.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/types.ts).
- Preserved these fields in `sanitizePayment` in [src/lib/db.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/lib/db.ts).
- Verified both forward (`payment.linkedDispatchId`) and reverse (`dispatch.linkedPaymentId === payment.id`) link lookups across all screens.

#### B. Linked Record Banner in Payment Preview
- Inside the Payment Preview bottom sheet in both [PartyLedger.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/PartyLedger.tsx) and [SupplierLedgerView.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/SupplierLedgerView.tsx):
  - Rendered a top banner with an iOS blue linked record icon:
    > **🔗 Linked On-the-Spot Payment**  
    > Attached to Truck: **`TK-9968`** • Date: **`28 Oct 2026`**  
    > `[ View Truck / View Delivery → ]`
  - Clicking the action button navigates directly to the truck dispatch form or opens the inward delivery sheet.

#### C. `LINKED` Badges on Payment Rows
- In transaction history lists, payment cells render an iOS blue **`🔗 LINKED`** tag alongside the payment mode badge (`CASH`, `BANK`, etc.).

#### D. Intercepting "Edit" with iOS Liquid Glass Modal
- In [PartyLedger.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/PartyLedger.tsx) and [SupplierLedgerView.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/SupplierLedgerView.tsx):
  - Tapping **Edit** on a linked payment blocks the generic standalone edit modal.
  - Opens `IOSConfirmModal`:
    - **Title**: `Linked Payment Record`
    - **Icon**: `icon="link"` (blue circular badge)
    - **Message**:
      > *"This payment was recorded on the spot for Truck {truckNum}. To keep receipts, invoice totals, and ledger balances in sync, please update it from the Truck Dispatch form.*  
      >  
      > *Setting the payment amount to 0 or clearing the field will remove this payment, or you can adjust the amount as needed."*
    - **Primary Button**: `Open Truck Dispatch` (or `Open Inward Delivery`)
    - **Secondary Button**: `Cancel`

#### E. Intercepting "Delete" with Clear-to-Zero Guidance
- Tapping **Delete** on a linked payment is intercepted with:
  - **Message**:
    > *"This payment is attached to Truck {truckNum}. To remove or adjust this payment, please edit the payment field in the Truck Dispatch entry.*  
    >  
    > *Setting the payment amount to 0 or clearing the field will automatically remove this payment and keep receipts, invoices, and ledger balances in sync."*
  - **Primary Button**: `Open Truck Dispatch` (or `Open Inward Delivery`)
  - **Secondary Button**: `Cancel`

#### F. `IOSConfirmModal.tsx` Updates
- Added `icon?: 'trash' | 'warning' | 'link' | 'none';` support with `Link2` icon rendered in an iOS blue circular badge.

---

## 8. Automated Tests & Quality Assurance

### Vitest Test Suite ([tests/finalIssuesFixes.test.ts](file:///mnt/hdd/development/New-App-Sept-2026/tests/finalIssuesFixes.test.ts))
- Added an integration test verifying:
  1. Saving a dispatch with `paidOnSpot: 45000` and `linkedPaymentId`.
  2. Preserving `linkedDispatchId` on the generated payment.
  3. Verifying that deleting the dispatch automatically cascade-deletes the linked payment from the database.
- Executed `npm test`: **All 26 test suites and 237 tests passed**.
- Executed `npm run build`: **Compiled with 0 TypeScript and bundle errors**.

---

## 9. Modified Files Summary

| File | Purpose of Modifications |
|---|---|
| [src/types.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/types.ts) | Added on-the-spot payment and bidirectional link properties to `Dispatch`, `InventoryLot`, and `Payment`. |
| [src/lib/db.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/lib/db.ts) | Sanitized fields, added cascade-deletion of linked payments in `deleteDispatch` and `deleteLot`. |
| [src/pages/DispatchForm.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/DispatchForm.tsx) | Added Section 7 ("On-the-Spot Payment"), automatic double-entry payment creation/deletion, and `linkedDispatchId`. |
| [src/components/SupplierInwardSheet.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/SupplierInwardSheet.tsx) | Added on-the-spot payment fields and live balance preview for inward stock deliveries. |
| [src/components/SupplierLedgerView.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/SupplierLedgerView.tsx) | Handled supplier lot payment sync, linked banner in preview sheet, `LINKED` badge on payment cards, and edit/delete interception modals. |
| [src/pages/PartyLedger.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/PartyLedger.tsx) | Multi-material PO support, PO material locking, target tonnage warning modal (Option B), `PAID` badges, linked banner in preview sheet, and edit/delete interception modals. |
| [src/pages/AllEntries.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/AllEntries.tsx) | Added `PAID` / `PAID Rs. XX,XXX` badge on dispatch cards with safe number formatting. |
| [src/components/DispatchReceipt.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/DispatchReceipt.tsx) | Added "Payment and Account Balance" card to dispatch invoice slip. |
| [src/components/SupplierDeliveryReceipt.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/SupplierDeliveryReceipt.tsx) | Added "Payment and Account Balance" card to goods received delivery slip. |
| [src/components/DispatchPreviewModal.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/DispatchPreviewModal.tsx) | Displayed on-the-spot payment card and updated WhatsApp text generation. |
| [src/utils/exportSharing.ts](file:///mnt/hdd/development/New-App-Sept-2026/src/utils/exportSharing.ts) | Added `Paid on Spot` and `Balance Due` columns to Excel exports; updated PDF and WhatsApp exports. |
| [src/components/IOSConfirmModal.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/IOSConfirmModal.tsx) | Added `icon="link"` support with styled iOS blue circular badge. |
| [tests/finalIssuesFixes.test.ts](file:///mnt/hdd/development/New-App-Sept-2026/tests/finalIssuesFixes.test.ts) | Unit tests verifying on-the-spot payment persistence, link preservation, and cascade deletion. |
| [firestore.rules](file:///mnt/hdd/development/New-App-Sept-2026/firestore.rules) | Added schema validation rules for `paidOnSpot`, `paidOnSpotMode`, `paidOnSpotNote`, `linkedPaymentId`, `linkedDispatchId`, and `linkedLotId`. |
| [src/components/WhatsNewModal.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/WhatsNewModal.tsx) | Apple HIG "What's New in Factory Ledger" release announcement modal with version tracking, plain language, and zero emojis. |
| [src/components/Layout.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/components/Layout.tsx) | Mounted `WhatsNewModal` globally and integrated custom open event listener. |
| [src/pages/Settings.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/pages/Settings.tsx) | Added app version display and "Preview What's New" trigger button. |
| [src/App.tsx](file:///mnt/hdd/development/New-App-Sept-2026/src/App.tsx) | Added direct `/whatsnew` route for seamless previewing and testing. |
| [src/index.css](file:///mnt/hdd/development/New-App-Sept-2026/src/index.css) | Added responsive flex centering for `ios-welcome-overlay` and removed glow shadows from role cards. |

---

## 10. Firebase Database & Cloud Sync Audit & Hardening

### Cloud Sync Pipeline Verification
We conducted a comprehensive audit of the entire Firebase synchronization pipeline (`src/lib/syncManager.ts`, `src/lib/firebase.ts`, `src/lib/db.ts`, and `firestore.rules`) to guarantee that all new fields and linkages upload to the cloud without error:

1. **Firestore Serialization & Sanitization (`src/lib/firebase.ts`)**:
   - `sanitizeForFirestore(obj)` deeply cleans all records before uploading.
   - It strips `undefined` keys (preventing Firestore `Unsupported field value: undefined` exceptions).
   - Numerical fields (`paidOnSpot`) are sanitized so that any `NaN` or non-finite numbers default safely to `0`.
   - String fields (`paidOnSpotMode`, `paidOnSpotNote`, `linkedPaymentId`, `linkedDispatchId`, `linkedLotId`) are preserved and cloned cleanly.

2. **Atomic Entity Uploads (`syncLedgerToCloud`)**:
   - Both the Dispatch / Lot and the corresponding linked Payment are saved to local IndexedDB with `dirty: true` and `updatedAt: Date.now()`.
   - When sync executes, both records are bundled into the same Firestore batch commit.
   - Payments are stored under `/users/{uid}/payments/{paymentId}`.
   - Dispatches are stored under `/users/{uid}/dispatches/{dispatchId}`.
   - Lots are stored under `/users/{uid}/lots/{lotId}`.
   - Entity writes use full document sets (without `merge: true`), ensuring that if an on-the-spot payment is cleared or set to 0, the cloud document reflects the removal immediately.

3. **Cloud Firestore Security Rules Hardening (`firestore.rules`)**:
   - Explicitly updated `isValidPayment()`, `isValidDispatch()`, and `isValidLot()`:
     - `isValidPayment`: added `optionalNonEmptyText('linkedDispatchId')` and `optionalNonEmptyText('linkedLotId')`.
     - `isValidDispatch`: added `optionalNonNegativeNumber('paidOnSpot')`, `optionalEnum('paidOnSpotMode', ['bank', 'cash', 'cheque', 'online'])`, `optionalText('paidOnSpotNote')`, and `optionalNonEmptyText('linkedPaymentId')`.
     - `isValidLot`: added `optionalNonNegativeNumber('paidOnSpot')`, `optionalEnum('paidOnSpotMode', ['bank', 'cash', 'cheque', 'online'])`, `optionalText('paidOnSpotNote')`, and `optionalNonEmptyText('linkedPaymentId')`.
   - This ensures Firestore security rules explicitly authorize and strictly validate these fields, preventing `permission-denied` rejections.

4. **Backup Payload & Restore Validation (`src/lib/db.ts`)**:
   - `validateBackupPayload()` now validates the structural types of `linkedDispatchId`, `linkedLotId`, `paidOnSpot`, `paidOnSpotMode`, `paidOnSpotNote`, and `linkedPaymentId`.
   - `restoreBackup()` and `mergeLedgerData()` safely propagate and merge these fields across devices during full cloud restore or peer synchronization.

