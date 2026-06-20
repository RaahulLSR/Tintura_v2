import React, { useEffect, useMemo, useState } from 'react';
import { fetchSalesOrders, createSalesOrder, forwardSalesOrder, cancelSalesOrder, fetchStyles, fetchBuyers, fetchStockLevels } from '../services/db';
import { SalesOrder, SalesOrderLine, Style, Buyer, UserRole, StockLevel } from '../types';
import { SIZE_PAIRS, sizePair, normalizeSize, sizesEqual } from '../services/sizes';
import { buildPoPdfBytes } from '../services/poPdf';
import { useAuth } from '../components/Layout';
import { newConversation, sendUserMessage, isAIConfigured } from '../services/geminiService';
import {
  ShoppingCart, RefreshCcw, Plus, X, Send, Ban, Boxes, FileText, FileDown,
  CheckCircle2, Clock, Trash2, Search, Building2, BarChart3, Sparkles, TrendingUp,
} from 'lucide-react';

/** Size column header. Combined "65/S" renders stacked (number over letter);
 *  single-form labels ("65", "S" or any custom text) render verbatim. */
const SizeHead: React.FC<{ label: string; className?: string }> = ({ label, className }) => {
  const slash = label.indexOf('/');
  const top = slash >= 0 ? label.slice(0, slash) : label;
  const bottom = slash >= 0 ? label.slice(slash + 1) : '';
  return (
    <th className={className}>
      <div className="flex flex-col items-center leading-none">
        <span>{top}</span>
        {bottom && <span className="text-[10px] text-slate-400 font-medium">{bottom}</span>}
      </div>
    </th>
  );
};

const StatusBadge: React.FC<{ status: SalesOrder['status'] }> = ({ status }) => {
  const map: Record<string, string> = {
    DRAFT: 'bg-amber-50 text-amber-700 border-amber-200',
    FORWARDED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    CANCELLED: 'bg-slate-100 text-slate-400 border-slate-200',
  };
  return <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${map[status] || ''}`}>{status}</span>;
};

export const SalesDashboard: React.FC = () => {
  const { user } = useAuth();
  const actor = user?.full_name || user?.username || 'Sales';

  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'ALL' | 'DRAFT' | 'FORWARDED'>('ALL');
  const [buyerFilter, setBuyerFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showInsights, setShowInsights] = useState(false);

  const load = async () => {
    setLoading(true);
    const [po, st, by, sl] = await Promise.all([fetchSalesOrders(), fetchStyles(), fetchBuyers(), fetchStockLevels()]);
    setOrders(po);
    setStyles(st);
    setBuyers(by);
    setStockLevels(sl);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const handleForward = async (po: SalesOrder) => {
    if (!confirm(`Forward PO ${po.po_number} to Inventory & Accounts?`)) return;
    await forwardSalesOrder(po.id);
    load();
  };
  const handleCancel = async (po: SalesOrder) => {
    if (!confirm(`Cancel PO ${po.po_number}?`)) return;
    await cancelSalesOrder(po.id);
    load();
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filter !== 'ALL' && o.status !== filter) return false;
      if (buyerFilter && o.buyer_name !== buyerFilter) return false;
      if (!q) return true;
      return o.po_number.toLowerCase().includes(q) || o.buyer_name.toLowerCase().includes(q);
    });
  }, [orders, filter, buyerFilter, search]);

  const buyerNames = useMemo(() => {
    const set = new Set<string>(buyers.map((b) => b.name));
    orders.forEach((o) => o.buyer_name && set.add(o.buyer_name));
    return Array.from(set).sort();
  }, [buyers, orders]);

  const stats = useMemo(() => {
    const active = orders.filter((o) => o.status !== 'CANCELLED');
    return {
      total: active.length,
      forwarded: active.filter((o) => o.status === 'FORWARDED').length,
      qty: active.reduce((s, o) => s + (o.total_qty || 0), 0),
    };
  }, [orders]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2"><ShoppingCart className="text-brand-600" /> Sales</h1>
          <p className="page-subtitle">Buyer purchase orders — build a matrix, raise a PO, forward to Inventory &amp; Accounts.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowInsights((v) => !v)} className={showInsights ? 'btn-primary' : 'btn-secondary'}><BarChart3 size={16} /> Insights</button>
          <button onClick={load} className="btn-secondary"><RefreshCcw size={16} /> Refresh</button>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} /> New PO</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card"><div className="stat-label flex items-center gap-1.5"><FileText size={14} /> Active POs</div><div className="stat-value">{stats.total}</div></div>
        <div className="stat-card"><div className="stat-label flex items-center gap-1.5"><Send size={14} /> Forwarded</div><div className="stat-value">{stats.forwarded}</div></div>
        <div className="stat-card"><div className="stat-label flex items-center gap-1.5"><Boxes size={14} /> Total Pieces</div><div className="stat-value">{stats.qty.toLocaleString()}</div></div>
      </div>

      {/* Insights (charts + AI) */}
      {showInsights && (
        <SalesInsights orders={orders} role={user?.role} actor={actor} />
      )}

      {/* Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(['ALL', 'DRAFT', 'FORWARDED'] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${filter === f ? 'bg-white shadow-sm text-brand-600' : 'text-slate-500 hover:text-slate-700'}`}>
              {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select value={buyerFilter} onChange={(e) => setBuyerFilter(e.target.value)} className="select w-44">
            <option value="">All buyers</option>
            {buyerNames.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO or buyer…" className="input pl-9 w-64" />
          </div>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="card card-pad text-center text-slate-500">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="card card-pad text-center text-slate-400">No purchase orders yet.</div>
      ) : (
        <div className="space-y-4">
          {visible.map((po) => <POCard key={po.id} po={po} onForward={() => handleForward(po)} onCancel={() => handleCancel(po)} />)}
        </div>
      )}

      {showCreate && (
        <CreatePOModal styles={styles} buyers={buyers} stockLevels={stockLevels} actor={actor} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />
      )}
    </div>
  );
};

