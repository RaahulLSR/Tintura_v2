
export enum UserRole {
  ADMIN = 'ADMIN',                           // The MD — full access
  TECH_MANAGER = 'TECH_MANAGER',             // System / tech governance
  MANAGER = 'MANAGER',                       // Sub-unit ops + production + sales desk
  ACCESSORIES_MANAGER = 'ACCESSORIES_MANAGER', // Materials / accessories procurement
  ACCOUNTS_INVENTORY = 'ACCOUNTS_INVENTORY', // Accounts + inventory
}

export interface AppUser {
  id: string | number;
  username: string;
  role: UserRole;
  full_name: string;
  telegram_chat_id?: string | null;
}

export enum OrderStatus {
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS', 
  QC = 'QC', 
  QC_APPROVED = 'QC_APPROVED', 
  PACKED = 'PACKED',
  COMPLETED = 'COMPLETED'
}

export enum MaterialStatus {
  PENDING = 'PENDING',
  PARTIALLY_APPROVED = 'PARTIALLY_APPROVED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED'
}

export interface Unit {
  id: number;
  name: string;
  is_main: boolean;
}

export interface SizeBreakdown {
  color: string;
  s?: number;
  m?: number;
  l?: number;
  xl?: number;
  xxl?: number;
  xxxl?: number;
  [key: string]: any;
}

export interface Attachment {
  name: string;
  url: string;
  type: 'image' | 'document';
}

export interface RequirementDetail {
  label: string;
  count: number;
  calc: number;
  text: string;
  attachments: Attachment[];
}

export interface DetailedRequirement {
  name: string;
  total: number;
  breakdown: RequirementDetail[];
}

export interface Order {
  id: string;
  order_no: string;
  unit_id: number;
  style_number: string;
  quantity: number;
  box_count?: number; 
  actual_box_count?: number; 
  attachments?: Attachment[]; 
  attachment_url?: string; 
  attachment_name?: string; 
  qc_attachment_url?: string; 
  size_breakdown?: SizeBreakdown[]; 
  completion_breakdown?: SizeBreakdown[]; 
  material_forecast?: DetailedRequirement[];
  description: string;
  qc_notes?: string; 
  ai_issue_summary?: string | null;
  ai_issue_summary_generated_at?: string | null;
  target_delivery_date: string; 
  status: OrderStatus;
  created_at?: string;
  size_format?: 'standard' | 'numeric';
  size_sequence?: string[]; // Custom order of size labels
}

// --- Style Database Types ---
export type ConsumptionType = 'items_per_pc' | 'pcs_per_item';

export interface TechPackSizeVariant {
  sizes: string[];
  text: string;
  attachments: Attachment[];
  consumption_type?: ConsumptionType;
  consumption_val?: number;
}

export interface TechPackVariant {
  colors: string[]; // Selected colors for this specific variant instruction
  text: string;
  attachments: Attachment[];
  sizeVariants?: TechPackSizeVariant[]; // support for nested size-specific splits
  consumption_type?: ConsumptionType;
  consumption_val?: number;
}

export interface TechPackItem {
  text: string;
  attachments: Attachment[];
  variants?: TechPackVariant[]; // support for color-specific splits
  consumption_type?: ConsumptionType;
  consumption_val?: number;
}

export interface StyleCategory {
  name: string;
  fields: string[];
}

export interface Style {
  id: string;
  style_number: string;
  category: string;
  packing_type: string;
  pcs_per_box: number;
  style_text: string;
  tech_pack: Record<string, Record<string, TechPackItem>>;
  created_at?: string;
  garment_type?: string;
  demographic?: string;
  available_colors?: string[];
  available_sizes?: string[];
  size_type?: 'letter' | 'number';
}

// Reserved tech_pack keys (stored inside the tech_pack JSONB to avoid schema changes).
// POSTER holds the digital-asset poster images + the selected main/profile image.
// CUSTOM holds per-style ad-hoc extra tech-pack items beyond the standard template.
export const POSTER_KEY = '__poster__';
export const CUSTOM_KEY = '__custom__';

export interface StylePoster {
  images: Attachment[];
  mainUrl?: string;
}

export const getStylePoster = (style: { tech_pack?: any } | null | undefined): StylePoster => {
  const raw = style?.tech_pack?.[POSTER_KEY];
  if (raw && Array.isArray(raw.images)) {
    return { images: raw.images as Attachment[], mainUrl: typeof raw.mainUrl === 'string' ? raw.mainUrl : undefined };
  }
  return { images: [] };
};

export const getStyleMainImage = (style: { tech_pack?: any } | null | undefined): string | undefined => {
  const p = getStylePoster(style);
  return p.mainUrl || p.images[0]?.url;
};

export const getStyleCustomItems = (style: { tech_pack?: any } | null | undefined): Record<string, TechPackItem> => {
  const raw = style?.tech_pack?.[CUSTOM_KEY];
  return (raw && typeof raw === 'object') ? raw as Record<string, TechPackItem> : {};
};

