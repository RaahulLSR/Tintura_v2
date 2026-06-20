# Tintura — User Guide (A→Z of what the app does)

Tintura is an **AI-enabled Manufacturing Execution System (MES)** for a garment
factory. It tracks a garment from its technical design all the way to finished
stock and sale, and lets the floor talk to the system in plain language (text,
voice notes and photos) over a Telegram bot.

This guide is written for **users** (owners, managers, floor staff). It explains
every feature and how the pieces fit together. No code knowledge needed.

---

## 1. The big picture — how work flows

```
STYLE (design / tech pack)
   │  define the garment once
   ▼
ORDER (production order)            ← created against a style + quantity + sizes
   │  moves through statuses
   ▼
MATERIALS (procurement)             ← thread, fabric, trims requested → ordered → received → released
   │
   ▼
PRODUCTION + STATUS TIMELINE        ← cutting, stitching, QC, packing (with notes & photos)
   │  finished pieces
   ▼
STOCK / INVENTORY (commit to stock) ← completed pieces become on-hand inventory
   │
   ▼
SALES (Purchase Order to a buyer)   ← PO created, PDF generated, stock dispatched
```

Everything is **logged and undoable**, and every screen is **role-gated** so
people only see what they need.

---

## 2. Who logs in (roles)

There are five roles. Each lands on its own home screen after login.

| Role | What they do | Home screen |
|------|--------------|-------------|
| **Admin (MD)** | Full access to everything | Admin HQ |
| **Tech Manager** | System governance, settings, audit, AI config | Control Center |
| **Manager** | Production unit, sales desk, materials oversight | Sub-Unit Ops |
| **Accessories Manager** | Materials / accessories procurement | Materials |
| **Accounts & Inventory** | Stock + sales/accounts | Inventory |

Admin can open any screen. Other roles are restricted to the screens relevant to
their job. If someone opens a page they can't access, they are bounced back to
their home screen.

> **Default logins** (change passwords after first sign-in): `admin/admin`,
> `tech/tech`, `manager/manager`, `materials/materials`, `accounts/accounts`.

---

## 3. The screens (dashboards)

### 3.1 Admin HQ
The master control room for the owner.
- See key stats at a glance: active orders, stock on hand, units.
- **Master order list:** create new production orders, view full details, print
  order reports, email a production sheet to a sub-unit.
- **Bulk actions:** reassign several orders to a different unit, change delivery
  dates, or email a selection in one go.
- **Undo** recent order edits from history.

### 3.2 Style Database (the design library)
The single source of truth for every garment design ("style").
- Catalogue of all styles with images; grid view and side-by-side **compare**.
- **Tech pack editor:** organise specs into categories → fields → colour/size
  variants (e.g. different thread per colour, different artwork per size).
- **Consumption** values per material (how much of each item per piece) drive
  the automatic material forecast on orders.
- **Attachment gallery:** poster images, BOM, measurement charts, custom files.
- **Audit matrix:** quickly see which styles have incomplete tech packs.
- **Bulk import** (CSV) and **bulk update** of attributes across many styles,
  with full **edit history + undo**.
- **Sync orders with styles** so forecasts recalculate after a spec change.

### 3.3 Sub-Unit Ops (production)
Where a production unit runs its live orders.
- List of active orders with their **forecasted material requirements**.
- Move an order along its **status**: Assigned → In Progress → QC → QC Approved
  → Packed → Completed.
- Raise and manage **material requests** for an order.
- **Commit finished pieces to stock** (partial or full), which can be undone.
- Open the **Order Timeline** to read/add progress notes — including **photos**
  (see §5).
- Search and filter by status.

### 3.4 Materials (procurement)
Tracks every material through a 4-stage lifecycle.
- Stages: **Requested → Ordered → Received → Released** (to the floor).
- Partial quantities can sit in different stages at once (e.g. of 2000 cones:
  1000 received, 500 ordered, 500 still requested).
- Colour-coded stage bars show progress; advance a stage with a click.
- An **invoice number** is captured when a material is first ordered.
- Search, filter by stage, refresh.

### 3.5 Inventory (finished stock)
On-hand finished goods, with no barcodes needed.
- One running quantity per **style + colour + size**.
- Stats: total units in stock, how many styles have stock.
- Colour-coded levels (low / medium / high) and search by style.

