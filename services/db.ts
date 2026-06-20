
import { supabase } from './supabase.js';
// Export supabase for centralized access in components like AdminDashboard
export { supabase };
// Added formatOrderNumber to the imports from types
import { Order, OrderStatus, MaterialRequest, Unit, MaterialStatus, Invoice, SizeBreakdown, AppUser, UserRole, StockCommit, StockLevel, MaterialApproval, OrderLog, Attachment, Style, StyleTemplate, BulkEditHistory, formatOrderNumber, DetailedRequirement, ConsumptionType, getSizeKeyFromLabel, normalizeSize, MaterialProcurement, MaterialMovement, MaterialStage, MATERIAL_STAGE_ORDER, prevMaterialStage, OrderStockCommit, StockCommitLine, SalesOrder, SalesOrderLine, Buyer, POSTER_KEY } from '../types.js';
import { sizesEqual } from './sizes.js';

const API_BASE = (typeof window !== 'undefined' && (window.location.protocol === 'file:' || window.location.hostname === 'localhost'))
  ? 'https://tintura-mail.vercel.app'
  : '';

// --- Forecast Calculation Core Engine ---
export const calculateOrderForecast = (order: Order, style: Style): DetailedRequirement[] => {
  if (!style || !order.size_breakdown) return [];
  
  const detailedReqs: DetailedRequirement[] = [];
  const format = order.size_format || 'standard';
  
  // Use the sequence provided in the order, or default to standard slots
  const sizeLabels = order.size_sequence && order.size_sequence.length > 0 
    ? order.size_sequence 
    : (format === 'numeric' ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL']);

  const calculateVal = (qty: number, type: ConsumptionType, val: number) => !val ? 0 : (type === 'items_per_pc' ? qty * val : qty / val);

  for (const catName in style.tech_pack) {
    if (catName === POSTER_KEY) continue; // poster assets are not material fields
    for (const fieldName in style.tech_pack[catName]) {
      const item = style.tech_pack[catName][fieldName];
      const req: DetailedRequirement = { name: fieldName, total: 0, breakdown: [] };

      if (item.variants) {
        for (const variant of item.variants) {
          const matchingRows = order.size_breakdown.filter(r => variant.colors.includes(r.color));
          if (matchingRows.length === 0) continue;

          if (variant.sizeVariants) {
            for (const sv of variant.sizeVariants) {
              const svLabels = sv.sizes.map(s => normalizeSize(s));
              
              const qty = matchingRows.reduce((sum, row) => {
                let rowSum = 0;
                sizeLabels.forEach(label => {
                  if (svLabels.includes(normalizeSize(label))) {
                    const key = getSizeKeyFromLabel(label, format);
                    rowSum += (row[key] || 0);
                  }
                });
                return sum + rowSum;
              }, 0);
              
              if (qty > 0) {
                const rType = sv.consumption_type || variant.consumption_type || item.consumption_type || 'items_per_pc';
                const rVal = sv.consumption_val !== undefined ? sv.consumption_val : (variant.consumption_val !== undefined ? variant.consumption_val : (item.consumption_val || 0));
                const calc = calculateVal(qty, rType, rVal);
                
                req.breakdown.push({
                  label: `${variant.colors.join('/')} - ${sv.sizes.join('/')}`,
                  count: qty,
                  calc: Math.ceil(calc * 100) / 100,
                  text: sv.text || variant.text || item.text,
                  attachments: sv.attachments.length > 0 ? sv.attachments : (variant.attachments.length > 0 ? variant.attachments : item.attachments)
                });
                req.total += calc;
              }
            }
          } else if (variant.consumption_type) {
            const qty = matchingRows.reduce((sum, row) => {
               let rowTotal = 0;
               sizeLabels.forEach(label => {
                 const key = getSizeKeyFromLabel(label, format);
                 rowTotal += (row[key] || 0);
               });
               return sum + rowTotal;
            }, 0);
            const calc = calculateVal(qty, variant.consumption_type, variant.consumption_val || 0);
            req.breakdown.push({
              label: `Color: ${variant.colors.join('/')}`,
              count: qty,
              calc: Math.ceil(calc * 100) / 100,
              text: variant.text || item.text,
              attachments: variant.attachments.length > 0 ? variant.attachments : item.attachments
            });
            req.total += calc;
          }
        }
      } else if (item.consumption_type) {
        const calc = calculateVal(order.quantity, item.consumption_type, item.consumption_val || 0);
        req.breakdown.push({
          label: "Global Requirement",
          count: order.quantity,
          calc: Math.ceil(calc * 100) / 100,
          text: item.text,
          attachments: item.attachments
        });
        req.total = calc;
      }

      if (req.total > 0) {
        req.total = Math.ceil(req.total * 100) / 100;
        detailedReqs.push(req);
      }
    }
  }
  return detailedReqs;
};

// --- Generic History Helpers ---
const recordHistory = async (table: string, description: string, items: any[]): Promise<void> => {
  if (items.length === 0) return;
  const snapshot: Record<string, any> = {};
  items.forEach(item => { snapshot[item.id] = item; });
  const { error } = await supabase.from(table).insert([{
    description,
    affected_count: items.length,
    snapshot
  }]);
  if (error) console.error(`History recording failed for ${table}:`, error.message);
};

const undoHistory = async (historyTable: string, targetTable: string, historyId: string): Promise<{ success: boolean; error?: string }> => {
  const { data: history, error: fetchError } = await supabase.from(historyTable).select('*').eq('id', historyId).single();
  if (fetchError || !history) return { success: false, error: 'History record not found' };

  const snapshot = history.snapshot as Record<string, any>;
  const objects = Object.values(snapshot);

  try {
    // Perform a batch upsert to ensure all records are restored atomically
    const { error: upsertError } = await supabase.from(targetTable).upsert(objects);
    if (upsertError) throw upsertError;

    await supabase.from(historyTable).delete().eq('id', historyId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};

// --- Style Database Services ---
export const fetchStyles = async (): Promise<Style[]> => {
  const { data, error } = await supabase.from('styles').select('*').order('style_number', { ascending: true });
  if (error || !data) return [];
  return data as Style[];
};

export const fetchStyleByNumber = async (styleNum: string): Promise<Style | null> => {
    const { data, error } = await supabase.from('styles').select('*').eq('style_number', styleNum).maybeSingle();
    if (error || !data) return null;
    return data as Style;
};

export const upsertStyle = async (style: Partial<Style>): Promise<{ data: Style | null, error: string | null }> => {
  const { data, error } = await supabase.from('styles').upsert([style]).select().single();
  if (error) return { data: null, error: error.message };
  return { data: data as Style, error: null };
};

export const deleteStyle = async (id: string): Promise<void> => {
  await supabase.from('styles').delete().eq('id', id);
};

export const fetchStyleTemplate = async (): Promise<StyleTemplate | null> => {
  const { data, error } = await supabase.from('style_templates').select('*').eq('id', 1).single();
  if (error || !data) return null;
  return data as StyleTemplate;
};

export const updateStyleTemplate = async (config: any[]): Promise<void> => {
  await supabase.from('style_templates').upsert([{ id: 1, config, updated_at: new Date().toISOString() }]);
};

// --- Style History ---
export const recordBulkEditHistory = (desc: string, styles: Style[]) => recordHistory('bulk_edit_history', desc, styles);
export const fetchBulkEditHistory = async () => {
  const { data } = await supabase.from('bulk_edit_history').select('*').order('created_at', { ascending: false }).limit(50);
  return (data || []) as BulkEditHistory[];
};
export const undoBulkEdit = (id: string) => undoHistory('bulk_edit_history', 'styles', id);

// --- Order History ---
export const recordOrderEditHistory = (desc: string, orders: Order[]) => recordHistory('order_edit_history', desc, orders);
export const fetchOrderEditHistory = async () => {
  const { data } = await supabase.from('order_edit_history').select('*').order('created_at', { ascending: false }).limit(50);
  return (data || []) as BulkEditHistory[];
};
export const undoOrderEdit = (id: string) => undoHistory('order_edit_history', 'orders', id);

// --- Order Services ---
export const fetchOrders = async (): Promise<Order[]> => {
  const { data, error } = await supabase.from('orders').select('*').or('deleted.eq.false,deleted.is.null').order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as Order[];
};

export const syncAllOrdersWithStyles = async (): Promise<{ updated: number; total: number }> => {
  const orders = await fetchOrders();
  const styles = await fetchStyles();
  let updatedCount = 0;

  for (const order of orders) {
    const stylePrefix = order.style_number.split(' - ')[0].trim();
    const match = styles.find(s => s.style_number.trim().toLowerCase() === stylePrefix.toLowerCase());

    if (match) {
      const canonicalStyleName = `${match.style_number} - ${match.style_text}`;
      const canonicalSizeFormat = match.size_type === 'number' ? 'numeric' : 'standard';
      const recalculatedForecast = calculateOrderForecast(order, match);

      // Check if data actually needs an update to prevent redundant writes
      const needsUpdate = 
        order.style_number !== canonicalStyleName || 
        order.size_format !== canonicalSizeFormat ||
        JSON.stringify(order.material_forecast) !== JSON.stringify(recalculatedForecast);

      if (needsUpdate) {
        const { error } = await supabase.from('orders').update({
          style_number: canonicalStyleName,
          size_format: canonicalSizeFormat,
          material_forecast: recalculatedForecast
        }).eq('id', order.id);

        if (!error) {
          updatedCount++;
          await addOrderLog(order.id, 'MANUAL_UPDATE', `Master Sync: Material forecasts and style blueprint recalculated from Database.`);
        }
      }
    }
  }

  return { updated: updatedCount, total: orders.length };
};

export const updateOrderDetails = async (orderId: string, updates: Partial<Order>): Promise<{ success: boolean; error: string | null }> => {
    // Record history for single order update
    const { data: original } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (original) await recordOrderEditHistory(`Individual Update: ${formatOrderNumber(original)}`, [original]);

    const payload: any = {};
    const allowedKeys = ['style_number', 'unit_id', 'quantity', 'description', 'target_delivery_date', 'size_breakdown', 'size_format', 'attachments', 'box_count', 'material_forecast', 'size_sequence'];
    allowedKeys.forEach(k => { if ((updates as any)[k] !== undefined) payload[k] = (updates as any)[k]; });
    const { error } = await supabase.from('orders').update(payload).eq('id', orderId);
    if (error) return { success: false, error: error.message };
    await addOrderLog(orderId, 'MANUAL_UPDATE', 'Order details revised by Admin.');
    return { success: true, error: null };
};

export const createOrder = async (order: Partial<Order>): Promise<{ data: Order | null, error: string | null }> => {
    const { data: seqValue, error: seqError } = await supabase.rpc('next_order_no');
    if (seqError || !seqValue) return { data: null, error: 'Failed to generate order number' };
    const orderNo = `ORD-${seqValue}`;
    const payload: any = {
        order_no: orderNo,
        unit_id: order.unit_id,
        style_number: order.style_number,
        quantity: order.quantity,
        size_breakdown: order.size_breakdown,
        description: order.description,
        target_delivery_date: order.target_delivery_date,
        status: OrderStatus.ASSIGNED,
        deleted: false
    };
    const optionalKeys: (keyof Order)[] = ['box_count', 'size_format', 'attachments', 'size_sequence'];
    optionalKeys.forEach(key => { if (order[key] !== undefined) payload[key] = order[key]; });
    const { data, error } = await supabase.from('orders').insert([payload]).select().single();
    if (error) return { data: null, error: error.message };
    if (data) await addOrderLog(data.id, 'CREATION', `Order #${orderNo} Launched.`);
    return { data: data as Order, error: null };
};

export const deleteOrder = async (orderId: string): Promise<void> => {
    await supabase.from('orders').update({ deleted: true }).eq('id', orderId);
};

export const updateOrderStatus = async (orderId: string, status: OrderStatus, notes?: string, completionData?: any, qcAttachmentUrl?: string): Promise<void> => {
   const payload: any = { status, qc_notes: notes };
   if (completionData) {
       payload.completion_breakdown = completionData.completion_breakdown;
       payload.actual_box_count = completionData.actual_box_count;
   }
   if (qcAttachmentUrl) payload.qc_attachment_url = qcAttachmentUrl;
   await supabase.from('orders').update(payload).eq('id', orderId);
   await addOrderLog(orderId, 'STATUS_CHANGE', `Status: ${status}${notes ? ` - ${notes}` : ''}`);
};

// --- Other Services ---
export const triggerOrderEmail = async (orderId: string, isEdit: boolean = false): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await fetch(`${API_BASE}/api/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, is_edit: isEdit })
    });
    const result = await response.json();
    return { success: response.ok, message: result.message };
  } catch (error) {
    return { success: false, message: 'Network error triggering email.' };
  }
};

export const triggerMaterialEmail = async (orderId: string): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await fetch(`${API_BASE}/api/send-material-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId })
    });
    const result = await response.json();
    return { success: response.ok, message: result.message };
  } catch (error) {
    return { success: false, message: 'Network error triggering material email.' };
  }
};