const POCard: React.FC<{ po: SalesOrder; onForward: () => void; onCancel: () => void }> = ({ po, onForward, onCancel }) => {
  const [open, setOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const downloadPdf = async () => {
    try {
      setPdfBusy(true);
      const bytes = await buildPoPdfBytes(po);
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(po.po_number || 'PO').replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setPdfBusy(false);
    }
  };
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="font-bold text-slate-900 text-lg">{po.po_number}</div>
            <div className="text-sm text-slate-500 flex items-center gap-1.5"><Building2 size={14} /> {po.buyer_name}</div>
          </div>
          <StatusBadge status={po.status} />
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-sm font-bold text-slate-900">{po.total_qty.toLocaleString()} pcs</div>
            <div className="text-xs text-slate-400 flex items-center gap-1 justify-end"><Clock size={12} /> {new Date(po.created_at).toLocaleString()}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setOpen((v) => !v)} className="btn-ghost btn-sm">{open ? 'Hide' : 'View'}</button>
            <button onClick={downloadPdf} disabled={pdfBusy} className="btn-ghost btn-sm" title="Download PO PDF (for Accounts & Inventory)"><FileDown size={14} /> {pdfBusy ? 'PDF…' : 'PDF'}</button>
            {po.status === 'DRAFT' && (
              <>
                <button onClick={onForward} className="btn-primary btn-sm"><Send size={14} /> Forward</button>
                <button onClick={onCancel} className="btn-ghost btn-sm text-red-600"><Ban size={14} /></button>
              </>
            )}
            {po.status === 'FORWARDED' && (
              <span className="inline-flex items-center gap-1 text-emerald-600 text-sm font-semibold"><CheckCircle2 size={15} /> Sent</span>
            )}
          </div>
        </div>
      </div>
      {open && (
        <div className="border-t border-slate-200 overflow-x-auto">
          <table className="w-full text-sm text-center min-w-max">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="p-2.5 text-left">Style</th>
                {po.size_labels.map((s) => <SizeHead key={s} label={s} className="p-2.5 w-16" />)}
                <th className="p-2.5">Qty</th>
                {po.total_amount > 0 && <th className="p-2.5 text-right">Amount</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {po.lines.map((l, i) => (
                <tr key={i}>
                  <td className="p-2.5 text-left font-medium text-slate-700">
                    {l.style_number}
                    {l.color ? <span className="ml-1.5 text-xs text-slate-400">({l.color})</span> : <span className="ml-1.5 text-xs text-slate-300">(all colours)</span>}
                  </td>
                  {po.size_labels.map((s) => <td key={s} className="p-2.5 text-slate-600">{l.sizes[s] || ''}</td>)}
                  <td className="p-2.5 font-semibold text-slate-800">{l.total}</td>
                  {po.total_amount > 0 && <td className="p-2.5 text-right tabular-nums">{(l.amount || 0).toLocaleString()}</td>}
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
              <tr>
                <td className="p-2.5 text-left">Total</td>
                {po.size_labels.map((s) => <td key={s} className="p-2.5">{po.lines.reduce((a, l) => a + (l.sizes[s] || 0), 0) || ''}</td>)}
                <td className="p-2.5">{po.total_qty}</td>
                {po.total_amount > 0 && <td className="p-2.5 text-right">{po.total_amount.toLocaleString()}</td>}
              </tr>
            </tfoot>
          </table>
          {po.note && <div className="px-4 py-2 text-sm text-slate-500 border-t border-slate-100">Note: {po.note}</div>}
        </div>
      )}
    </div>
  );
};

// ---- Sales Insights: charts + AI ----
const CHART_COLORS = ['#2563eb', '#7c3aed', '#0d9488', '#db2777', '#ea580c', '#0891b2', '#65a30d', '#9333ea'];

const HBarChart: React.FC<{ data: { label: string; qty: number }[]; unit?: string }> = ({ data, unit = 'pcs' }) => {
  const max = Math.max(1, ...data.map((d) => d.qty));
  if (data.length === 0) return <div className="text-sm text-slate-400 py-6 text-center">No data yet.</div>;
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={d.label} className="flex items-center gap-2">
          <div className="w-28 shrink-0 truncate text-xs font-medium text-slate-600 text-right" title={d.label}>{d.label}</div>
          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
            <div className="h-5 rounded-full transition-all" style={{ width: `${Math.max(4, (d.qty / max) * 100)}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
          </div>
          <div className="w-20 shrink-0 text-xs font-semibold text-slate-700 tabular-nums">{d.qty.toLocaleString()} {unit}</div>
        </div>
      ))}
    </div>
  );
};

const MonthlyLine: React.FC<{ data: { month: string; qty: number }[] }> = ({ data }) => {
  if (data.length === 0) return <div className="text-sm text-slate-400 py-6 text-center">No data yet.</div>;
  const W = 520, H = 160, P = 28;
  const max = Math.max(1, ...data.map((d) => d.qty));
  const stepX = data.length > 1 ? (W - P * 2) / (data.length - 1) : 0;
  const x = (i: number) => P + i * stepX;
  const y = (v: number) => H - P - (v / max) * (H - P * 2);
  const pts = data.map((d, i) => `${x(i)},${y(d.qty)}`).join(' ');
  const area = `${P},${H - P} ${pts} ${x(data.length - 1)},${H - P}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      <polygon points={area} fill="#2563eb" opacity={0.08} />
      <polyline points={pts} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <g key={d.month}>
          <circle cx={x(i)} cy={y(d.qty)} r={3.5} fill="#2563eb" />
          <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-slate-400" fontSize={10}>{d.month.slice(2)}</text>
          <text x={x(i)} y={y(d.qty) - 8} textAnchor="middle" className="fill-slate-600" fontSize={10} fontWeight={600}>{d.qty.toLocaleString()}</text>
        </g>
      ))}
    </svg>
  );
};

const SalesInsights: React.FC<{ orders: SalesOrder[]; role?: UserRole; actor: string }> = ({ orders, role, actor }) => {
  // Default the date filter to "1 Jan of this year → today".
  const ydToday = new Date();
  const yearStart = `${ydToday.getFullYear()}-01-01`;
  const todayStr = `${ydToday.getFullYear()}-${String(ydToday.getMonth() + 1).padStart(2, '0')}-${String(ydToday.getDate()).padStart(2, '0')}`;
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(todayStr);
  const [metric, setMetric] = useState<'qty' | 'amount'>('qty');
  const [ask, setAsk] = useState('');
  const [answer, setAnswer] = useState('');
  const [thinking, setThinking] = useState(false);
  const aiReady = isAIConfigured();

  const active = useMemo(() => orders.filter((o) => {
    if (o.status === 'CANCELLED') return false;
    if (from && o.po_date < from) return false;
    if (to && o.po_date > to) return false;
    return true;
  }), [orders, from, to]);

  const charts = useMemo(() => {
    const byBuyer: Record<string, number> = {};
    const byStyle: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    let pieces = 0, amount = 0;
    for (const o of active) {
      const val = metric === 'qty' ? o.total_qty : o.total_amount;
      pieces += o.total_qty; amount += o.total_amount;
      byBuyer[o.buyer_name] = (byBuyer[o.buyer_name] || 0) + val;
      const m = (o.po_date || '').slice(0, 7);
      if (m) byMonth[m] = (byMonth[m] || 0) + val;
      for (const l of o.lines) byStyle[l.style_number] = (byStyle[l.style_number] || 0) + (metric === 'qty' ? l.total : (l.amount || 0));
    }
    const top = (rec: Record<string, number>, n: number) =>
      Object.entries(rec).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, qty]) => ({ label, qty }));
    return {
      pieces, amount, count: active.length,
      buyers: top(byBuyer, 6),
      styles: top(byStyle, 6),
      months: Object.entries(byMonth).sort().map(([month, qty]) => ({ month, qty })),
    };
  }, [active, metric]);

  const unit = metric === 'qty' ? 'pcs' : '₹';

  const runAsk = async () => {
    const q = ask.trim();
    if (!q || thinking) return;
    setThinking(true); setAnswer('');
    try {
      const resp = await sendUserMessage(newConversation(), q, { actor, role: role || UserRole.MANAGER });
      setAnswer(resp.text || resp.error || 'No answer.');
    } catch (e: any) {
      setAnswer(e?.message || 'AI request failed.');
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="card card-pad space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2"><TrendingUp size={18} className="text-brand-600" /> Sales Insights</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {(['qty', 'amount'] as const).map((m) => (
              <button key={m} onClick={() => setMetric(m)}
                className={`px-3 py-1 rounded-md text-xs font-semibold ${metric === m ? 'bg-white shadow-sm text-brand-600' : 'text-slate-500'}`}>
                {m === 'qty' ? 'Pieces' : 'Amount'}
              </button>
            ))}
          </div>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input py-1.5 w-36" title="From date" />
          <span className="text-slate-400 text-sm">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input py-1.5 w-36" title="To date" />
          {(from || to) && <button onClick={() => { setFrom(''); setTo(''); }} className="btn-ghost btn-sm">Clear</button>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="stat-card"><div className="stat-label">POs in range</div><div className="stat-value">{charts.count}</div></div>
        <div className="stat-card"><div className="stat-label">Pieces</div><div className="stat-value">{charts.pieces.toLocaleString()}</div></div>
        <div className="stat-card"><div className="stat-label">Amount</div><div className="stat-value">{charts.amount > 0 ? '₹' + charts.amount.toLocaleString() : '—'}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div>
          <div className="text-sm font-semibold text-slate-700 mb-3">Top Buyers</div>
          <HBarChart data={charts.buyers} unit={unit} />
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-700 mb-3">Top Styles</div>
          <HBarChart data={charts.styles} unit={unit} />
        </div>
      </div>

      <div>
        <div className="text-sm font-semibold text-slate-700 mb-1">Monthly {metric === 'qty' ? 'Pieces' : 'Amount'}</div>
        <MonthlyLine data={charts.months} />
      </div>

      {aiReady && (
        <div className="border-t border-slate-200 pt-4">
          <div className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><Sparkles size={15} className="text-brand-600" /> Ask AI about sales</div>
          <div className="flex gap-2">
            <input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runAsk()}
              placeholder="e.g. Which buyer ordered the most this month?" className="input flex-1" />
            <button onClick={runAsk} disabled={thinking || !ask.trim()} className="btn-primary">{thinking ? 'Thinking…' : 'Ask'}</button>
          </div>
          {answer && <div className="mt-3 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 whitespace-pre-wrap">{answer}</div>}
        </div>
      )}
    </div>
  );
};

