# Tintura — Architecture & Code Guide

A file-by-file, system-by-system explanation of **how the app is built and how
things are implemented**. Read this alongside [USER_GUIDE.md](USER_GUIDE.md)
(what the app does) and [AI_SYSTEM_PROMPT.md](AI_SYSTEM_PROMPT.md) (handoff
prompt for an AI continuing this work).

---


## 1. Tech stack

| Layer | Technology |
|-------|------------|
| UI | React 18 + TypeScript, React Router 6 (**HashRouter**) |
| Build | Vite 5 (esbuild; **no type-check at build time**) |
| Styling | Tailwind CSS 3 + PostCSS/autoprefixer; Lucide React icons |
| Backend | Supabase (Postgres + Storage), accessed with the **anon key** |
| Serverless | Vercel functions in `api/**` (Node, ESM) |
| Desktop | Electron 29 (optional packaging) |
| PDF | `pdf-lib` (isomorphic — runs in browser **and** Node) |
| Email | `nodemailer` (Gmail SMTP) in serverless functions |
| AI | Google Gemini and/or Groq (pluggable provider); Groq Whisper for voice |

**Key build facts**
- `npm run dev` → Vite dev server. `npm run build` → production bundle in
  `dist/`. `npm run electron` / `npm run dist` → desktop build/installer.
- Build does **not** run `tsc`, so type errors don't fail the build. Validate
  types via the editor / `get_errors`. A chunk-size > 500 kB warning is normal.
- `package.json` has `"type": "module"`. **Therefore every relative import in
  `api/**` and `services/**` must end in `.js`** (even when importing a `.ts`
  file). Frontend files in `pages/` and `components/` import **without** an
  extension. This split matters — getting it wrong breaks the serverless build.

---

## 2. Repository layout

```
TINTURA_data_base-main/
├─ index.html / index.tsx / App.tsx     # entry + routing
├─ types.ts                             # all shared types + helpers (data model)
├─ electron.js                          # desktop shell
├─ vite.config.ts / tailwind.config.js  # build + styling config
├─ backend/full_setup.sql               # the ENTIRE DB schema (run once in Supabase)
├─ api/                                  # Vercel serverless functions
├─ services/                            # data + AI + utility layer (no JSX)
│  └─ ai/                               # pluggable LLM provider + tool registry
├─ pages/                               # one component per dashboard/route
├─ components/                          # reusable UI, grouped by domain
│  ├─ admin/  style-db/  subunit/
└─ docs/                                # this documentation
```

---

## 3. Entry & routing

- **`index.tsx`** mounts `<App/>` into `#root`.
- **`App.tsx`** sets up `HashRouter` and wraps everything in `AuthProvider` +
  `Layout`. It defines a `ProtectedRoute` that checks `useAuth()` and the role
  allow-list; Admin bypasses all role checks. `homeForRole()` decides where each
  role lands.
- **Routes:** `/` Admin, `/styles` Style DB, `/subunit` Sub-Unit, `/materials`
  Materials, `/inventory` Inventory, `/sales` Sales, `/control` Control Center,
  `/login` public.
- **`vite.config.ts`** uses `base: './'` (so the Electron `file://` build works)
  and polyfills `process.env` for legacy references.

---

## 4. The data model — `types.ts`

`types.ts` is the contract for the whole app. Highlights:

- **Enums:** `UserRole` (ADMIN, TECH_MANAGER, MANAGER, ACCESSORIES_MANAGER,
  ACCOUNTS_INVENTORY), `OrderStatus` (ASSIGNED → IN_PROGRESS → QC → QC_APPROVED →
  PACKED → COMPLETED), `MaterialStatus`, `MaterialStage` (REQUESTED → ORDERED →
  RECEIVED → RELEASED).
- **Core entities:** `Style`, `Order`, `OrderLog`, `Unit`, `MaterialRequest`,
  `MaterialProcurement` / `MaterialMovement`, `StockLevel`,
  `StockCommitLine` / `OrderStockCommit`, `SalesOrder` / `SalesOrderLine`,
  `Buyer`, `Invoice`, `AppUser`.
