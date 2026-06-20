import { UserRole, RiskLevel, MaterialStage, Style, Attachment } from '../../types.js';
import {
  fetchOrders,
  fetchStyles,
  fetchStyleByNumber,
  fetchUnits,
  fetchMaterialRequests,
  createMaterialRequest,
  updateOrderStatus,
  addOrderLog,
  calculateOrderForecast,
  fetchProcurements,
  createProcurement,
  advanceProcurement,
  fetchSalesOrders,
} from '../db.js';
import { getNextOrderStatus } from '../../types.js';
import { logActivity } from '../activityLog.js';

/**
 * Shared AI Tool Registry
 * -----------------------
 * The single source of truth for everything the AI is allowed to do. Every
 * channel (in-app chat, Telegram, WhatsApp) calls THIS registry, so the brain is
 * written once and inherits the same risk tiers, role scoping and audit trail.
 *
 * Risk tiers:
 *  - read  : always runs (no side effects)
 *  - low   : runs automatically, but is logged + undoable
 *  - high  : requires explicit human approval (ctx.approved) before running
 */

export interface ToolContext {
  actor: string;
  role: UserRole;
  source?: 'human' | 'ai';
  approved?: boolean; // set true once a human confirms a high-risk action
}

export interface ToolParam {
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

export interface AITool {
  name: string;
  description: string;
  risk: RiskLevel;
  roles: UserRole[]; // allowed roles; empty array = all roles
  parameters: Record<string, ToolParam>;
  run: (args: Record<string, any>, ctx: ToolContext) => Promise<any>;
}

export type ToolResult =
  | { status: 'ok'; data: any }
  | { status: 'needs_approval'; tool: string; risk: RiskLevel; args: Record<string, any> }
  | { status: 'forbidden'; reason: string }
  | { status: 'error'; error: string };

// The Tech Manager can use every tool regardless of the tool's role list.
const isPrivileged = (role: UserRole) => role === UserRole.ADMIN || role === UserRole.TECH_MANAGER;

/** Compact, readable tech-pack text (avoids dumping huge JSON into the model). */
const summarizeTechPack = (style: Style): string => {
  const tp = style.tech_pack || {};
  const lines: string[] = [];
  for (const [cat, fields] of Object.entries(tp)) {
    for (const [field, item] of Object.entries(fields || {})) {
      const parts: string[] = [];
      if (item?.text) parts.push(item.text.trim());
      (item?.variants || []).forEach((v) => {
        const seg: string[] = [];
        if (v.colors?.length) seg.push(`[${v.colors.join('/')}]`);
        if (v.text) seg.push(v.text.trim());
        (v.sizeVariants || []).forEach((sv) => {
          if (sv.sizes?.length || sv.text) seg.push(`(${(sv.sizes || []).join('/')}: ${sv.text || ''})`);
        });
        if (seg.length) parts.push(seg.join(' '));
      });
      const val = parts.filter(Boolean).join(' | ').slice(0, 200);
      if (val) lines.push(`- ${cat} > ${field}: ${val}`);
    }
  }
  const text = lines.join('\n');
  return text.length > 3000 ? text.slice(0, 3000) + '\n…(truncated)' : text || '(no tech pack details)';
};

/** Gather every uploaded file across the whole nested tech pack, de-duplicated. */
const collectTechPackAttachments = (style: Style): Attachment[] => {
  const out: Attachment[] = [];
  const push = (a?: Attachment[]) => { if (Array.isArray(a)) out.push(...a.filter((x) => x && x.url)); };
  for (const fields of Object.values(style.tech_pack || {})) {
    for (const item of Object.values(fields || {})) {
      push(item?.attachments);
      (item?.variants || []).forEach((v) => {
        push(v.attachments);
        (v.sizeVariants || []).forEach((sv) => push(sv.attachments));
      });
    }
  }
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
};

export const TOOLS: AITool[] = [
  // ---------- READ ----------
  {
    name: 'list_orders',
    description: 'List production orders (summary fields only), optionally filtered by status. Use get_order for full detail.',
    risk: 'read',
    roles: [],
    parameters: { status: { type: 'string', description: 'Optional OrderStatus filter' } },
    run: async (args) => {
      const orders = await fetchOrders();
      const filtered = args.status ? orders.filter((o) => o.status === args.status) : orders;
      return filtered.map((o) => ({
        id: o.id,
        order_no: o.order_no,
        style_number: o.style_number,
        quantity: o.quantity,
        status: o.status,
        target_delivery_date: o.target_delivery_date,
        unit_id: o.unit_id,
        description: o.description,
      }));
    },
  },
  {
    name: 'get_order',
    description: 'Get one order by its order number (e.g. ORD-12).',
    risk: 'read',
    roles: [],
    parameters: { order_no: { type: 'string', description: 'Order number', required: true } },
    run: async (args) => {
      const orders = await fetchOrders();
      return orders.find((o) => o.order_no === args.order_no) || null;
    },
  },
  {
    name: 'list_styles',
    description: 'List styles (summary fields only) in the Style Technical Database. Use get_style for the full tech pack.',
    risk: 'read',
    roles: [],
    parameters: {},
    run: async () => {
      const styles = await fetchStyles();
      return styles.map((s) => ({
        id: s.id,
        style_number: s.style_number,
        category: s.category,
        garment_type: s.garment_type,
        demographic: s.demographic,
        pcs_per_box: s.pcs_per_box,
        available_colors: s.available_colors,
        available_sizes: s.available_sizes,
      }));
    },
  },
  {
    name: 'get_style',
    description: 'Get a style with a COMPACT tech-pack summary by style number (safe for token limits). For the full uploaded files use send_style_files.',
    risk: 'read',
    roles: [],
    parameters: { style_number: { type: 'string', description: 'Style number', required: true } },
    run: async (args) => {
      const style = await fetchStyleByNumber(args.style_number);
      if (!style) return { error: 'Style not found' };
      return {
        style_number: style.style_number,
        category: style.category,
        garment_type: style.garment_type,
        demographic: style.demographic,
        pcs_per_box: style.pcs_per_box,
        packing_type: style.packing_type,
        available_colors: style.available_colors,
        available_sizes: style.available_sizes,
        size_type: style.size_type,
        style_text: (style.style_text || '').slice(0, 500),
        tech_pack_summary: summarizeTechPack(style),
        file_count: collectTechPackAttachments(style).length,
      };
    },
  },
  {
    name: 'get_style_techpack',
    description: 'Get a compact, readable tech-pack (categories > fields) for a style. Use this to answer construction/BOM questions without large payloads.',
    risk: 'read',
    roles: [],
    parameters: { style_number: { type: 'string', description: 'Style number', required: true } },
    run: async (args) => {
      const style = await fetchStyleByNumber(args.style_number);
      if (!style) return { error: 'Style not found' };
      return { style_number: style.style_number, tech_pack: summarizeTechPack(style) };
    },
  },
  {
    name: 'send_style_files',
    description: "Send the style's uploaded tech-pack files (photos, PDFs, drawings, size charts) to the user as real attachments. Use whenever the user asks for the tech pack, drawings, size chart, PDF or images of a style.",
    risk: 'read',
    roles: [],
    parameters: { style_number: { type: 'string', description: 'Style number', required: true } },
    run: async (args) => {
      const style = await fetchStyleByNumber(args.style_number);
      if (!style) return { error: 'Style not found' };
      const atts = collectTechPackAttachments(style);
      if (!atts.length) return { sent: 0, note: `No uploaded files found for style ${style.style_number}.` };
      return {
        sent: atts.length,
        files: atts.map((a) => a.name),
        __deliver: atts.map((a) => ({
          kind: a.type === 'image' ? 'photo' : 'document',
          url: a.url,
          filename: a.name,
          caption: `${style.style_number} \u2014 ${a.name}`,
        })),
      };
    },
  },
  {
    name: 'list_units',
    description: 'List production units / subunits.',
    risk: 'read',
    roles: [],
    parameters: {},
    run: async () => fetchUnits(),
  },
  {
    name: 'list_material_requests',
    description: 'List material requests (summary fields only), optionally for one order.',
    risk: 'read',
    roles: [],
    parameters: { order_id: { type: 'string', description: 'Optional order id' } },
    run: async (args) => {
      const reqs = await fetchMaterialRequests();
      const filtered = args.order_id ? reqs.filter((r) => r.order_id === args.order_id) : reqs;
      return filtered.map((r) => ({
        id: r.id,
        order_id: r.order_id,
        material_content: r.material_content,
        quantity_requested: r.quantity_requested,
        quantity_approved: r.quantity_approved,
        unit: r.unit,
        status: r.status,
      }));
    },
  },
  {
    name: 'forecast_order',
    description: 'Compute the material/BOM forecast for an order using its linked style.',
    risk: 'read',
    roles: [],
    parameters: { order_no: { type: 'string', description: 'Order number', required: true } },
    run: async (args) => {
      const orders = await fetchOrders();
      const order = orders.find((o) => o.order_no === args.order_no);
      if (!order) return { error: 'Order not found' };
      const styleNum = order.style_number.split(' - ')[0].trim();
      const style = await fetchStyleByNumber(styleNum);
      if (!style) return { error: 'Linked style not found' };
      return calculateOrderForecast(order, style);
    },
  },

  // ---------- SALES (read-only PO analytics) ----------
  {
    name: 'list_sales_orders',
    description:
      'List buyer purchase orders (POs). Each has po_number, buyer, date, status (DRAFT/FORWARDED/CANCELLED), total pieces and amount. Use to answer questions about who ordered what, recent POs, or to feed a chart.',
    risk: 'read',
    roles: [],
    parameters: {
      status: { type: 'string', description: 'Optional: DRAFT, FORWARDED or CANCELLED' },
      buyer: { type: 'string', description: 'Optional: filter by buyer name (substring)' },
    },
    run: async (args) => {
      const all = await fetchSalesOrders();
      const rows = all.filter((o) => {
        if (args.status && o.status !== String(args.status).toUpperCase()) return false;
        if (args.buyer && !o.buyer_name.toLowerCase().includes(String(args.buyer).toLowerCase())) return false;
        return true;
      });
      return rows.slice(0, 40).map((o) => ({
        po_number: o.po_number,
        buyer: o.buyer_name,
        date: o.po_date,
        status: o.status,
        qty: o.total_qty,
        amount: o.total_amount,
        styles: o.lines.map((l) => l.style_number),
      }));
    },
  },
  {
    name: 'sales_summary',
    description:
      'Aggregate sales POs into totals for charts/insights. Returns pieces by buyer, by style, by month and a status split. Use this when asked for sales trends, top buyers, best-selling styles or monthly volume.',
    risk: 'read',
    roles: [],
    parameters: {
      status: { type: 'string', description: 'Optional: only count this status (default counts all except CANCELLED)' },
    },
    run: async (args) => {
      const all = await fetchSalesOrders();
      const want = args.status ? String(args.status).toUpperCase() : null;
      const orders = all.filter((o) => (want ? o.status === want : o.status !== 'CANCELLED'));
      const byBuyer: Record<string, number> = {};
      const byStyle: Record<string, number> = {};
      const byMonth: Record<string, number> = {};
      let totalQty = 0;
      let totalAmount = 0;
      const statusSplit: Record<string, number> = {};
      for (const o of all) statusSplit[o.status] = (statusSplit[o.status] || 0) + 1;
      for (const o of orders) {
        totalQty += o.total_qty;
        totalAmount += o.total_amount;
        byBuyer[o.buyer_name] = (byBuyer[o.buyer_name] || 0) + o.total_qty;
        const month = (o.po_date || '').slice(0, 7);
        if (month) byMonth[month] = (byMonth[month] || 0) + o.total_qty;
        for (const l of o.lines) byStyle[l.style_number] = (byStyle[l.style_number] || 0) + l.total;
      }
      const top = (rec: Record<string, number>, n: number) =>
        Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ label: k, qty: v }));
      return {
        total_pos: orders.length,
        total_pieces: totalQty,
        total_amount: totalAmount,
        status_split: statusSplit,
        top_buyers: top(byBuyer, 8),
        top_styles: top(byStyle, 8),
        by_month: Object.entries(byMonth).sort().map(([k, v]) => ({ month: k, qty: v })),
      };
    },
  },

  // ---------- LOW (auto-run, logged, undoable) ----------
  {
    name: 'add_order_note',
    description: 'Add a note / log entry to an order.',
    risk: 'low',
    roles: [],
    parameters: {
      order_id: { type: 'string', description: 'Order id', required: true },
      message: { type: 'string', description: 'Note text', required: true },
    },
    run: async (args, ctx) => {
      await addOrderLog(args.order_id, 'MANUAL_UPDATE', args.message);
      await logActivity({
        actor: ctx.actor,
        actor_role: ctx.role,
        source: ctx.source || 'ai',
        action: 'order.note',
        entity_table: 'order_logs',
        entity_id: args.order_id,
        summary: `Note added to order: ${args.message}`,
        risk: 'low',
        before: null,
        after: { order_id: args.order_id, message: args.message },
      });
      return { ok: true };
    },
  },

  // ---------- MATERIALS PROCUREMENT (voice / WhatsApp driven) ----------
  {
    name: 'list_material_procurements',
    description:
      'List material procurement lines with their 4-stage progress (Requested/Ordered/Received/Released), invoice number and the style/order they belong to. Use this to find a procurement id before advancing it.',
    risk: 'read',
    roles: [UserRole.ADMIN, UserRole.ACCESSORIES_MANAGER, UserRole.MANAGER, UserRole.TECH_MANAGER],
    parameters: {
      style_number: { type: 'string', description: 'Optional: only this style' },
      material_name: { type: 'string', description: 'Optional: filter by material name (substring)' },
    },
    run: async (args) => {
      const procs = await fetchProcurements();
      const filtered = procs.filter((p) => {
        if (args.style_number && p.style_number !== args.style_number) return false;
        if (args.material_name && !p.material_name.toLowerCase().includes(String(args.material_name).toLowerCase()))
          return false;
        return true;
      });
      return filtered.map((p) => ({
        id: p.id,
        material_name: p.material_name,
        style_number: p.style_number,
        order_id: p.order_id,
        unit: p.unit,
        total: p.total_quantity,
        requested: p.qty_requested,
        ordered: p.qty_ordered,
        received: p.qty_received,
        released: p.qty_released,
        invoice_no: p.invoice_no,
      }));
    },
  },
  {
    name: 'create_material_procurement',
    description:
      'Create a material procurement line for a style/order. By default the whole quantity starts at the Requested stage. Set start_stage to ORDERED and pass invoice_no to log something already purchased. If the user says it was ordered but gives no invoice number, ASK for the invoice number before calling this.',
    risk: 'low',
    roles: [UserRole.ADMIN, UserRole.ACCESSORIES_MANAGER, UserRole.MANAGER, UserRole.TECH_MANAGER],
    parameters: {
      style_number: { type: 'string', description: 'Style number this material is for', required: true },
      material_name: { type: 'string', description: 'Material name, e.g. "Black sewing thread (cone)"', required: true },
      quantity: { type: 'number', description: 'Total quantity', required: true },
      unit: { type: 'string', description: 'Unit of measure (default Nos)' },
      order_id: { type: 'string', description: 'Optional production order id to link' },
      start_stage: { type: 'string', description: 'REQUESTED (default) or ORDERED' },
      invoice_no: { type: 'string', description: 'Invoice number (required when start_stage is ORDERED)' },
      note: { type: 'string', description: 'Optional note' },
    },
    run: async (args, ctx) => {
      const startStage =
        String(args.start_stage || 'REQUESTED').toUpperCase() === 'ORDERED'
          ? MaterialStage.ORDERED
          : MaterialStage.REQUESTED;
      const proc = await createProcurement({
        order_id: args.order_id || null,
        style_number: args.style_number,
        material_name: args.material_name,
        unit: args.unit || 'Nos',
        total_quantity: Number(args.quantity),
        startStage,
        invoice_no: args.invoice_no || null,
        note: args.note,
        created_by_name: ctx.actor,
      });
      await logActivity({
        actor: ctx.actor,
        actor_role: ctx.role,
        source: ctx.source || 'ai',
        action: 'procurement.create',
        entity_table: 'material_procurements',
        entity_id: proc.id,
        summary: `Procurement: ${args.quantity} ${args.unit || 'Nos'} of ${args.material_name} for ${args.style_number} (${startStage})`,
        risk: 'low',
        before: null,
        after: proc,
      });
      return { ok: true, procurement_id: proc.id };
    },
  },
  {
    name: 'advance_material_procurement',
    description:
      'Move part or all of a procurement forward one stage: to ORDERED, RECEIVED or RELEASED. Quantities can be partial (e.g. mark 1000 of 2000 as received). Moving to ORDERED REQUIRES an invoice number — if the user did not say it, ASK for the invoice number first.',
    risk: 'low',
    roles: [UserRole.ADMIN, UserRole.ACCESSORIES_MANAGER, UserRole.MANAGER, UserRole.TECH_MANAGER],
    parameters: {
      procurement_id: { type: 'string', description: 'Procurement id (from list_material_procurements)', required: true },
      to_stage: { type: 'string', description: 'ORDERED | RECEIVED | RELEASED', required: true },
      quantity: { type: 'number', description: 'Quantity to move', required: true },
      invoice_no: { type: 'string', description: 'Invoice number (required when to_stage is ORDERED)' },
      note: { type: 'string', description: 'Optional note' },
    },
    run: async (args, ctx) => {
      const toStage = String(args.to_stage || '').toUpperCase() as MaterialStage;
      if (![MaterialStage.ORDERED, MaterialStage.RECEIVED, MaterialStage.RELEASED].includes(toStage)) {
        return { error: 'to_stage must be ORDERED, RECEIVED or RELEASED.' };
      }
      const proc = await advanceProcurement(args.procurement_id, Number(args.quantity), toStage, {
        invoice_no: args.invoice_no || null,
        note: args.note,
        created_by_name: ctx.actor,
      });
      await logActivity({
        actor: ctx.actor,
        actor_role: ctx.role,
        source: ctx.source || 'ai',
        action: 'procurement.advance',
        entity_table: 'material_procurements',
        entity_id: proc.id,
        summary: `Moved ${args.quantity} ${proc.unit} of ${proc.material_name} to ${toStage}`,
        risk: 'low',
        before: null,
        after: proc,
      });
      return { ok: true, procurement: proc };
    },
  },

  // ---------- HIGH (needs human approval) ----------
  {
    name: 'create_material_request',
    description: 'Raise a new material request against an order.',
    risk: 'high',
    roles: [UserRole.ADMIN, UserRole.ACCESSORIES_MANAGER, UserRole.MANAGER, UserRole.TECH_MANAGER],
    parameters: {
      order_id: { type: 'string', description: 'Order id', required: true },
      material_content: { type: 'string', description: 'Material description', required: true },
      quantity_requested: { type: 'number', description: 'Quantity', required: true },
      unit: { type: 'string', description: 'Unit of measure (default Nos)' },
    },
    run: async (args, ctx) => {
      await createMaterialRequest({
        order_id: args.order_id,
        material_content: args.material_content,
        quantity_requested: args.quantity_requested,
        unit: args.unit || 'Nos',
      });
      await logActivity({
        actor: ctx.actor,
        actor_role: ctx.role,
        source: ctx.source || 'ai',
        action: 'material_request.create',
        entity_table: 'material_requests',
        entity_id: args.order_id,
        summary: `Material request: ${args.quantity_requested} ${args.unit || 'Nos'} of ${args.material_content}`,
        risk: 'high',
        before: null,
        after: args,
      });
      return { ok: true };
    },
  },
  {
    name: 'advance_order_status',
    description: 'Move an order to its next workflow status.',
    risk: 'high',
    roles: [UserRole.ADMIN, UserRole.MANAGER, UserRole.TECH_MANAGER],
    parameters: { order_id: { type: 'string', description: 'Order id', required: true } },
    run: async (args, ctx) => {
      const orders = await fetchOrders();
      const order = orders.find((o) => o.id === args.order_id);
      if (!order) return { error: 'Order not found' };
      const next = getNextOrderStatus(order.status);
      if (!next) return { error: 'Order is already at a terminal status' };
      await updateOrderStatus(args.order_id, next);
      await logActivity({
        actor: ctx.actor,
        actor_role: ctx.role,
        source: ctx.source || 'ai',
        action: 'order.advance_status',
        entity_table: 'orders',
        entity_id: args.order_id,
        summary: `Status ${order.status} -> ${next}`,
        risk: 'high',
        before: { id: order.id, status: order.status },
        after: { id: order.id, status: next },
      });
      return { ok: true, status: next };
    },
  },
];