### 3.6 Sales (purchase orders to buyers)
Turn finished stock into buyer orders.
- Build a **Purchase Order (PO)** as a size × style matrix, pick a buyer.
- Auto-numbered POs (PO-0001, PO-0002, …).
- **Download a clean PO PDF** with one click.
- **Forward** a PO to Accounts & Inventory, which deducts the sold pieces from
  stock.
- Reusable **buyer list**. PO states: Draft → Forwarded → Cancelled.

### 3.7 Control Center (Tech Manager / Admin)
Governance and configuration, organised in tabs:
- **Feature Toggles:** switch features on/off — in-app AI chat, AI writes, AI
  voice, Telegram bot, WhatsApp bot.
- **Telegram Access:** turn the bot on/off and link each user to their Telegram
  chat ID, with a per-role summary of what bot actions they're allowed.
- **Activity Registry:** the full audit log (who did what, when, risk level) with
  **undo**.
- **Dustbin:** recover soft-deleted records, or remove them permanently.
- **AI Settings:** edit the AI assistant's system prompt and the daily summary
  time.

---

## 4. The Telegram bot (the factory floor's remote control)

The bot lets staff operate the system from their phone without opening the app.
It enforces the **same role permissions** as the web app.

**Getting access**
1. The person opens the bot and sends `/id`. The bot replies with their chat ID.
2. An admin pastes that ID against their user in **Control Center → Telegram
   Access**. That links the phone to the role.

**What the bot can do** (menu is filtered to your role):
- **Tech pack:** pull a style's files, measurement chart, or AI summary; upload
  files to a style.
- **Orders:** check an order's status, list active orders, order materials, raise
  a new material request.
- **Sales:** raise a new PO (entering sizes), and send a PO as a PDF.
- **Stock:** commit completed pieces to inventory; look up stock.
- **Updates:** send a **voice note or text** like "Order 1004 packing done" and
  the bot understands it, confirms, and updates the order.
- **Daily summary** of the factory.

**Voice & multilingual:** voice notes are transcribed automatically. Messages in
Tamil / English / Tanglish are understood and normalised to English when logged.

---

## 5. Status timeline notes & photos (free-text progress log)

Not every update is a formal status change. Things like *"500 pieces ironing
completed"* or *"colour mismatch on red lot"* are **progress notes**.

- **In the app:** open an order's **Timeline**, type a note, and optionally
  **attach one or more images** (camera or gallery). Photos appear as thumbnails
  on the timeline and in the admin order view; click to enlarge.
- **From Telegram:** send a text/voice note that mentions an order → it's logged
  to that order's timeline in English. Send a **photo** (with or without a
  caption); if the caption names an order it's attached straight away, otherwise
  the bot asks "which order?" and attaches it once you reply.
- **Smart handling:** finishing sub-processes (ironing, pressing, washing,
  embroidery, printing, folding, etc.) are always treated as notes — they won't
  accidentally flip an order to "Completed".

> **Note on AI:** only the **text** of a note is ever read by the AI. **Images
> are never sent to the AI** — they're stored purely as visual proof on the
> timeline.

---

## 6. Safety nets built in

- **Audit trail:** every meaningful action is recorded (actor, what, when, risk),
  and most can be undone from the Control Center.
- **Dustbin:** deletions are recoverable.
- **Edit history:** bulk style edits and order edits can be rolled back.
- **Undoable stock commits and sales dispatch.**
- **Role gating** on every screen and on every bot action.

---

## 7. Notifications & email

- Creating an order can **email a production sheet** to the sub-unit.
- Material requests can email a **stage-by-stage summary**.
- A **daily summary** ("pulse") can be sent to Telegram with active orders,
  overdue counts and pending material requests.

---

## 8. Where it runs

- **Web app:** hosted on Vercel (production URL: `https://tintura-sst.vercel.app`).
- **Desktop app:** can be packaged as a Windows app via Electron.
- **Database & files:** Supabase (Postgres + file storage).
- **Bots & email:** run as serverless functions alongside the web app.

---

## 9. Glossary

- **Style / Tech pack:** the design specification of a garment.
- **Order:** a production run of a style for a quantity and size mix.
- **Forecast:** auto-calculated material needs for an order, from the tech pack.
- **Procurement stages:** Requested → Ordered → Received → Released.
- **Commit to stock:** turning completed pieces into on-hand inventory.
- **PO (Purchase Order):** an order placed by a buyer, fulfilled from stock.
- **Timeline:** the per-order activity log (status changes + notes + photos).
- **Pulse:** the scheduled daily summary message.
</content>
</invoke>