- **Tech pack shape:** `Style.tech_pack` is `Record<category, Record<field,
  TechPackItem>>`. `TechPackItem` can carry colour `variants`, each with size
  `sizeVariants`, and a material `consumption_type`/`consumption_val`.
  Two reserved keys live inside `tech_pack` to avoid schema churn:
  `__poster__` (`POSTER_KEY`, holds poster images + chosen main image) and
  `__custom__` (`CUSTOM_KEY`, ad-hoc extra items). Helpers `getStylePoster`,
  `getStyleMainImage`, `getStyleCustomItems` read them.
- **`OrderLog`** = timeline entry: `log_type` (STATUS_CHANGE | MANUAL_UPDATE |
  CREATION), `message`, optional `created_by_name`, and `attachments?: {url,
  name}[]` (images — **excluded from AI**).
- **Helper functions** (used everywhere, keep them here): `getNextOrderStatus`,
  `formatOrderNumber` (renders `ORD-<style>-<serial>`), `normalizeSize`
  (`2XL→XXL`, `3XL→XXXL`), `getSizeKeyFromLabel` (maps a size label to the
  `SizeBreakdown` key, supporting `standard` and `numeric` formats).

The SQL in `backend/full_setup.sql` mirrors these types one-to-one. It is
idempotent (every statement guarded by `if not exists` / `on conflict`) and is
the authoritative schema — **re-run it in Supabase after any schema change.**

---

## 5. Services layer (`services/`)

No JSX here — pure data access, AI, and helpers.

### `supabase.ts`
Creates the shared Supabase client from env (`VITE_SUPABASE_URL` /
`VITE_SUPABASE_ANON_KEY`, with `REACT_APP_*` fallbacks). Exports `supabase`.

### `db.ts` (the big one, ~800 lines)
The application's CRUD layer. Functions grouped by domain:

- **Forecast:** `calculateOrderForecast()` — expands an order's size_breakdown
  through the style tech pack consumption values into material requirements.
- **History / undo:** `recordBulkEditHistory`, `fetchBulkEditHistory`,
  `undoBulkEdit`, `recordOrderEditHistory`, `fetchOrderEditHistory`,
  `undoOrderEdit`.
- **Styles:** `fetchStyles`, `fetchStyleByNumber`, `upsertStyle`, `deleteStyle`,
  `fetchStyleTemplate`, `updateStyleTemplate`.
- **Orders & status:** `fetchOrders`, `createOrder` (auto order# via
  `rpc('next_order_no')`, writes a `CREATION` log), `updateOrderDetails`,
  `updateOrderStatus`, `deleteOrder`, `syncAllOrdersWithStyles`.
- **Order logs:** `fetchOrderLogs(orderId?)`,
  `addOrderLog(orderId, type, message, createdBy='System', attachments=[])`.
- **Auth / users:** `authenticateUser`, `fetchAppUsers`,
  `setUserTelegramChatId`.
- **Units:** `fetchUnits`.
- **Material requests:** `fetchMaterialRequests`, `createMaterialRequest`,
  `updateMaterialRequest`, `deleteMaterialRequest`, `fetchMaterialApprovals`,
  `approveMaterialRequest`.
- **Procurement (4-stage):** `fetchProcurements`, `fetchProcurementMovements`,
  `createProcurement`, `advanceProcurement`.
- **Inventory:** `fetchStockLevels`, `adjustStockLevel`.
- **Stock commits:** `fetchOrderStockCommits`, `commitOrderStock` (adjusts
  `stock_levels`, inserts `order_stock_commits`, logs a note), `undoOrderStockCommit`.
- **Sales:** `fetchSalesOrders`, `createSalesOrder` (auto PO# via
  `rpc('next_po_no')`), `forwardSalesOrder` (deducts stock), `cancelSalesOrder`.