/** Tools a given role is allowed to see/use. */
export const getToolsForRole = (role: UserRole): AITool[] =>
  TOOLS.filter((t) => isPrivileged(role) || t.roles.length === 0 || t.roles.includes(role));

/** Look up a tool by name. */
export const getTool = (name: string): AITool | undefined => TOOLS.find((t) => t.name === name);

/**
 * Execute a tool with full governance:
 *  - role permission check
 *  - high-risk actions blocked until ctx.approved is true
 *  - reads/low writes run immediately
 */
export const executeTool = async (
  name: string,
  args: Record<string, any>,
  ctx: ToolContext
): Promise<ToolResult> => {
  const tool = getTool(name);
  if (!tool) return { status: 'error', error: `Unknown tool: ${name}` };

  const allowed = isPrivileged(ctx.role) || tool.roles.length === 0 || tool.roles.includes(ctx.role);
  if (!allowed) return { status: 'forbidden', reason: `Role ${ctx.role} cannot use ${name}` };

  if (tool.risk === 'high' && !ctx.approved) {
    return { status: 'needs_approval', tool: name, risk: tool.risk, args };
  }

  try {
    const data = await tool.run(args, ctx);
    return { status: 'ok', data };
  } catch (err: any) {
    return { status: 'error', error: err.message };
  }
};

/** Compact schema list to hand to an LLM for function-calling. */
export const getToolSchemas = (role: UserRole) =>
  getToolsForRole(role).map((t) => ({
    name: t.name,
    description: t.description,
    risk: t.risk,
    parameters: t.parameters,
  }));