export interface StyleTemplate {
  id: number;
  config: StyleCategory[];
}

export interface BulkEditHistory {
  id: string;
  created_at: string;
  description: string;
  affected_count: number;
  snapshot: Record<string, Style>; // Map of styleId -> Style object (before state)
}
// --- End Style Database Types ---

export interface MaterialRequest {
  id: string;
  order_id?: string | null; // null/undefined = ad-hoc requisition not tied to an order
  requested_by_name?: string; 
  material_content: string;
  quantity_requested: number;
  quantity_approved: number;
  unit: string; 
  attachments?: Attachment[]; 
  status: MaterialStatus;
  created_at: string;
}

export interface MaterialApproval {
    id: number;
    request_id: string;
    qty_approved: number;
    created_at: string;
    approved_by_name?: string;
}

// --- Materials procurement (4-stage lifecycle) ---
// A procurement line tracks ONE material for ONE style/order, with its total
// quantity distributed across four stages. Partial quantities can sit in
// different stages at the same time (e.g. 2000 total = 1000 received, 500
// ordered, 500 still just requested).
export enum MaterialStage {
  REQUESTED = 'REQUESTED', // raised / needed
  ORDERED = 'ORDERED',     // purchase placed (invoice number required here)
  RECEIVED = 'RECEIVED',   // goods arrived
  RELEASED = 'RELEASED',   // released to the floor / consumed
}

export const MATERIAL_STAGE_ORDER: MaterialStage[] = [
  MaterialStage.REQUESTED,
  MaterialStage.ORDERED,
  MaterialStage.RECEIVED,
  MaterialStage.RELEASED,
];

export const MATERIAL_STAGE_LABEL: Record<MaterialStage, string> = {
  [MaterialStage.REQUESTED]: 'Requested',
  [MaterialStage.ORDERED]: 'Ordered',
  [MaterialStage.RECEIVED]: 'Received',
  [MaterialStage.RELEASED]: 'Released',
};

export const prevMaterialStage = (stage: MaterialStage): MaterialStage | null => {
  const i = MATERIAL_STAGE_ORDER.indexOf(stage);
  return i > 0 ? MATERIAL_STAGE_ORDER[i - 1] : null;
};

export const nextMaterialStage = (stage: MaterialStage): MaterialStage | null => {
  const i = MATERIAL_STAGE_ORDER.indexOf(stage);
  return i >= 0 && i < MATERIAL_STAGE_ORDER.length - 1 ? MATERIAL_STAGE_ORDER[i + 1] : null;
};

export interface MaterialProcurement {
  id: string;
  order_id: string | null;   // linked production order (style/PO), may be null
  style_number: string;      // denormalised for rollups + display
  material_name: string;     // e.g. "Black sewing thread (cone)"
  unit: string;              // cones / Nos / kg / m ...
  total_quantity: number;
  qty_requested: number;
  qty_ordered: number;
  qty_received: number;
  qty_released: number;
  invoice_no: string | null; // captured when first ordered
  note?: string;
  created_by_name?: string;
  created_at: string;
  updated_at?: string;
}

export interface MaterialMovement {
  id: number;
  procurement_id: string;
  from_stage: MaterialStage | 'NEW';
  to_stage: MaterialStage;
  qty: number;
  invoice_no?: string | null;
  note?: string;
  created_by_name?: string;
  created_at: string;
}

export const procurementStageQty = (p: MaterialProcurement, stage: MaterialStage): number => {
  switch (stage) {
    case MaterialStage.REQUESTED: return p.qty_requested;
    case MaterialStage.ORDERED: return p.qty_ordered;
    case MaterialStage.RECEIVED: return p.qty_received;
    case MaterialStage.RELEASED: return p.qty_released;
  }
};

export interface OrderLog {
    id: number;
    order_id: string;
    log_type: 'STATUS_CHANGE' | 'MANUAL_UPDATE' | 'CREATION';
    message: string;
    created_at: string;
    created_by_name?: string;
    attachments?: { url: string; name?: string }[];
}

export interface StockCommit {
  id: number;
  created_at: string;
  total_items: number;
  note?: string;
}

// Simple, QR-free inventory: one running quantity per style + colour + size.
export interface StockLevel {
  id?: number;
  style_number: string;
  color: string;
  size: string;        // size label, e.g. 'M' or '75'
  quantity: number;
  updated_at?: string;
}

// One committed line: completed pieces of a colour+size pushed into stock.
export interface StockCommitLine {
  color: string;
  size: string;   // size label, e.g. 'M' or '75'
  qty: number;
}