- **Buyers / invoices:** `fetchBuyers`, `upsertBuyer`, `deleteBuyer`,
  `fetchInvoices`.
- **Files / email:** `uploadOrderAttachment(file)` → public URL in the
  `order-attachments` bucket; `triggerOrderEmail`, `triggerMaterialEmail` (call
  the `api/` email functions).

### AI subsystem — `services/ai/`
- **`providers.ts`** — pluggable LLM backend. `getProvider()` returns a
  `GeminiProvider` or `GroqProvider` based on `VITE_AI_PROVIDER`. Each implements
  `chat(messages, role, system)` with a neutral `AgentMessage` format and
  function-calling support. Env: Gemini (`VITE_GEMINI_API_KEY` / `GEMINI_API_KEY`
  / `GOOGLE_API_KEY`, model default `gemini-2.5-flash`), Groq (`VITE_GROQ_API_KEY`,
  model default `llama-3.3-70b-versatile`).
- **`toolRegistry.ts`** — the single list of actions the in-app AI may call,
  each tagged with a **risk tier**: `read` (auto-run), `low` (auto-run, logged,
  undoable), `high` (requires explicit approval). Exposes `getToolsForRole`,
  `executeTool`, plus `ToolContext`/`ToolResult`. Privileged roles
  (ADMIN/TECH_MANAGER) bypass role checks.
- **`geminiService.ts`** — the agent loop on top of the provider: `sendUserMessage`
  runs up to several tool-calling hops, feeding tool results back to the model;
  `approvePending` / `rejectPending` gate high-risk actions; `isAIConfigured`
  checks for a key. Tool results are truncated to stay within token limits.

### Utility services
- **`sizes.ts`** — `CANONICAL_SIZES`, numeric↔letter `SIZE_PAIRS`,
  `normalizeSize`, `sizesEqual`, `combinedSizeLabel` ("65/S"), `sizeLabelParts`.
  Used by both frontend and the Telegram webhook (imported with `.js`).
- **`poPdf.ts`** — `buildPoPdfBytes(po)` builds a clean A4 PO PDF with pure
  `pdf-lib` (no fetch/images), so it works in the browser (download button) and
  in Node (Telegram send). **Gotcha:** `StandardFonts.Helvetica` uses WinAnsi and
  throws on unsupported glyphs (→, ₹, emoji, curly quotes). The file has a
  `safe()` sanitiser that maps/strips those — keep all drawn text sanitised.
- **`botAccess.ts`** — isomorphic bot RBAC. `BOT_ACTIONS` (14 actions keyed by
  callback_data), `ROLE_BOT_ACCESS`, `allowedBotActions(role)`,
  `canUseBotAction(role, key)`, `accessSummary(role)` (for the Control Center
  table).
- **`activityLog.ts`** — append-only audit (`activity_log` table): `logActivity`,
  `fetchActivity`, `fetchActivityForEntity`, `undoActivity` (reverts via
  before/after snapshots).
- **`dustbin.ts`** — soft delete / restore (`dustbin` table): `moveToDustbin`,
  `restoreFromDustbin`, `fetchDustbin`.
- **`featureToggles.ts`** — runtime flags (`feature_toggles` table): `FLAGS`
  constant, `isEnabled` (sync cache), `checkEnabled` (async), `fetchToggles`,
  `setToggle`.
- **`appSettings.ts`** — key/value config (`app_settings` table): e.g.
  `ai_system_prompt`; `getSetting` (sync), `setSetting`, `fetchSettings`.

---

## 6. Pages (`pages/`) — one per route

Each page is a self-contained dashboard. Roles in brackets are from `App.tsx`.

- **`Login.tsx`** (public): username/password → `authenticateUser` → redirect by
  role.
- **`AdminDashboard.tsx`** (ADMIN): stats, master order list, create order,
  bulk reassign/date/email, order-edit undo. Renders `LaunchOrderModal`,
  `MasterOrderList`, `DashboardStats`, `AdminOrderDetailsModal`.