/**
 * Email a generated document (PO PDF / completion report) to every user of a
 * role — the email counterpart of `deliverSstDocument` so documents land in
 * both the Tintura SST inbox AND the recipients' mailboxes.
 */
export const triggerDocEmail = async (params: {
  targetRole: string;
  subject: string;
  heading: string;
  intro: string;
  pdfUrl: string;
  pdfLabel?: string;
}): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await fetch(`${API_BASE}/api/send-doc-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const result = await response.json().catch(() => ({}));
    return { success: response.ok, message: result.message || '' };
  } catch (error) {
    return { success: false, message: 'Network error triggering document email.' };
  }
};

// Posts a PO/order alert into the Tintura Chat "PO & Orders" channel as a bot
// message with quick-action buttons. Shares the same Supabase project as the
// chat app, so the alert appears live for Inventory / Accounts / Managers.
const CHAT_PUSH_ENDPOINT = 'https://tintura-chat.vercel.app/api/push-send';

export const postOrderToChat = async (order: Order): Promise<void> => {
  try {
    const { data: ch } = await supabase
      .from('chat_channels')
      .select('id')
      .eq('slug', 'po-orders')
      .single();
    if (!ch) return;

    const orderNo = order.order_no || 'NEW';
    const due = order.target_delivery_date || 'TBD';
    const body =
      `🧾 New Production Order ${orderNo}\n` +
      `Style: ${order.style_number}\n` +
      `Qty: ${order.quantity} units\n` +
      `Due: ${due}`;

    await supabase.from('chat_messages').insert({
      channel_id: ch.id,
      sender_name: 'Tintura Bot',
      sender_role: 'BOT',
      kind: 'bot',
      body,
      buttons: [
        { label: '✅ Acknowledge', action: 'ack_order', value: String(order.id), variant: 'success' },
        { label: '📦 Inventory Noted', action: 'inventory_noted', value: String(order.id), variant: 'primary' },
        { label: '⚠️ Flag Issue', action: 'flag_order', value: String(order.id), variant: 'danger' },
      ],
      meta: { order_id: order.id, order_no: orderNo, style: order.style_number },
    });

    // Best-effort push so phones buzz even when the chat app is closed.
    fetch(CHAT_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel_slug: 'po-orders',
        title: `New Order ${orderNo}`,
        body: `${order.style_number} · ${order.quantity} units · due ${due}`,
      }),
    }).catch(() => {});
  } catch (e) {
    console.warn('postOrderToChat failed', e);
  }
};

/**
 * Deliver a document (PO PDF, completion report, …) to every user of a role,
 * INDIVIDUALLY into their own private "Tintura SST" inbox channel (slug
 * `sst-<userId>`). The SST persona is a virtual system sender, so each person
 * receives the file privately and it persists across sessions.
 */
export const deliverSstDocument = async (params: {
  targetRole: string;
  title: string;
  body: string;
  card?: any;
  buttons?: any[];
  pushBody?: string;
}): Promise<void> => {
  try {
    const { data: users } = await supabase
      .from('app_users')
      .select('id')
      .eq('role', params.targetRole);
    if (!users || users.length === 0) return;

    for (const u of users as any[]) {
      const slug = `sst-${u.id}`;
      // Ensure the user's personal inbox channel exists (ignored on conflict).
      await supabase
        .from('chat_channels')
        .insert({
          name: 'Tintura SST',
          slug,
          description: 'Your documents & reports',
          allowed_roles: [],
          position: -1,
        })
        .then(() => undefined, () => undefined);
      const { data: ch } = await supabase
        .from('chat_channels')
        .select('id')
        .eq('slug', slug)
        .single();
      if (!ch) continue;

      await supabase.from('chat_messages').insert({
        channel_id: ch.id,
        sender_name: 'Tintura SST',
        sender_role: 'SYSTEM',
        kind: 'bot',
        body: params.body,
        buttons: params.buttons && params.buttons.length ? params.buttons : null,
        meta: params.card ? { card: params.card } : null,
      });
    }

    // Best-effort push so the recipients' phones buzz.
    fetch(CHAT_PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_role: params.targetRole,
        title: params.title,
        body: params.pushBody || params.body,
      }),
    }).catch(() => {});
  } catch (e) {
    console.warn('deliverSstDocument failed', e);
  }
};

const ERP_PUBLIC_BASE = 'https://tintura-sst.vercel.app';

/**
 * Fan a short message — or a document (PDF) attachment — out to Telegram for a
 * role (and/or explicit chat ids). Hits the ERP deployment which holds
 * TELEGRAM_BOT_TOKEN. Best-effort.
 */
export const notifyTelegram = async (params: { targetRole?: string; chatIds?: string[]; text?: string; documentUrl?: string; caption?: string }): Promise<void> => {
  try {
    await fetch(`${ERP_PUBLIC_BASE}/api/notify-telegram`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch (e) {
    console.warn('notifyTelegram failed', e);
  }
};

/** Deliver a completed order's completion report to Admin's Tintura SST inbox. */
export const deliverCompletionReport = async (order: Order): Promise<void> => {
  const orderNo = formatOrderNumber(order);
  const pdfUrl = `${ERP_PUBLIC_BASE}/api/completion-report?id=${encodeURIComponent(String(order.id))}`;
  await deliverSstDocument({
    targetRole: 'ADMIN',
    title: `Completion report ${orderNo}`,
    body: `📄 Order completion report — ${orderNo}\nStyle: ${order.style_number}\nPieces: ${order.quantity}`,
    pushBody: `${orderNo} · ${order.style_number} completed`,
    card: {
      type: 'pdf',
      title: `Completion · ${orderNo}`,
      subtitle: `${order.style_number} · ${order.quantity} pcs`,
      pdfUrl,
      label: '📄 Open completion report',
    },
  });
  // Email a copy to Admin as well (channel + email).
  triggerDocEmail({
    targetRole: 'ADMIN',
    subject: `Order completion report — ${orderNo}`,
    heading: `Order Completion Report ${orderNo}`,
    intro: `Order ${orderNo} (${order.style_number}) has been completed and committed to inventory.`,
    pdfUrl,
    pdfLabel: 'Open completion report',
  }).catch(() => {});
};

export const authenticateUser = async (username: string, password: string): Promise<AppUser | null> => {
    const { data, error } = await supabase.from('app_users').select('*').eq('username', username).eq('password', password).single();
    if (error || !data) return null;
    return { id: data.id, username: data.username, role: data.role as UserRole, full_name: data.full_name, telegram_chat_id: data.telegram_chat_id ?? null };
};

/** All app users with their roles + linked Telegram chat id (Control Center). */
export const fetchAppUsers = async (): Promise<AppUser[]> => {
    const { data, error } = await supabase
        .from('app_users')
        .select('id, username, role, full_name, telegram_chat_id')
        .order('username');
    if (error || !data) return [];
    return (data as any[]).map((u) => ({
        id: u.id,
        username: u.username,
        role: u.role as UserRole,
        full_name: u.full_name,
        telegram_chat_id: u.telegram_chat_id ?? null,
    }));
};

/** Link (or clear) a user's Telegram chat id so the bot honours their access level. */
export const setUserTelegramChatId = async (
    id: string | number,
    chatId: string | null
): Promise<{ success: boolean; error?: string }> => {
    const value = chatId && chatId.trim() ? chatId.trim() : null;
    const { error } = await supabase.from('app_users').update({ telegram_chat_id: value }).eq('id', id);
    if (error) return { success: false, error: error.message };
    return { success: true };
};

export const fetchOrderLogs = async (orderId?: string): Promise<OrderLog[]> => {
    let query = supabase.from('order_logs').select('*').order('created_at', { ascending: false });
    if (orderId) query = query.eq('order_id', orderId);
    const { data, error } = await query;
    if (error || !data) return [];
    return data as OrderLog[];
};

export const addOrderLog = async (orderId: string, type: 'STATUS_CHANGE' | 'MANUAL_UPDATE' | 'CREATION', message: string, createdBy = 'System', attachments: { url: string; name?: string }[] = []) => {
    await supabase.from('order_logs').insert([{ order_id: orderId, log_type: type, message: message, created_by_name: createdBy, attachments }]);
};

export const fetchUnits = async (): Promise<Unit[]> => {
    const { data, error } = await supabase.from('units').select('*').order('id');
    if (error || !data) return [];
    return data as Unit[];
};

export const fetchMaterialRequests = async (): Promise<MaterialRequest[]> => {
    const { data, error } = await supabase.from('material_requests').select('*').order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as MaterialRequest[];
};

export const createMaterialRequest = async (req: Partial<MaterialRequest>) => {
    await supabase.from('material_requests').insert([{
        order_id: req.order_id,
        material_content: req.material_content,
        quantity_requested: req.quantity_requested,
        unit: req.unit || 'Nos',
        attachments: req.attachments || [], 
        status: MaterialStatus.PENDING
    }]);
};

export const updateMaterialRequest = async (id: string, updates: Partial<MaterialRequest>) => {
    await supabase.from('material_requests').update(updates).eq('id', id);
};

export const deleteMaterialRequest = async (id: string) => {
    await supabase.from('material_requests').delete().eq('id', id);
};

export const fetchMaterialApprovals = async (requestId: string): Promise<MaterialApproval[]> => {
    const { data, error } = await supabase.from('material_approvals').select('*').eq('request_id', requestId).order('created_at', { ascending: true });
    if (error || !data) return [];
    return data as MaterialApproval[];
};

export const approveMaterialRequest = async (id: string, qtyApprovedNow: number, currentTotalApproved: number, newStatus: MaterialStatus) => {
    await supabase.from('material_approvals').insert([{ request_id: id, qty_approved: qtyApprovedNow, approved_by_name: 'Materials Dept' }]);
    await supabase.from('material_requests').update({ quantity_approved: currentTotalApproved + qtyApprovedNow, status: newStatus }).eq('id', id);
};

export const fetchStockCommits = async (): Promise<StockCommit[]> => {
    const { data, error } = await supabase.from('stock_commits').select('*').order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as StockCommit[];
};

export const fetchInvoices = async (): Promise<Invoice[]> => {
    const { data, error } = await supabase.from('invoices').select('*').order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as Invoice[];
};

// ---- Sales purchase orders (buyer matrix -> PO -> forward) ----
export const fetchBuyers = async (): Promise<Buyer[]> => {
    const { data, error } = await supabase.from('buyers').select('*').order('name');
    if (error || !data) return [];
    return data as Buyer[];
};

/** Add or update a buyer by name (case-preserved, de-duplicated on name). */
export const upsertBuyer = async (name: string, contact?: string, note?: string): Promise<Buyer | null> => {
    const clean = (name || '').trim();
    if (!clean) return null;
    const row: Record<string, any> = { name: clean };
    if (contact !== undefined) row.contact = contact || null;
    if (note !== undefined) row.note = note || null;
    const { data, error } = await supabase.from('buyers').upsert(row, { onConflict: 'name' }).select().single();
    if (error) { console.error('upsertBuyer', error); return null; }
    return data as Buyer;
};

export const deleteBuyer = async (id: string): Promise<void> => {
    await supabase.from('buyers').delete().eq('id', id);
};

export const fetchSalesOrders = async (statusFilter?: string): Promise<SalesOrder[]> => {
    let q = supabase.from('sales_orders').select('*').order('created_at', { ascending: false });
    if (statusFilter) q = q.eq('status', statusFilter);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as SalesOrder[];
};

export const createSalesOrder = async (input: {
    po_number: string;
    po_date: string;
    buyer_name: string;
    size_format: 'standard' | 'numeric';
    size_labels: string[];
    lines: SalesOrderLine[];
    note?: string;
    created_by_name?: string;
}): Promise<SalesOrder> => {
    const lines = (input.lines || []).filter((l) => l.total > 0);
    if (!input.buyer_name.trim()) throw new Error('Buyer name is required.');
    if (lines.length === 0) throw new Error('Add at least one style with quantities.');

    // Auto-assign a sequential PO number when none was supplied.
    let poNumber = (input.po_number || '').trim();
    if (!poNumber || /^auto$/i.test(poNumber)) {
        try {
            const { data: seq } = await supabase.rpc('next_po_no');
            const n = typeof seq === 'number' ? seq : parseInt(String(seq ?? ''), 10);
            poNumber = n ? `PO-${String(n).padStart(4, '0')}` : `PO-${Date.now()}`;
        } catch {
            poNumber = `PO-${Date.now()}`;
        }
    }

    const total_qty = lines.reduce((s, l) => s + l.total, 0);
    const total_amount = lines.reduce((s, l) => s + (l.amount || 0), 0);

    const { data, error } = await supabase
        .from('sales_orders')
        .insert([{
            po_number: poNumber,
            po_date: input.po_date,
            buyer_name: input.buyer_name.trim(),
            size_format: input.size_format,
            size_labels: input.size_labels,
            lines,
            total_qty,
            total_amount,
            note: input.note || null,
            status: 'DRAFT',
            created_by_name: input.created_by_name || null,
        }])
        .select()
        .single();
    if (error || !data) throw new Error(error?.message || 'Failed to create PO.');
    // Keep the buyer registry up to date for future POs + filtering.
    upsertBuyer(input.buyer_name).catch(() => {});
    // Deliver the PO PDF privately to every Accounts user's Tintura SST inbox.
    deliverSstDocument({
        targetRole: 'ACCOUNTS_INVENTORY',
        title: `New PO ${(data as SalesOrder).po_number}`,
        body: `🧾 New purchase order ${(data as SalesOrder).po_number}\nBuyer: ${(data as SalesOrder).buyer_name}\nPieces: ${(data as SalesOrder).total_qty}`,
        pushBody: `${(data as SalesOrder).po_number} · ${(data as SalesOrder).buyer_name}`,
        card: {
            type: 'pdf',
            title: (data as SalesOrder).po_number,
            subtitle: `${(data as SalesOrder).buyer_name} · ${(data as SalesOrder).total_qty} pcs`,
            pdfUrl: `${ERP_PUBLIC_BASE}/api/po-pdf?id=${encodeURIComponent(String((data as SalesOrder).id))}`,
            label: '📄 Open PO PDF',
        },
    }).catch(() => {});
    // Email a copy to Accounts as well (channel + email).
    triggerDocEmail({
        targetRole: 'ACCOUNTS_INVENTORY',
        subject: `New PO ${(data as SalesOrder).po_number} — ${(data as SalesOrder).buyer_name}`,
        heading: `Purchase Order ${(data as SalesOrder).po_number}`,
        intro: `A new purchase order has been raised for ${(data as SalesOrder).buyer_name} (${(data as SalesOrder).total_qty} pcs).`,
        pdfUrl: `${ERP_PUBLIC_BASE}/api/po-pdf?id=${encodeURIComponent(String((data as SalesOrder).id))}`,
        pdfLabel: 'Open PO PDF',
    }).catch(() => {});
    return data as SalesOrder;
};

/**
 * Deducts a forwarded PO's quantities from on-hand inventory.
 * Pack model: a quantity for a size is removed from EVERY colour of that
 * style+size (1 pc sold = 1 pc removed from each colour). If a line specifies a
 * colour, only that colour is deducted. Sizes are matched leniently so a PO in
 * letters still deducts stock recorded in numbers (and vice-versa).
 */
const dispatchSalesOrderStock = async (po: SalesOrder): Promise<{ zeroed: { style: string; color: string; size: string }[] }> => {
    const levels = await fetchStockLevels();
    const zeroed: { style: string; color: string; size: string }[] = [];
    for (const line of po.lines || []) {
        const styleNo = (line.style_number || '').trim();
        if (!styleNo) continue;
        const rows = levels.filter((r) => r.style_number === styleNo);
        if (!rows.length) continue;
        for (const [sizeLabel, qtyRaw] of Object.entries(line.sizes || {})) {
            const q = Number(qtyRaw) || 0;
            if (q <= 0) continue;
            let matches = rows.filter((r) => sizesEqual(r.size, sizeLabel));
            if (line.color) {
                const c = line.color.toLowerCase();
                matches = matches.filter((r) => (r.color || '').toLowerCase() === c);
            }
            for (const row of matches) {
                const newQty = await adjustStockLevel(styleNo, row.color, row.size, -q);
                if (newQty === 0) zeroed.push({ style: styleNo, color: row.color, size: row.size });
            }
        }
    }
    return { zeroed };
};

/** Post a forwarded PO into Accounts/Inventory's chat inbox AND Telegram. */
const notifyForwardedPo = async (po: SalesOrder): Promise<void> => {
    const pdfUrl = `${ERP_PUBLIC_BASE}/api/po-pdf?id=${encodeURIComponent(String(po.id))}`;
    await deliverSstDocument({
        targetRole: 'ACCOUNTS_INVENTORY',
        title: `PO ${po.po_number} forwarded`,
        body: `📦 PO ${po.po_number} forwarded to Inventory & Accounts\nBuyer: ${po.buyer_name}\nPieces: ${po.total_qty}`,
        pushBody: `${po.po_number} · ${po.buyer_name} · ${po.total_qty} pcs forwarded`,
        card: {
            type: 'pdf',
            title: po.po_number,
            subtitle: `${po.buyer_name} · ${po.total_qty} pcs · FORWARDED`,
            pdfUrl,
            label: '📄 Open PO PDF',
        },
    }).catch(() => {});
    await notifyTelegram({
        targetRole: 'ACCOUNTS_INVENTORY',
        documentUrl: pdfUrl,
        caption: `📦 PO ${po.po_number} forwarded\nBuyer: ${po.buyer_name}\nPieces: ${po.total_qty}`,
    }).catch(() => {});
};

/** Alert Admin (chat inbox + Telegram) about stock lines that hit zero. */
const notifyStockCompleted = async (po: SalesOrder, zeroed: { style: string; color: string; size: string }[]): Promise<void> => {
    if (!zeroed.length) return;
    const lines = zeroed.map((z) => `• ${z.style} · ${z.color || '—'} · ${z.size}`).join('\n');
    await deliverSstDocument({
        targetRole: 'ADMIN',
        title: 'Stock completed',
        body: `🔴 Stock completed (zero on hand) after PO ${po.po_number}:\n${lines}`,
        pushBody: `${zeroed.length} stock line(s) finished after ${po.po_number}`,
    }).catch(() => {});
    await notifyTelegram({
        targetRole: 'ADMIN',
        text: `🔴 <b>Stock completed</b> after PO ${po.po_number}\n${lines}`,
    }).catch(() => {});
};

/**
 * Alert the Accessories/Materials desk (app inbox + Telegram) that a new
 * accessories requisition was raised from a sub-unit. Best-effort — never
 * blocks the requisition itself.
 */
export const notifyMaterialRequisition = async (input: {
    orderNo: string;
    styleNumber?: string;
    requestedBy?: string;
    items: { name: string; quantity: number; unit: string }[];
}): Promise<void> => {
    const items = (input.items || []).filter((it) => it.name && it.quantity > 0);
    if (!items.length) return;
    const styleBit = input.styleNumber ? ` · ${input.styleNumber}` : '';
    const byBit = input.requestedBy ? `\nRaised by: ${input.requestedBy}` : '';
    const linesPlain = items.map((it) => `• ${it.name} — ${it.quantity} ${it.unit}`).join('\n');
    const linesHtml = items.map((it) => `• ${it.name} — <b>${it.quantity}</b> ${it.unit}`).join('\n');
    await deliverSstDocument({
        targetRole: 'ACCESSORIES_MANAGER',
        title: 'New accessories requisition',
        body: `🧵 New accessories requisition · Order ${input.orderNo}${styleBit}${byBit}\n${linesPlain}`,
        pushBody: `${items.length} item(s) requested for ${input.orderNo}`,
    }).catch(() => {});
    await notifyTelegram({
        targetRole: 'ACCESSORIES_MANAGER',
        text: `🧵 <b>New accessories requisition</b>\nOrder: ${input.orderNo}${styleBit}${byBit}\n${linesHtml}`,
    }).catch(() => {});
};

/** Forward a PO to Inventory + Accounts: deduct its stock then mark FORWARDED. */
export const forwardSalesOrder = async (id: string): Promise<void> => {
    // Load the PO first so we can subtract its quantities from inventory.
    const { data: po } = await supabase.from('sales_orders').select('*').eq('id', id).maybeSingle();
    let zeroed: { style: string; color: string; size: string }[] = [];
    if (po && po.status === 'DRAFT') {
        const r = await dispatchSalesOrderStock(po as SalesOrder);
        zeroed = r.zeroed;
    }
    const { error } = await supabase
        .from('sales_orders')
        .update({ status: 'FORWARDED', forwarded_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw new Error(error.message);
    // Notify Accounts/Inventory (chat + Telegram), and Admin if any stock zeroed.
    if (po) {
        notifyForwardedPo(po as SalesOrder).catch(() => {});
        if (zeroed.length) notifyStockCompleted(po as SalesOrder, zeroed).catch(() => {});
    }
};

export const cancelSalesOrder = async (id: string): Promise<void> => {
    await supabase.from('sales_orders').update({ status: 'CANCELLED' }).eq('id', id);
};

// ---- Simple inventory (no QR / barcode) ----
export const fetchStockLevels = async (): Promise<StockLevel[]> => {
    const { data, error } = await supabase.from('stock_levels').select('*');
    if (error || !data) return [];
    return data as StockLevel[];
};

/**
 * Adjusts on-hand stock for a style/colour/size by a delta (positive to add,
 * negative to remove). Upserts the row. Used by sub-unit stock commits and
 * by sales dispatch. Returns the new quantity, or null on failure.
 */
export const adjustStockLevel = async (
    style_number: string, color: string, size: string, delta: number
): Promise<number | null> => {
    const { data: existing } = await supabase
        .from('stock_levels')
        .select('id, quantity')
        .eq('style_number', style_number)
        .eq('color', color)
        .eq('size', size)
        .maybeSingle();

    const newQty = Math.max(0, (existing?.quantity || 0) + delta);
    if (existing?.id) {
        const { error } = await supabase.from('stock_levels')
            .update({ quantity: newQty, updated_at: new Date().toISOString() })
            .eq('id', existing.id);
        if (error) return null;
    } else {
        const { error } = await supabase.from('stock_levels')
            .insert([{ style_number, color, size, quantity: newQty }]);
        if (error) return null;
    }
    return newQty;
};

// ---- Materials procurement (4-stage lifecycle) ----

export const fetchProcurements = async (): Promise<MaterialProcurement[]> => {
    const { data, error } = await supabase
        .from('material_procurements')
        .select('*')
        .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data as MaterialProcurement[];
};

export const fetchProcurementMovements = async (procurementId: string): Promise<MaterialMovement[]> => {
    const { data, error } = await supabase
        .from('material_movements')
        .select('*')
        .eq('procurement_id', procurementId)
        .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data as MaterialMovement[];
};

/**
 * Create a procurement line. All quantity starts in the REQUESTED bucket unless
 * `startStage` says otherwise (e.g. logging something already ordered). When the
 * starting stage is ORDERED or later an invoice number must be supplied.
 */
export const createProcurement = async (input: {
    order_id?: string | null;
    style_number: string;
    material_name: string;
    unit?: string;
    total_quantity: number;
    startStage?: MaterialStage;
    invoice_no?: string | null;
    note?: string;
    created_by_name?: string;
}): Promise<MaterialProcurement> => {
    const stage = input.startStage || MaterialStage.REQUESTED;
    const qty = Number(input.total_quantity) || 0;
    if (qty <= 0) throw new Error('Quantity must be greater than zero.');
    const needsInvoice = MATERIAL_STAGE_ORDER.indexOf(stage) >= MATERIAL_STAGE_ORDER.indexOf(MaterialStage.ORDERED);
    if (needsInvoice && !input.invoice_no) {
        throw new Error('An invoice number is required once material is ordered. Please provide the invoice number.');
    }

    const row = {
        order_id: input.order_id || null,
        style_number: input.style_number || '',
        material_name: input.material_name,
        unit: input.unit || 'Nos',
        total_quantity: qty,
        qty_requested: stage === MaterialStage.REQUESTED ? qty : 0,
        qty_ordered: stage === MaterialStage.ORDERED ? qty : 0,
        qty_received: stage === MaterialStage.RECEIVED ? qty : 0,
        qty_released: stage === MaterialStage.RELEASED ? qty : 0,
        invoice_no: input.invoice_no || null,
        note: input.note || null,
        created_by_name: input.created_by_name || null,
    };

    const { data, error } = await supabase.from('material_procurements').insert([row]).select().single();
    if (error || !data) throw new Error(error?.message || 'Failed to create procurement.');

    await supabase.from('material_movements').insert([{
        procurement_id: data.id,
        from_stage: 'NEW',
        to_stage: stage,
        qty,
        invoice_no: input.invoice_no || null,
        note: input.note || null,
        created_by_name: input.created_by_name || null,
    }]);

    return data as MaterialProcurement;
};

const STAGE_QTY_COLUMN: Record<MaterialStage, 'qty_requested' | 'qty_ordered' | 'qty_received' | 'qty_released'> = {
    [MaterialStage.REQUESTED]: 'qty_requested',
    [MaterialStage.ORDERED]: 'qty_ordered',
    [MaterialStage.RECEIVED]: 'qty_received',
    [MaterialStage.RELEASED]: 'qty_released',
};

/**
 * Move `qty` of a procurement forward one stage (into `toStage`, pulled from the
 * immediately previous stage). Moving into ORDERED requires an invoice number,
 * which is also stored on the procurement. Returns the updated procurement.
 */
export const advanceProcurement = async (
    procurementId: string,
    qty: number,
    toStage: MaterialStage,
    opts: { invoice_no?: string | null; note?: string; created_by_name?: string } = {}
): Promise<MaterialProcurement> => {
    const moveQty = Number(qty) || 0;
    if (moveQty <= 0) throw new Error('Move quantity must be greater than zero.');

    const fromStage = prevMaterialStage(toStage);
    if (!fromStage) throw new Error(`Cannot advance into ${toStage}.`);

    if (toStage === MaterialStage.ORDERED && !opts.invoice_no) {
        throw new Error('An invoice number is required to mark material as ordered. Please provide the invoice number.');
    }

    const { data: proc, error: fetchErr } = await supabase
        .from('material_procurements').select('*').eq('id', procurementId).single();
    if (fetchErr || !proc) throw new Error('Procurement not found.');

    const fromCol = STAGE_QTY_COLUMN[fromStage];
    const toCol = STAGE_QTY_COLUMN[toStage];
    const available = Number(proc[fromCol]) || 0;
    if (moveQty > available) {
        throw new Error(`Only ${available} ${proc.unit} are at the ${fromStage} stage; cannot move ${moveQty}.`);
    }

    const updates: Record<string, any> = {
        [fromCol]: available - moveQty,
        [toCol]: (Number(proc[toCol]) || 0) + moveQty,
        updated_at: new Date().toISOString(),
    };
    if (opts.invoice_no) updates.invoice_no = opts.invoice_no;

    const { data: updated, error: updErr } = await supabase
        .from('material_procurements').update(updates).eq('id', procurementId).select().single();
    if (updErr || !updated) throw new Error(updErr?.message || 'Failed to advance procurement.');

    await supabase.from('material_movements').insert([{
        procurement_id: procurementId,
        from_stage: fromStage,
        to_stage: toStage,
        qty: moveQty,
        invoice_no: opts.invoice_no || null,
        note: opts.note || null,
        created_by_name: opts.created_by_name || null,
    }]);

    return updated as MaterialProcurement;
};

// ---- Order stock commits (completed pieces -> inventory) ----

export const fetchOrderStockCommits = async (orderId?: string): Promise<OrderStockCommit[]> => {
    let q = supabase.from('order_stock_commits').select('*').order('created_at', { ascending: false });
    if (orderId) q = q.eq('order_id', orderId);
    const { data, error } = await q;
    if (error || !data) return [];
    return data as OrderStockCommit[];
};

/**
 * Push completed pieces of an order into inventory. Each line adds to the
 * running stock_levels for the order's style/colour/size. Records the commit so
 * it can be undone while recent. Returns the commit record.
 */
export const commitOrderStock = async (
    order: Order,
    lines: StockCommitLine[],
    actor?: string
): Promise<OrderStockCommit | null> => {
    const clean = lines.filter((l) => l.qty > 0);
    if (clean.length === 0) throw new Error('Nothing to commit.');

    const styleRef = (order.style_number || '').split(' - ')[0].trim() || order.style_number;
    const total = clean.reduce((s, l) => s + l.qty, 0);

    for (const l of clean) {
        await adjustStockLevel(styleRef, l.color, l.size, l.qty);
    }

    const { data, error } = await supabase
        .from('order_stock_commits')
        .insert([{
            order_id: order.id,
            style_number: styleRef,
            breakdown: clean,
            total_items: total,
            created_by_name: actor || null,
        }])
        .select()
        .single();
    if (error || !data) throw new Error(error?.message || 'Failed to record stock commit.');

    await addOrderLog(order.id, 'MANUAL_UPDATE', `Stock commit: ${total} pcs pushed to inventory.`);
    return data as OrderStockCommit;
};

/** Reverse a recent stock commit: subtract its pieces back out of inventory. */
export const undoOrderStockCommit = async (commit: OrderStockCommit): Promise<void> => {
    if (commit.undone) return;
    for (const l of commit.breakdown || []) {
        await adjustStockLevel(commit.style_number, l.color, l.size, -l.qty);
    }
    await supabase
        .from('order_stock_commits')
        .update({ undone: true, undone_at: new Date().toISOString() })
        .eq('id', commit.id);
    if (commit.order_id) {
        await addOrderLog(commit.order_id, 'MANUAL_UPDATE', `Stock commit undone: ${commit.total_items} pcs removed from inventory.`);
    }
};

export const uploadOrderAttachment = async (file: File): Promise<string | null> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const { error } = await supabase.storage.from('order-attachments').upload(fileName, file);
    if (error) return null;
    const { data } = supabase.storage.from('order-attachments').getPublicUrl(fileName);
    return data.publicUrl;
};

// --- Poster Editor shared library (assets + templates) ------------------------
import type { El, SavedAsset, SavedTemplate } from './posterEditor.js';

interface PosterLibRow { id: string; kind: 'asset' | 'template'; name: string; data: any; created_at: string }

export const fetchPosterAssets = async (): Promise<SavedAsset[]> => {
    const { data, error } = await supabase
        .from('poster_library').select('*').eq('kind', 'asset').order('created_at', { ascending: false });
    if (error) throw error;
    return (data as PosterLibRow[] || []).map(r => ({
        id: r.id, name: r.name, element: r.data?.element, createdAt: new Date(r.created_at).getTime(),
    }));
};

export const fetchPosterTemplates = async (): Promise<SavedTemplate[]> => {
    const { data, error } = await supabase
        .from('poster_library').select('*').eq('kind', 'template').order('created_at', { ascending: false });
    if (error) throw error;
    return (data as PosterLibRow[] || []).map(r => ({
        id: r.id, name: r.name, stageW: r.data?.stageW, stageH: r.data?.stageH,
        elements: r.data?.elements || [], createdAt: new Date(r.created_at).getTime(),
    }));
};

export const savePosterAssetRemote = async (name: string, element: El): Promise<SavedAsset> => {
    const { data, error } = await supabase
        .from('poster_library').insert({ kind: 'asset', name, data: { element } }).select().single();
    if (error) throw error;
    const r = data as PosterLibRow;
    return { id: r.id, name: r.name, element: r.data.element, createdAt: new Date(r.created_at).getTime() };
};

export const savePosterTemplateRemote = async (
    name: string, stageW: number, stageH: number, elements: El[],
): Promise<SavedTemplate> => {
    const { data, error } = await supabase
        .from('poster_library').insert({ kind: 'template', name, data: { stageW, stageH, elements } }).select().single();
    if (error) throw error;
    const r = data as PosterLibRow;
    return { id: r.id, name: r.name, stageW: r.data.stageW, stageH: r.data.stageH, elements: r.data.elements, createdAt: new Date(r.created_at).getTime() };
};

export const deletePosterLibraryItem = async (id: string): Promise<void> => {
    const { error } = await supabase.from('poster_library').delete().eq('id', id);
    if (error) throw error;
};