// A stock-commit event for a completed order. Partial or full, and undoable
// while recent. The breakdown is what was pushed into stock_levels.
export interface OrderStockCommit {
  id: string;
  order_id: string;
  style_number: string;
  breakdown: StockCommitLine[];
  total_items: number;
  created_by_name?: string;
  created_at: string;
  undone: boolean;
  undone_at?: string | null;
}

export interface Invoice {
  id: string;
  invoice_no: string;
  customer_name: string;
  total_amount: number;
  created_at: string;
}

// --- Sales: buyer purchase orders (matrix -> PO -> forward) ---
// One line = one style with quantities spread across size columns.
export interface SalesOrderLine {
  style_number: string;
  sizes: Record<string, number>; // size label -> qty
  total: number;
  rate?: number;   // optional price per piece
  amount?: number; // total * rate
  color?: string;  // optional specific colour; blank = pack of ALL colours
}

export type SalesOrderStatus = 'DRAFT' | 'FORWARDED' | 'CANCELLED';

export interface SalesOrder {
  id: string;
  po_number: string;
  po_date: string;          // YYYY-MM-DD
  buyer_name: string;
  size_format: 'standard' | 'numeric';
  size_labels: string[];    // columns used for this PO
  lines: SalesOrderLine[];
  total_qty: number;
  total_amount: number;
  note?: string;
  status: SalesOrderStatus;
  forwarded_at?: string | null;
  created_by_name?: string;
  created_at: string;
}

// Buyer registry — a reusable list of customers for POs + filtering.
export interface Buyer {
  id: string;
  name: string;
  contact?: string;
  note?: string;
  created_at?: string;
}

export const getNextOrderStatus = (current: OrderStatus): OrderStatus | null => {
  switch (current) {
    case OrderStatus.ASSIGNED: return OrderStatus.IN_PROGRESS;
    case OrderStatus.IN_PROGRESS: return OrderStatus.QC;
    case OrderStatus.QC: return OrderStatus.QC_APPROVED;
    case OrderStatus.QC_APPROVED: return OrderStatus.COMPLETED; 
    case OrderStatus.PACKED: return OrderStatus.COMPLETED;
    default: return null;
  }
};

export const formatOrderNumber = (order: Partial<Order>): string => {
  if (!order.order_no) return 'ORD-NEW';
  const numericMatch = order.order_no.match(/ORD-(\d+)/);
  const serial = numericMatch ? numericMatch[1] : order.order_no;
  const stylePart = order.style_number 
    ? order.style_number.split('-')[0].trim() 
    : 'STYLE';
  return `ORD-${stylePart}-${serial}`;
};

/**
 * Normalizes size strings for consistency.
 * 2XL -> XXL, 3XL -> XXXL, etc. Case-insensitive.
 */
export const normalizeSize = (size: string): string => {
  const s = size.trim().toUpperCase();
  if (s === '2XL') return 'XXL';
  if (s === '3XL') return 'XXXL';
  return s;
};

/**
 * Returns the property key in SizeBreakdown for a given label
 */
export const getSizeKeyFromLabel = (label: string, format: 'standard' | 'numeric' = 'standard'): string => {
  const norm = normalizeSize(label);
  
  if (format === 'numeric') {
    const numericLabels = ['65', '70', '75', '80', '85', '90'];
    const keys = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'];
    const idx = numericLabels.indexOf(norm);
    return idx !== -1 ? keys[idx] : norm;
  } else {
    const standardLabels = ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
    const keys = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'];
    const idx = standardLabels.indexOf(norm);
    if (idx !== -1) return keys[idx];
    
    // Check aliases
    if (norm === '2XL') return 'xxl';
    if (norm === 'XXXL') return 'xxxl';
    
    return norm;
  }
};

// --- AI Operations Layer / Governance Types ---

// Risk tiers govern whether an AI action runs automatically or needs approval.
export type RiskLevel = 'read' | 'low' | 'high';

// Append-only record of every state-changing action (AI or human) for audit + undo.
export interface ActivityRecord {
  id: string;
  created_at: string;
  actor: string;            // username or 'AI' / 'System'
  actor_role: UserRole | string;
  source: 'human' | 'ai';   // who initiated
  action: string;           // e.g. 'order.create', 'style.update'
  entity_table: string;     // affected table
  entity_id: string | null; // affected row id (null for bulk)
  summary: string;          // human-readable description
  risk: RiskLevel;
  before: any | null;       // snapshot before change (null for creates)
  after: any | null;        // snapshot after change (null for deletes)
  undone: boolean;          // true once reverted
}

// Central recycle bin so nothing is ever hard-deleted.
export interface DustbinRecord {
  id: string;
  created_at: string;
  entity_table: string;
  entity_id: string;
  snapshot: any;            // full row, for restore
  deleted_by: string;
  restored: boolean;
}

// Feature flags default to OFF unless an enabled row exists.
export interface FeatureToggle {
  key: string;
  enabled: boolean;
  description?: string;
  updated_at?: string;
  updated_by?: string;
}