- **`SubunitDashboard.tsx`** (ADMIN, MANAGER): live orders + forecasts, status
  progression, material requests, **stock commit**, **timeline (notes + photos)**.
  Owns `submitManualStatusUpdate` (adds a `MANUAL_UPDATE` log with optional
  attachments) and `handleCommitStock`.
- **`MaterialsDashboard.tsx`** (ADMIN, ACCESSORIES_MANAGER, MANAGER): the 4-stage
  procurement board, stage bars, create/advance, its own local `TimelineModal`
  for material movement history.
- **`InventoryDashboard.tsx`** (ADMIN, ACCOUNTS_INVENTORY, MANAGER): aggregated
  stock by style/colour/size with thresholds.
- **`SalesDashboard.tsx`** (ADMIN, MANAGER, ACCOUNTS_INVENTORY): PO matrix
  builder, buyer selection, **PO PDF download** (`buildPoPdfBytes`), forward to
  deduct stock.
- **`StyleDatabase.tsx`** (ADMIN, TECH_MANAGER, MANAGER): the design library —
  catalogue, compare, tech-pack editor, attachments, audit matrix, bulk
  import/update + history.
- **`TechManagerDashboard.tsx`** (ADMIN, TECH_MANAGER): the **Control Center**.
  Tabs: Feature Toggles, **Telegram Access** (bot on/off + per-user chat-ID
  linking + role access summary), Activity Registry (audit + undo), Dustbin,
  AI Settings (system prompt + pulse time).

---

## 7. Components (`components/`)

- **`Layout.tsx`** — app shell. Exports `AuthContext`/`useAuth` (login state,
  persisted to `localStorage`), `AuthProvider`, and `Layout` (role-based sidebar,
  loads toggles/settings, mounts the in-app AI chat panel when enabled).
- **`Widgets.tsx`** — shared bits like `StatusBadge` and the multi-select
  `BulkActionToolbar`.
- **`admin/`** — `AdminOrderDetailsModal` (full order view/edit + timeline with
  photo thumbnails), `DashboardStats`, `LaunchOrderModal` (create order; submits
  via `createOrder`), `MasterOrderList`.
- **`style-db/`** — `StyleEditor` (nested tech-pack editor), `StyleFullView`,
  `CompareView`, `AttachmentGallery` + `AttachmentPreview`, `CategoryEditor`,
  `ConsumptionInput`, `AuditMatrixModal`, `BulkImportModal`, `BulkUpdateModal`,
  `BulkAttributeUpdateModal`, `HistoryModal`, `EditorModal`, and
  `styleValidation.ts` (completeness helpers).
- **`subunit/`** — `OrderDetailsModal`, `TimelineModal` (notes **+ image
  upload/preview/thumbnails**), `StockCommitModal`, `CompletionModal`,
  `MaterialRequestModal`, `MaterialHistoryModal`, `BarcodeModal`.

---

## 8. Serverless API (`api/`)

Vercel functions. **Remember the `.js` import rule.**

- **`telegram-webhook.ts`** (POST; the largest backend file, ~2000 lines) — the
  Telegram bot. Responsibilities:
  - **Routing/handler:** POST-only (405 otherwise), verifies
    `TELEGRAM_WEBHOOK_SECRET`, checks the `telegram_bot` feature toggle, optional
    `TELEGRAM_ALLOWED_CHAT_IDS` allow-list, then routes callback queries / photos
    / voice / text.
  - **Access control:** `loadBotAccess(chatId)` looks up `app_users` by chat ID.
    Bootstrap mode grants full access until the first chat ID is linked; once
    linked, `canUseBotAction(role, key)` gates every `act:*` button; unregistered
    users are told their chat ID. Fails **open** on DB error to avoid lockout.
  - **Menus:** `MAIN_MENU` (14 actions) filtered per role by `menuForRole`.
  - **Voice:** transcribed via Groq Whisper (`GROQ_WHISPER_MODEL`), then parsed.
  - **Natural-language updates:** `parseUpdate` (regex + one small Gemini JSON
    call) classifies order vs material and extracts order#/status/stage.
  - **Free-text timeline notes:** finishing sub-processes and any unrecognised
    update become a `MANUAL_UPDATE` note (`toEnglishNote` normalises to English).
    If no order is identified, the bot asks "which order?" (`note:order` flow).
  - **Photos → timeline:** an image (with/without caption) is uploaded to the
    bucket and attached to an order's timeline; if the order is unknown it's
    remembered (`pendingImages`) until the user replies with the order number.
  - **PO builder + PDF:** build a `SalesOrder` step-by-step and send it as a PDF
    via `buildPoPdfBytes`.
  - **`/id`** (+ `/whoami` `/chatid` `/myid`): always replies with the chat ID.
  - Per-chat flow state is stored in the `telegram_sessions` table.
