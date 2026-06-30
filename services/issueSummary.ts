import { UserRole, Order, OrderLog } from '../types.js';
import { getProvider } from './ai/providers.js';
import { supabase, supabaseServer } from './supabase.js';

export interface StyleIssueSummaryInsight {
  order_id: string;
  order_no: string;
  completed_at?: string;
  summary: string;
}

const styleRef = (styleNumber: string): string => (styleNumber || '').split(' - ')[0].trim();

const safeText = (value: any, fallback = ''): string => {
  if (value === null || value === undefined) return fallback;
  return String(value).replace(/\s+/g, ' ').trim();
};

const clamp = (text: string, max = 12000): string =>
  text.length > max ? `${text.slice(0, max)}\n...(truncated)` : text;

const summarizeLogs = (logs: OrderLog[]): string =>
  logs
    .map((log) => {
      const date = safeText(log.created_at).slice(0, 10);
      const actor = log.created_by_name ? ` by ${log.created_by_name}` : '';
      return `- ${date} ${log.log_type}${actor}: ${safeText(log.message)}`;
    })
    .join('\n');

const fallbackSummary = (order: Order, logs: OrderLog[]): string => {
  const issueLogs = logs.filter((log) =>
    /reject|rework|issue|problem|defect|qc|short|delay|damage|mismatch|wrong/i.test(log.message || ''),
  );
  if (issueLogs.length === 0 && !order.qc_notes) {
    return 'No clear recurring production issue was found in the available QC notes and timeline logs.';
  }
  const top = issueLogs.slice(-3).map((log) => safeText(log.message)).filter(Boolean);
  return [
    order.qc_notes ? `QC notes: ${safeText(order.qc_notes)}` : '',
    top.length ? `Timeline signals: ${top.join(' | ')}` : '',
  ].filter(Boolean).join('\n');
};

export const generateOrderIssueSummary = async (orderId: string): Promise<{ summary: string | null; error?: string }> => {
  const client = supabaseServer || supabase;
  const { data: order, error: orderError } = await client.from('orders').select('*').eq('id', orderId).single();
  if (orderError || !order) return { summary: null, error: orderError?.message || 'Order not found.' };

  const [logsResult, requestsResult, procurementsResult] = await Promise.all([
    client.from('order_logs').select('*').eq('order_id', orderId).order('created_at', { ascending: true }),
    client.from('material_requests').select('*').eq('order_id', orderId).order('created_at', { ascending: true }),
    client.from('material_procurements').select('*').eq('order_id', orderId).order('created_at', { ascending: true }),
  ]);

  const logs = (logsResult.data || []) as OrderLog[];
  const requests = requestsResult.data || [];
  const procurements = procurementsResult.data || [];
  let summary = '';
  const provider = getProvider();

  if (provider.isConfigured()) {
    const system =
      'You are a garment production post-mortem analyst. Read one completed production run and write a concise Issue Summary for the next team that makes the same style. Do not call tools. Focus only on concrete risks, QC rejections, repeated notes, material shortages, delays, quantity variances, and practical prevention points. If no issue is visible, say that no recurring issue was found.';

    const prompt = clamp(`
Completed order:
- Order: ${safeText(order.order_no)}
- Style: ${safeText(order.style_number)}
- Planned quantity: ${safeText(order.quantity)}
- Status: ${safeText(order.status)}
- QC notes: ${safeText(order.qc_notes, 'None')}
- Production instructions: ${safeText(order.description, 'None')}
- Planned breakdown: ${JSON.stringify(order.size_breakdown || [])}
- Completed breakdown: ${JSON.stringify(order.completion_breakdown || [])}
- Material forecast: ${JSON.stringify(order.material_forecast || [])}

Timeline logs:
${summarizeLogs(logs) || 'No timeline logs.'}

Material requests:
${JSON.stringify(requests)}

Material procurement:
${JSON.stringify(procurements)}

Return 3 to 6 short bullets. Start with the most important warning. Avoid generic advice.
`);

    try {
      const turn = await provider.chat([{ role: 'user', text: prompt }], UserRole.TECH_MANAGER, system);
      summary = safeText(turn.text);
    } catch (err) {
      console.warn('AI issue summary generation failed; using local fallback.', err);
    }
  }

  if (!summary) summary = fallbackSummary(order as Order, logs);
  summary = summary.slice(0, 2400);

  const { error: updateError } = await client
    .from('orders')
    .update({
      ai_issue_summary: summary,
      ai_issue_summary_generated_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  if (updateError) return { summary, error: updateError.message };
  return { summary };
};

export const fetchPreviousStyleIssueSummaries = async (
  styleNumber: string,
  excludeOrderId?: string,
  limit = 3,
): Promise<StyleIssueSummaryInsight[]> => {
  const ref = styleRef(styleNumber);
  if (!ref) return [];

  const { data, error } = await (supabaseServer || supabase)
    .from('orders')
    .select('id, order_no, style_number, created_at, ai_issue_summary, ai_issue_summary_generated_at')
    .eq('status', 'COMPLETED')
    .not('ai_issue_summary', 'is', null)
    .order('ai_issue_summary_generated_at', { ascending: false });

  if (error || !data) return [];

  return data
    .filter((row: any) => row.id !== excludeOrderId && styleRef(row.style_number).toLowerCase() === ref.toLowerCase())
    .slice(0, limit)
    .map((row: any) => ({
      order_id: row.id,
      order_no: row.order_no,
      completed_at: row.ai_issue_summary_generated_at || row.created_at,
      summary: row.ai_issue_summary,
    }));
};