// ---- Create PO modal (the matrix) ----
interface DraftLine { style_number: string; sizes: Record<string, number>; rate: number; color?: string; }
/** One editable size column. `key` is the stable canonical letter used as the
 *  quantity map key (so stock matching keeps working), while `num`/`letter` are
 *  the freely-editable display parts prefetched from the style. */
interface SizeCol { key: string; num: string; letter: string; }

/** Default columns = the full canonical number/letter set. */
const defaultSizeCols = (): SizeCol[] => SIZE_PAIRS.map((p) => ({ key: p.letter, num: p.num, letter: p.letter }));

/** Effective printed label for a column: both -> "65/S", else the single form. */
const colLabel = (c: SizeCol): string => {
  const n = c.num.trim(), l = c.letter.trim();
  return n && l ? `${n}/${l}` : (n || l || c.key);
};

/** Build size columns for a style: prefetch its sizes and apply the number /
 *  letter / both rule from the style's `size_type`. */
const colsForStyle = (style: Style): SizeCol[] => {
  const raw = (style.available_sizes || []).map((s) => String(s).trim()).filter(Boolean);
  const base = raw.length ? raw : SIZE_PAIRS.map((p) => p.num);
  const seen = new Set<string>();
  const out: SizeCol[] = [];
  for (const sz of base) {
    const p = sizePair(sz);
    const key = p?.letter || normalizeSize(sz);
    if (seen.has(key)) continue;
    seen.add(key);
    if (style.size_type === 'number') out.push({ key, num: p?.num || sz, letter: '' });
    else if (style.size_type === 'letter') out.push({ key, num: '', letter: p?.letter || sz });
    else out.push({ key, num: p?.num || '', letter: p?.letter || sz });
  }
  return out.length ? out : defaultSizeCols();
};