- **`whatsapp-webhook.ts`** (POST) — parallel WhatsApp channel (voice transcribe,
  AI parse, status/stock actions). Not surfaced in the UI yet.
- **`daily-pulse.ts`** — Vercel Cron daily summary (active orders by status,
  overdue, pending materials) to the pulse chat. Templated, no LLM.
- **`send-email.ts`** / **`send-material-email.ts`** (POST) — `nodemailer` over
  Gmail SMTP; send the production-sheet and material-summary emails. Triggered by
  `triggerOrderEmail` / `triggerMaterialEmail` in `db.ts`.

---

## 9. Security & data posture

- **App tables have no RLS** (dev posture) — the anon key can read/write
  everything. Access control is enforced in the **app layer** (`useAuth` + route
  roles) and in the **bot** (`botAccess`). Before going public, enable RLS +
  policies.
- The **`order-attachments`** storage bucket is **public** so Telegram and image
  previews work by URL.
- Serverless secrets (bot token, service-role key, Gmail password, AI keys) live
  in Vercel env vars, never in the bundle. The Supabase **anon** key is safe to
  embed in the frontend.

---

## 10. Environment variables (quick reference)

**Frontend (safe to embed):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_AI_PROVIDER`, `VITE_GEMINI_API_KEY`, `VITE_GEMINI_MODEL`,
`VITE_GROQ_API_KEY`, `VITE_GROQ_MODEL`.

**Serverless (secret):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or
`SUPABASE_KEY`/anon), `GEMINI_API_KEY`/`GOOGLE_API_KEY`, `GEMINI_MODEL`,
`GROQ_API_KEY`, `GROQ_WHISPER_MODEL`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_ALLOWED_CHAT_IDS`, `TELEGRAM_PULSE_CHAT_ID`,
`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`,
`WHATSAPP_ALLOWED_NUMBERS`, `WHATSAPP_AUTO_APPROVE`, `GMAIL_USER`,
`GMAIL_APP_PASSWORD`.

(Many have `VITE_*` / `REACT_APP_*` / bare fallbacks — see the env table in the
exploration notes or grep `getEnv` / `process.env`.)

---

## 11. Build, deploy, verify (operational notes)

- **Build:** `npm run build` (esbuild; chunk-size warning is expected).
- **Deploy:** Vercel project `tintura-sst`; production URL
  `https://tintura-sst.vercel.app`.
- **Verify after deploy:** app should return `200`; the webhook should return
  `405` to a GET (it's POST-only).
- **Schema changes:** edit `backend/full_setup.sql` (keep it idempotent) and
  re-run it once in the Supabase SQL Editor.

---

## 12. Conventions to keep

1. `api/**` and `services/**` relative imports **end in `.js`**; frontend imports
   don't.
2. All drawn PDF text goes through `poPdf.ts`'s `safe()` sanitiser.
3. Shared types and small pure helpers live in `types.ts` / `services/sizes.ts`
   so both the frontend and the webhook can use them.
4. Mutating actions should be **logged** (audit) and ideally **undoable**.
5. The schema file is the source of truth — update it with every DB change.
6. Images attached to timeline notes are **never** sent to the AI; only text is.
</content>