const CreatePOModal: React.FC<{ styles: Style[]; buyers: Buyer[]; stockLevels: StockLevel[]; actor: string; onClose: () => void; onCreated: () => void }> = ({ styles, buyers, stockLevels, actor, onClose, onCreated }) => {
  const now = new Date();
  const [buyer, setBuyer] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ style_number: '', sizes: {}, rate: 0 }]);
  const [cols, setCols] = useState<SizeCol[]>(defaultSizeCols());
  const [colsTouched, setColsTouched] = useState(false);
  const [prefetchedFor, setPrefetchedFor] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const lineTotal = (l: DraftLine) => cols.reduce((a, c) => a + (l.sizes[c.key] || 0), 0);
  const grandQty = lines.reduce((a, l) => a + lineTotal(l), 0);
  const grandAmount = lines.reduce((a, l) => a + lineTotal(l) * (l.rate || 0), 0);

  // Colours available for a given style number (for the per-line colour picker).
  const colorsFor = (styleNo: string): string[] => {
    const st = styles.find((s) => s.style_number === styleNo.trim());
    return st?.available_colors || [];
  };

  // On-hand stock available for a style (optionally narrowed to one colour).
  const availableFor = (styleNo: string, color?: string): number => {
    const sn = (styleNo || '').trim();
    if (!sn) return 0;
    const c = (color || '').trim().toLowerCase();
    return stockLevels
      .filter((r) => r.style_number === sn && (!c || (r.color || '').toLowerCase() === c))
      .reduce((a, r) => a + (Number(r.quantity) || 0), 0);
  };

  // Available stock for one specific size of a style (optionally a colour).
  const availableForSize = (styleNo: string, color: string | undefined, sizeLabel: string): number => {
    const sn = (styleNo || '').trim();
    const sz = (sizeLabel || '').trim();
    if (!sn || !sz) return 0;
    const c = (color || '').trim().toLowerCase();
    return stockLevels
      .filter((r) => r.style_number === sn && sizesEqual(r.size, sz) && (!c || (r.color || '').toLowerCase() === c))
      .reduce((a, r) => a + (Number(r.quantity) || 0), 0);
  };

  // Prefetch + fill the size columns from the first recognised style, unless the
  // user has manually edited the headers (then we leave their choices alone).
  useEffect(() => {
    if (colsTouched) return;
    const firstStyle = lines.map((l) => l.style_number.trim()).find((sn) => sn && styles.some((s) => s.style_number === sn));
    if (!firstStyle || firstStyle === prefetchedFor) return;
    const st = styles.find((s) => s.style_number === firstStyle);
    if (st) { setCols(colsForStyle(st)); setPrefetchedFor(firstStyle); }
  }, [lines, styles, colsTouched, prefetchedFor]);

  const setSize = (idx: number, key: string, val: number) => {
    setLines((prev) => prev.map((l, i) => i === idx ? { ...l, sizes: { ...l.sizes, [key]: Math.max(0, val || 0) } } : l));
  };
  const setStyle = (idx: number, val: string) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, style_number: val } : l));
  const setColor = (idx: number, val: string) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, color: val } : l));
  const setRate = (idx: number, val: number) => setLines((prev) => prev.map((l, i) => i === idx ? { ...l, rate: Math.max(0, val || 0) } : l));
  const addRow = () => setLines((prev) => [...prev, { style_number: '', sizes: {}, rate: 0 }]);
  const removeRow = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  // Manual header editing (number + letter), with stable keys preserved.
  const setColPart = (idx: number, part: 'num' | 'letter', val: string) => {
    setColsTouched(true);
    setCols((prev) => prev.map((c, i) => i === idx ? { ...c, [part]: val } : c));
  };
  const addCol = () => {
    setColsTouched(true);
    setCols((prev) => [...prev, { key: `x${prev.length}-${Date.now()}`, num: '', letter: '' }]);
  };
  // Insert a blank size column at a given index (between columns, or at the start).
  const insertCol = (at: number) => {
    setColsTouched(true);
    setCols((prev) => {
      const next = [...prev];
      next.splice(at, 0, { key: `x${prev.length}-${Date.now()}`, num: '', letter: '' });
      return next;
    });
  };
  const removeCol = (idx: number) => {
    setColsTouched(true);
    const key = cols[idx]?.key;
    setCols((prev) => prev.filter((_, i) => i !== idx));
    if (key) setLines((prev) => prev.map((l) => { const s = { ...l.sizes }; delete s[key]; return { ...l, sizes: s }; }));
  };

  const submit = async () => {
    setError('');
    const overs: string[] = [];
    const payload: SalesOrderLine[] = lines
      .filter((l) => l.style_number.trim() && lineTotal(l) > 0)
      .map((l) => {
        const total = lineTotal(l);
        const avail = availableFor(l.style_number, l.color);
        if (total > avail) overs.push(`• ${l.style_number.trim()}${l.color ? ` (${l.color})` : ''}: PO ${total} vs stock ${avail}`);
        const sizes: Record<string, number> = {};
        cols.forEach((c) => { const q = l.sizes[c.key] || 0; if (q > 0) sizes[colLabel(c)] = q; });
        return { style_number: l.style_number.trim(), sizes, total, rate: l.rate || undefined, amount: l.rate ? total * l.rate : undefined, color: l.color?.trim() || undefined };
      });
    if (payload.length === 0) { setError('Add at least one style with quantities.'); return; }
    // Small popup when any line exceeds available stock — user can still proceed.
    if (overs.length && !window.confirm(`⚠️ PO quantity exceeds available stock:\n\n${overs.join('\n')}\n\nRaise the PO anyway?`)) {
      return;
    }
    const sizeLabels = cols.map(colLabel);
    const sizeFormat: 'standard' | 'numeric' = cols.length > 0 && cols.every((c) => c.num.trim() && !c.letter.trim()) ? 'numeric' : 'standard';
    setSaving(true);
    try {
      await createSalesOrder({
        po_number: '', po_date: now.toISOString().slice(0, 10), buyer_name: buyer,
        size_format: sizeFormat, size_labels: sizeLabels,
        lines: payload, note: note || undefined, created_by_name: actor,
      });
      onCreated();
    } catch (e: any) {
      setError(e?.message || 'Failed to create PO.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-5xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2"><ShoppingCart className="text-brand-600" size={18} /> New Purchase Order</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="label">Buyer</label><input list="po-buyers" className="input" value={buyer} onChange={(e) => setBuyer(e.target.value)} placeholder="Buyer / customer name" /><datalist id="po-buyers">{buyers.map((b) => <option key={b.id} value={b.name} />)}</datalist></div>
            <div><label className="label">PO Number</label><input className="input bg-slate-50 text-slate-500" value="Auto-assigned on save" readOnly /></div>
            <div><label className="label">Date &amp; Time</label><input className="input bg-slate-50 text-slate-500" value={now.toLocaleString()} readOnly /></div>
          </div>

          <div className="flex items-center justify-between">
            <label className="label mb-0">Order Matrix</label>
            <span className="text-xs text-slate-400">Sizes prefetched from the style — edit the number/letter headers freely · qty applies to every colour unless a colour is chosen</span>
          </div>

          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm text-center min-w-max">
              <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="p-2.5 text-left min-w-[180px]">Style</th>
                  <th className="p-2.5 min-w-[120px]">Colour</th>
                  {cols.map((c, ci) => (
                    <th key={c.key} className="p-1.5 w-16 align-top">
                      <div className="flex flex-col items-center gap-0.5">
                        <button type="button" onClick={() => insertCol(ci)}
                          className="text-[9px] leading-none text-slate-300 hover:text-brand-600"
                          title="Insert a size column here">＋</button>
                        <input value={c.num} onChange={(e) => setColPart(ci, 'num', e.target.value)}
                          className="input text-center px-1 py-0.5 w-12 text-[11px] font-semibold" placeholder="#" />
                        <input value={c.letter} onChange={(e) => setColPart(ci, 'letter', e.target.value)}
                          className="input text-center px-1 py-0.5 w-12 text-[10px]" placeholder="—" />
                        {cols.length > 1 && (
                          <button type="button" onClick={() => removeCol(ci)} className="text-slate-300 hover:text-red-500" title="Remove size"><X size={11} /></button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="p-1.5 w-8 align-middle">
                    <button type="button" onClick={addCol} className="text-slate-400 hover:text-brand-600" title="Add size column at the end"><Plus size={15} /></button>
                  </th>
                  <th className="p-2.5 w-20">Rate</th>
                  <th className="p-2.5 w-16">Qty</th>
                  <th className="p-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l, idx) => {
                  const total = lineTotal(l);
                  const avail = availableFor(l.style_number, l.color);
                  const known = !!l.style_number.trim() && styles.some((s) => s.style_number === l.style_number.trim());
                  const over = total > avail;
                  return (
                  <tr key={idx}>
                    <td className="p-1.5 text-left">
                      <input list="po-styles" className="input py-1.5" value={l.style_number}
                        onChange={(e) => setStyle(idx, e.target.value)} placeholder="Style number" />
                      {known && (
                        <div className={`mt-0.5 text-[10px] font-semibold ${over ? 'text-red-600' : 'text-emerald-600'}`}>
                          Stock available: {avail.toLocaleString()}{over ? ` · over by ${(total - avail).toLocaleString()}` : ''}
                        </div>
                      )}
                    </td>
                    <td className="p-1.5">
                      <input list={`po-colors-${idx}`} className="input py-1.5 text-center" value={l.color || ''}
                        onChange={(e) => setColor(idx, e.target.value)} placeholder="All colours" />
                      <datalist id={`po-colors-${idx}`}>{colorsFor(l.style_number).map((c) => <option key={c} value={c} />)}</datalist>
                    </td>
                    {cols.map((c) => {
                      const sizeAvail = known ? availableForSize(l.style_number, l.color, colLabel(c)) : 0;
                      return (
                      <td key={c.key} className="p-1.5 align-top">
                        <input type="number" min={0} className="input text-center px-1 py-1 w-14"
                          value={l.sizes[c.key] || ''} onChange={(e) => setSize(idx, c.key, parseInt(e.target.value) || 0)} />
                        {known && (
                          <div className={`mt-0.5 text-[9px] font-semibold ${sizeAvail > 0 ? 'text-slate-400' : 'text-slate-300'}`} title="Available stock for this size">
                            {sizeAvail.toLocaleString()}
                          </div>
                        )}
                      </td>
                      );
                    })}
                    <td className="p-1.5"></td>
                    <td className="p-1.5">
                      <input type="number" min={0} className="input text-center px-1 py-1 w-16"
                        value={l.rate || ''} onChange={(e) => setRate(idx, parseFloat(e.target.value) || 0)} />
                    </td>
                    <td className={`p-2.5 font-semibold ${over ? 'text-red-600' : 'text-slate-800'}`}>{total}</td>
                    <td className="p-1.5">
                      {lines.length > 1 && <button onClick={() => removeRow(idx)} className="text-slate-300 hover:text-red-500"><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-50 font-bold border-t border-slate-200">
                <tr>
                  <td className="p-2.5 text-left">Total</td>
                  <td className="p-2.5"></td>
                  {cols.map((c) => <td key={c.key} className="p-2.5">{lines.reduce((a, l) => a + (l.sizes[c.key] || 0), 0) || ''}</td>)}
                  <td className="p-2.5"></td>
                  <td className="p-2.5">{grandAmount > 0 ? grandAmount.toLocaleString() : ''}</td>
                  <td className="p-2.5">{grandQty}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <datalist id="po-styles">
            {styles.map((s) => <option key={s.id} value={s.style_number}>{s.style_text}</option>)}
          </datalist>

          <button onClick={addRow} className="btn-ghost btn-sm"><Plus size={14} /> Add style row</button>

          <div>
            <label className="label">Note (optional)</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Delivery terms, remarks…" />
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <div className="text-sm text-slate-600">Total: <span className="font-bold text-slate-900">{grandQty} pcs</span>{grandAmount > 0 && <> · <span className="font-bold text-slate-900">{grandAmount.toLocaleString()}</span></>}</div>
            <div className="flex gap-2">
              <button onClick={onClose} className="btn-ghost">Cancel</button>
              <button onClick={submit} disabled={saving || grandQty === 0} className="btn-primary">{saving ? 'Saving…' : 'Create PO'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
