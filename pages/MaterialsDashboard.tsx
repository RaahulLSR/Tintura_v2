import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchProcurements,
  fetchProcurementMovements,
  createProcurement,
  advanceProcurement,
  regressProcurement,
  fetchOrders,
  fetchOrderStockCommits,
} from '../services/db';
import {
  MaterialProcurement,
  MaterialMovement,
  MaterialStage,
  MATERIAL_STAGE_ORDER,
  MATERIAL_STAGE_LABEL,
  prevMaterialStage,
  procurementStageQty,
  Order,
  OrderStatus,
  OrderStockCommit,
  formatOrderNumber,
  OrderSortKey,
} from '../types';
import { useAuth } from '../components/Layout';
import {
  Package, Plus, RefreshCcw, Search, X, Clock, FileText, ArrowRight, Mic, AlertCircle,
  ChevronRight, ArrowLeft, CheckCircle2, Layers, PackageCheck, Undo2, ArrowUpDown,
} from 'lucide-react';

const STAGE_COLOR: Record<MaterialStage, string> = {
  [MaterialStage.REQUESTED]: 'bg-slate-300',
  [MaterialStage.ORDERED]: 'bg-amber-400',
  [MaterialStage.RECEIVED]: 'bg-sky-400',
  [MaterialStage.RELEASED]: 'bg-emerald-500',
};
const STAGE_TEXT: Record<MaterialStage, string> = {
  [MaterialStage.REQUESTED]: 'text-slate-600 bg-slate-100',
  [MaterialStage.ORDERED]: 'text-amber-700 bg-amber-50',
  [MaterialStage.RECEIVED]: 'text-sky-700 bg-sky-50',
  [MaterialStage.RELEASED]: 'text-emerald-700 bg-emerald-50',
};

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

// ---- Stacked stage bar ----
const StageBar: React.FC<{ p: MaterialProcurement }> = ({ p }) => (
  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
    {MATERIAL_STAGE_ORDER.map((s) => {
      const q = procurementStageQty(p, s);
      const w = pct(q, p.total_quantity);
      if (w === 0) return null;
      return <div key={s} className={STAGE_COLOR[s]} style={{ width: `${w}%` }} title={`${MATERIAL_STAGE_LABEL[s]}: ${q}`} />;
    })}
  </div>
);

export const MaterialsDashboard: React.FC = () => {
  const { user } = useAuth();
  const actor = user?.full_name || user?.username || 'Materials';
  const canEdit = ['ADMIN', 'ACCESSORIES_MANAGER', 'MANAGER', 'TECH_MANAGER'].includes(user?.role || '');

  const [procs, setProcs] = useState<MaterialProcurement[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [commits, setCommits] = useState<OrderStockCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<OrderSortKey>('issue');
  const [selectedOrderKey, setSelectedOrderKey] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [advanceTarget, setAdvanceTarget] = useState<{ p: MaterialProcurement; to: MaterialStage } | null>(null);
  const [regressTarget, setRegressTarget] = useState<{ p: MaterialProcurement; from: MaterialStage } | null>(null);
  const [timelineFor, setTimelineFor] = useState<MaterialProcurement | null>(null);

  const load = async () => {
    setLoading(true);
    const [p, o, c] = await Promise.all([fetchProcurements(), fetchOrders(), fetchOrderStockCommits()]);
    setProcs(p);
    setOrders(o);
    setCommits(c || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  // Rollup totals per stage (shared across all styles).
  const rollup = useMemo(() => {
    const r: Record<MaterialStage, number> = {
      [MaterialStage.REQUESTED]: 0,
      [MaterialStage.ORDERED]: 0,
      [MaterialStage.RECEIVED]: 0,
      [MaterialStage.RELEASED]: 0,
    };
    procs.forEach((p) => MATERIAL_STAGE_ORDER.forEach((s) => (r[s] += procurementStageQty(p, s))));
    return r;
  }, [procs]);

  // Orders that sub-unit ops has committed to stock (or are marked completed).
  const committedOrderIds = useMemo(() => {
    const set = new Set<string>();
    commits.filter((c) => !c.undone).forEach((c) => c.order_id && set.add(c.order_id));
    orders.filter((o) => o.status === OrderStatus.COMPLETED).forEach((o) => set.add(o.id));
    return set;
  }, [commits, orders]);

  const UNLINKED = '__unlinked__';

  // Group procurement lines by the order they belong to.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; order: Order | null; lines: MaterialProcurement[] }>();
    procs.forEach((p) => {
      const key = p.order_id || UNLINKED;
      if (!map.has(key)) map.set(key, { key, order: orders.find((o) => o.id === p.order_id) || null, lines: [] });
      map.get(key)!.lines.push(p);
    });
    return Array.from(map.values()).map((g) => {
      const totalQty = g.lines.reduce((a, l) => a + l.total_quantity, 0);
      const rel = g.lines.reduce((a, l) => a + procurementStageQty(l, MaterialStage.RELEASED), 0);
      const completed = g.order ? committedOrderIds.has(g.order.id) : false;
      return { ...g, totalQty, releasedQty: rel, completed, materialCount: g.lines.length };
    });
  }, [procs, orders, committedOrderIds]);

  const groupLabel = (g: { order: Order | null; key: string }) =>
    g.order ? formatOrderNumber(g.order) : 'Unlinked materials';

  const filteredGroups = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return groups;
    return groups.filter((g) =>
      groupLabel(g).toLowerCase().includes(t) ||
      g.lines.some((l) =>
        l.material_name.toLowerCase().includes(t) ||
        (l.style_number || '').toLowerCase().includes(t) ||
        (l.invoice_no || '').toLowerCase().includes(t))
    );
  }, [groups, search]);

  const sortedGroups = useMemo(() => {
    const sorted = [...filteredGroups];
    sorted.sort((a, b) => {
      const orderA = a.order;
      const orderB = b.order;
      switch (sortBy) {
        case 'due':
          return (orderA?.target_delivery_date || '9999').localeCompare(orderB?.target_delivery_date || '9999');
        case 'qty':
          return b.totalQty - a.totalQty;
        case 'status':
          return String(a.completed ? 'completed' : 'active').localeCompare(String(b.completed ? 'completed' : 'active'));
        case 'orderno':
          return (orderA ? formatOrderNumber(orderA) : groupLabel(a)).localeCompare(orderB ? formatOrderNumber(orderB) : groupLabel(b), undefined, { numeric: true });
        case 'style':
          return String(orderA?.style_number || '').localeCompare(String(orderB?.style_number || ''));
        case 'issue':
        default:
          return new Date(orderB?.created_at || 0).getTime() - new Date(orderA?.created_at || 0).getTime();
      }
    });
    return sorted;
  }, [filteredGroups, sortBy]);

  const activeGroups = sortedGroups.filter((g) => !g.completed);
  const completedGroups = sortedGroups.filter((g) => g.completed);
  const selectedGroup = selectedOrderKey ? groups.find((g) => g.key === selectedOrderKey) || null : null;

  const orderLabel = (orderId: string | null) => {
    if (!orderId) return null;
    const o = orders.find((x) => x.id === orderId);
    return o ? formatOrderNumber(o) : null;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2"><Package className="text-brand-600" /> Materials</h1>
          <p className="page-subtitle">Procurement lifecycle — Requested → Ordered → Received → Released.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-secondary"><RefreshCcw size={16} /> Refresh</button>
          {canEdit && (
            <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus size={16} /> New procurement</button>
          )}
        </div>
      </div>

      {/* Personalized focus banner */}
      <div className="card card-pad bg-gradient-to-r from-brand-50 to-white border-brand-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Hi {actor.split(' ')[0]} 👋</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {rollup[MaterialStage.REQUESTED] + rollup[MaterialStage.ORDERED] + rollup[MaterialStage.RECEIVED] === 0
                ? 'Nothing pending — every procurement line is released to the floor.'
                : 'Here is what is waiting on the materials desk right now.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-slate-100">
              <span className="text-lg font-black text-slate-700">{rollup[MaterialStage.REQUESTED].toLocaleString()}</span>
              <span className="text-[10px] font-bold text-slate-500 uppercase">To order</span>
            </div>
            <ArrowRight size={14} className="text-slate-300" />
            <div className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-amber-50">
              <span className="text-lg font-black text-amber-700">{rollup[MaterialStage.ORDERED].toLocaleString()}</span>
              <span className="text-[10px] font-bold text-amber-600 uppercase">Awaiting receipt</span>
            </div>
            <ArrowRight size={14} className="text-slate-300" />
            <div className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-sky-50">
              <span className="text-lg font-black text-sky-700">{rollup[MaterialStage.RECEIVED].toLocaleString()}</span>
              <span className="text-[10px] font-bold text-sky-600 uppercase">To release</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end">
        <div className="relative">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as OrderSortKey)}
            className="appearance-none pl-10 pr-8 py-2.5 border border-slate-200 rounded-xl text-sm bg-white text-slate-700 font-semibold outline-none"
            title="Sort materials groups"
          >
            <option value="issue">Issue date</option>
            <option value="due">Due date</option>
            <option value="qty">Volume</option>
            <option value="status">Status</option>
            <option value="orderno">Order number</option>
            <option value="style">Style number</option>
          </select>
          <ArrowUpDown className="absolute left-3 top-3 text-slate-400 pointer-events-none" size={18} />
        </div>
      </div>

      {/* Voice hint */}
      <div className="card card-pad flex items-start gap-3 border-brand-200 bg-brand-50/40">
        <Mic className="text-brand-600 shrink-0 mt-0.5" size={18} />
        <p className="text-sm text-slate-700">
          You can also drive this by voice in the assistant — e.g. <span className="font-medium">“2000 black thread cones
          for style S-101 ordered, invoice INV-4521”</span> or <span className="font-medium">“mark 1000 of that as received”.</span>
          {' '}If you don’t mention an invoice number when ordering, the assistant will ask for it.
        </p>
      </div>

      {selectedGroup ? (
        /* ============ ORDER DRILL-IN ============ */
        (() => {
          const open = selectedGroup.lines.filter((l) => procurementStageQty(l, MaterialStage.RELEASED) < l.total_quantity);
          const issued = selectedGroup.lines.filter((l) => l.total_quantity > 0 && procurementStageQty(l, MaterialStage.RELEASED) >= l.total_quantity);
          return (
            <div className="space-y-5">
              <button onClick={() => setSelectedOrderKey(null)} className="btn-secondary btn-sm"><ArrowLeft size={14} /> All orders</button>

              <div className="card card-pad">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-900">{groupLabel(selectedGroup)}</h2>
                      {selectedGroup.completed
                        ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md"><PackageCheck size={12} /> Committed to stock</span>
                        : <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md"><Clock size={12} /> In progress</span>}
                    </div>
                    {selectedGroup.order && <p className="text-xs text-slate-500 mt-1">Style {selectedGroup.order.style_number}</p>}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-800">{selectedGroup.materialCount} materials · {selectedGroup.totalQty.toLocaleString()} units</div>
                    <div className="text-xs text-slate-500 mt-0.5">{selectedGroup.releasedQty.toLocaleString()} released to floor</div>
                  </div>
                </div>
              </div>

              {/* In procurement */}
              <div>
                <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-700"><Layers size={15} className="text-brand-600" /> In procurement <span className="text-slate-400 font-normal">({open.length})</span></div>
                {open.length === 0 ? (
                  <div className="card card-pad text-center text-slate-400 text-sm">Nothing outstanding — all materials issued.</div>
                ) : (
                  <div className="space-y-3">
                    {open.map((p) => (
                      <ProcurementLineCard key={p.id} p={p} ord={orderLabel(p.order_id)} canEdit={canEdit} onTimeline={() => setTimelineFor(p)} onAdvance={(to) => setAdvanceTarget({ p, to })} onRegress={(from) => setRegressTarget({ p, from })} />
                    ))}
                  </div>
                )}
              </div>

              {/* Issued */}
              <div>
                <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-700"><CheckCircle2 size={15} className="text-emerald-600" /> Issued to floor <span className="text-slate-400 font-normal">({issued.length})</span></div>
                {issued.length === 0 ? (
                  <div className="card card-pad text-center text-slate-400 text-sm">No materials fully issued yet.</div>
                ) : (
                  <div className="space-y-3">
                    {issued.map((p) => (
                      <ProcurementLineCard key={p.id} p={p} ord={orderLabel(p.order_id)} canEdit={canEdit} onTimeline={() => setTimelineFor(p)} onAdvance={(to) => setAdvanceTarget({ p, to })} onRegress={(from) => setRegressTarget({ p, from })} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()
      ) : (
        /* ============ LANDING — grouped by order ============ */
        <>
          {/* Rollup stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {MATERIAL_STAGE_ORDER.map((s) => (
              <div key={s} className="stat-card">
                <div className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${STAGE_TEXT[s]}`}>
                  {MATERIAL_STAGE_LABEL[s]}
                </div>
                <div className="stat-value mt-2">{rollup[s].toLocaleString()}</div>
                <div className="stat-label">units total</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="relative max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search order, material, style or invoice…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="card card-pad text-center text-slate-500">Loading…</div>
          ) : filteredGroups.length === 0 ? (
            <div className="card card-pad text-center text-slate-400">No procurement lines yet.</div>
          ) : (
            <div className="space-y-6">
              {/* Active orders */}
              <div>
                <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-700"><Layers size={15} className="text-brand-600" /> Active orders <span className="text-slate-400 font-normal">({activeGroups.length})</span></div>
                {activeGroups.length === 0 ? (
                  <div className="card card-pad text-center text-slate-400 text-sm">No active orders.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeGroups.map((g) => (
                      <OrderSummaryCard key={g.key} g={g} label={groupLabel(g)} onOpen={() => setSelectedOrderKey(g.key)} />
                    ))}
                  </div>
                )}
              </div>

              {/* Completed orders */}
              {completedGroups.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-slate-700"><PackageCheck size={15} className="text-emerald-600" /> Completed orders <span className="text-slate-400 font-normal">({completedGroups.length})</span></div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {completedGroups.map((g) => (
                      <OrderSummaryCard key={g.key} g={g} label={groupLabel(g)} completed onOpen={() => setSelectedOrderKey(g.key)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showCreate && (
        <CreateProcurementModal
          orders={orders}
          actor={actor}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}
      {advanceTarget && (
        <AdvanceModal
          p={advanceTarget.p}
          to={advanceTarget.to}
          actor={actor}
          onClose={() => setAdvanceTarget(null)}
          onSaved={() => { setAdvanceTarget(null); load(); }}
        />
      )}
      {regressTarget && (
        <RegressModal
          p={regressTarget.p}
          from={regressTarget.from}
          actor={actor}
          onClose={() => setRegressTarget(null)}
          onSaved={() => { setRegressTarget(null); load(); }}
        />
      )}
      {timelineFor && <TimelineModal p={timelineFor} onClose={() => setTimelineFor(null)} />}
    </div>
  );
};

// ---------------- Order summary card (landing) ----------------
const OrderSummaryCard: React.FC<{
  g: { totalQty: number; releasedQty: number; materialCount: number; lines: MaterialProcurement[] };
  label: string;
  completed?: boolean;
  onOpen: () => void;
}> = ({ g, label, completed, onOpen }) => {
  const agg: Record<MaterialStage, number> = {
    [MaterialStage.REQUESTED]: 0,
    [MaterialStage.ORDERED]: 0,
    [MaterialStage.RECEIVED]: 0,
    [MaterialStage.RELEASED]: 0,
  };
  g.lines.forEach((l) => MATERIAL_STAGE_ORDER.forEach((s) => (agg[s] += procurementStageQty(l, s))));
  const total = MATERIAL_STAGE_ORDER.reduce((a, s) => a + agg[s], 0) || 1;
  return (
    <button onClick={onOpen} className="card card-pad text-left hover:border-brand-300 hover:shadow-sm transition w-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate">{label}</div>
          <div className="text-xs text-slate-500 mt-0.5">{g.materialCount} materials · {g.totalQty.toLocaleString()} units</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {completed && <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md"><PackageCheck size={12} /> Stock</span>}
          <ChevronRight size={18} className="text-slate-400" />
        </div>
      </div>
      <div className="mt-3 flex h-2 rounded-full overflow-hidden bg-slate-100">
        {MATERIAL_STAGE_ORDER.map((s) => (
          <div key={s} className={STAGE_COLOR[s]} style={{ width: `${(agg[s] / total) * 100}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {MATERIAL_STAGE_ORDER.map((s) => (
          <span key={s} className="text-[11px] text-slate-500">
            <span className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${STAGE_COLOR[s]}`} />
            {MATERIAL_STAGE_LABEL[s]} <span className="font-semibold text-slate-700">{agg[s].toLocaleString()}</span>
          </span>
        ))}
      </div>
    </button>
  );
};

// ---------------- Procurement line card (drill-in) ----------------
const ProcurementLineCard: React.FC<{
  p: MaterialProcurement;
  ord: string | null;
  canEdit: boolean;
  onTimeline: () => void;
  onAdvance: (to: MaterialStage) => void;
  onRegress: (from: MaterialStage) => void;
}> = ({ p, ord, canEdit, onTimeline, onAdvance, onRegress }) => (
  <div className="card card-pad">
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <div className="font-semibold text-slate-900">{p.material_name}</div>
        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span className="badge">Style {p.style_number || '—'}</span>
          {ord && <span className="badge">{ord}</span>}
          {p.invoice_no && (
            <span className="inline-flex items-center gap-1 text-slate-600">
              <FileText size={12} /> {p.invoice_no}
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold text-slate-800">{p.total_quantity.toLocaleString()} {p.unit}</div>
        <button onClick={onTimeline} className="text-xs text-brand-600 hover:underline inline-flex items-center gap-1 mt-0.5">
          <Clock size={12} /> Timeline
        </button>
      </div>
    </div>

    <div className="mt-3"><StageBar p={p} /></div>

    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
      {MATERIAL_STAGE_ORDER.map((s) => {
        const q = procurementStageQty(p, s);
        return (
          <div key={s} className="text-xs">
            <span className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${STAGE_COLOR[s]}`} />
            <span className="text-slate-500">{MATERIAL_STAGE_LABEL[s]}</span>
            <span className="ml-1 font-semibold text-slate-800">{q}</span>
            <span className="ml-1 text-slate-400">({pct(q, p.total_quantity)}%)</span>
          </div>
        );
      })}
    </div>

    {canEdit && (
      <div className="mt-3 flex flex-wrap gap-2">
        {[MaterialStage.ORDERED, MaterialStage.RECEIVED, MaterialStage.RELEASED].map((to) => {
          const from = prevMaterialStage(to)!;
          const avail = procurementStageQty(p, from);
          if (avail <= 0) return null;
          return (
            <button key={to} onClick={() => onAdvance(to)} className="btn-secondary btn-sm">
              {MATERIAL_STAGE_LABEL[from]} <ArrowRight size={12} /> {MATERIAL_STAGE_LABEL[to]}
            </button>
          );
        })}
      </div>
    )}

    {canEdit && (() => {
      // Correction row: pull a quantity back a stage if it was advanced by mistake.
      const backable = [MaterialStage.ORDERED, MaterialStage.RECEIVED, MaterialStage.RELEASED]
        .filter((from) => procurementStageQty(p, from) > 0);
      if (!backable.length) return null;
      return (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
          <span className="text-[11px] font-semibold text-slate-400 inline-flex items-center gap-1"><Undo2 size={12} /> Correct:</span>
          {backable.map((from) => (
            <button key={from} onClick={() => onRegress(from)} className="btn-ghost btn-sm text-amber-700 hover:bg-amber-50">
              {MATERIAL_STAGE_LABEL[from]} <ArrowLeft size={12} /> {MATERIAL_STAGE_LABEL[prevMaterialStage(from)!]}
            </button>
          ))}
        </div>
      );
    })()}
  </div>
);

// ---------------- Create modal ----------------
const CreateProcurementModal: React.FC<{
  orders: Order[];
  actor: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ orders, actor, onClose, onSaved }) => {
  const [styleNumber, setStyleNumber] = useState('');
  const [orderId, setOrderId] = useState('');
  const [materialName, setMaterialName] = useState('');
  const [quantity, setQuantity] = useState<number>(0);
  const [unit, setUnit] = useState('Nos');
  const [startStage, setStartStage] = useState<MaterialStage>(MaterialStage.REQUESTED);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const needsInvoice = startStage === MaterialStage.ORDERED;

  const onPickOrder = (id: string) => {
    setOrderId(id);
    const o = orders.find((x) => x.id === id);
    if (o) setStyleNumber(o.style_number);
  };

  const save = async () => {
    setError('');
    if (!materialName.trim()) return setError('Material name is required.');
    if (!styleNumber.trim()) return setError('Style number is required.');
    if (quantity <= 0) return setError('Quantity must be greater than zero.');
    if (needsInvoice && !invoiceNo.trim()) return setError('An invoice number is required to log this as ordered.');
    setSaving(true);
    try {
      await createProcurement({
        order_id: orderId || null,
        style_number: styleNumber.trim(),
        material_name: materialName.trim(),
        unit,
        total_quantity: quantity,
        startStage,
        invoice_no: invoiceNo.trim() || null,
        note: note.trim() || undefined,
        created_by_name: actor,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Failed to save.');
      setSaving(false);
    }
  };

  return (
    <Modal title="New procurement" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label">Link to order (optional)</label>
          <select className="select" value={orderId} onChange={(e) => onPickOrder(e.target.value)}>
            <option value="">— not linked —</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>{formatOrderNumber(o)} · {o.style_number}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Style number</label>
            <input className="input" value={styleNumber} onChange={(e) => setStyleNumber(e.target.value)} placeholder="S-101" />
          </div>
          <div>
            <label className="label">Unit</label>
            <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Nos / cones / kg" />
          </div>
        </div>
        <div>
          <label className="label">Material</label>
          <input className="input" value={materialName} onChange={(e) => setMaterialName(e.target.value)} placeholder="Black sewing thread (cone)" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Total quantity</label>
            <input className="input" type="number" min={0} value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Starting stage</label>
            <select className="select" value={startStage} onChange={(e) => setStartStage(e.target.value as MaterialStage)}>
              <option value={MaterialStage.REQUESTED}>Requested</option>
              <option value={MaterialStage.ORDERED}>Ordered (needs invoice)</option>
            </select>
          </div>
        </div>
        {needsInvoice && (
          <div>
            <label className="label">Invoice number</label>
            <input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV-4521" />
          </div>
        )}
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <div className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------- Advance modal ----------------
const AdvanceModal: React.FC<{
  p: MaterialProcurement;
  to: MaterialStage;
  actor: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ p, to, actor, onClose, onSaved }) => {
  const from = prevMaterialStage(to)!;
  const available = procurementStageQty(p, from);
  const [qty, setQty] = useState<number>(available);
  const [invoiceNo, setInvoiceNo] = useState(p.invoice_no || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const needsInvoice = to === MaterialStage.ORDERED;

  const save = async () => {
    setError('');
    if (qty <= 0 || qty > available) return setError(`Enter a quantity between 1 and ${available}.`);
    if (needsInvoice && !invoiceNo.trim()) return setError('An invoice number is required to mark this as ordered.');
    setSaving(true);
    try {
      await advanceProcurement(p.id, qty, to, {
        invoice_no: invoiceNo.trim() || null,
        note: note.trim() || undefined,
        created_by_name: actor,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Failed to advance.');
      setSaving(false);
    }
  };

  return (
    <Modal title={`${MATERIAL_STAGE_LABEL[from]} → ${MATERIAL_STAGE_LABEL[to]}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-slate-600">
          {p.material_name} · <span className="font-medium">{available} {p.unit}</span> available at {MATERIAL_STAGE_LABEL[from]}.
        </div>
        <div>
          <label className="label">Quantity to move</label>
          <input className="input" type="number" min={1} max={available} value={qty || ''} onChange={(e) => setQty(Number(e.target.value))} />
        </div>
        {needsInvoice && (
          <div>
            <label className="label">Invoice number</label>
            <input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="INV-4521" />
          </div>
        )}
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <div className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Confirm'}</button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------- Correction (step-back) modal ----------------
const RegressModal: React.FC<{
  p: MaterialProcurement;
  from: MaterialStage;
  actor: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ p, from, actor, onClose, onSaved }) => {
  const to = prevMaterialStage(from)!;
  const available = procurementStageQty(p, from);
  const [qty, setQty] = useState<number>(available);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    if (qty <= 0 || qty > available) return setError(`Enter a quantity between 1 and ${available}.`);
    setSaving(true);
    try {
      await regressProcurement(p.id, qty, from, {
        note: note.trim() || undefined,
        created_by_name: actor,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Failed to correct.');
      setSaving(false);
    }
  };

  return (
    <Modal title={`Correct — ${MATERIAL_STAGE_LABEL[from]} → ${MATERIAL_STAGE_LABEL[to]}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Undo2 size={15} className="shrink-0 mt-0.5" />
          <span>Pull a quantity back if it was advanced by mistake. {p.material_name} has <span className="font-semibold">{available} {p.unit}</span> at {MATERIAL_STAGE_LABEL[from]}.</span>
        </div>
        <div>
          <label className="label">Quantity to pull back</label>
          <input className="input" type="number" min={1} max={available} value={qty || ''} onChange={(e) => setQty(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Reason (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. marked received too early" />
        </div>
        {error && <div className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Pull back'}</button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------- Timeline modal ----------------
const TimelineModal: React.FC<{ p: MaterialProcurement; onClose: () => void }> = ({ p, onClose }) => {
  const [moves, setMoves] = useState<MaterialMovement[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchProcurementMovements(p.id).then((m) => { setMoves(m); setLoading(false); });
  }, [p.id]);

  return (
    <Modal title={`Timeline — ${p.material_name}`} onClose={onClose}>
      {loading ? (
        <div className="text-center text-slate-500 py-6">Loading…</div>
      ) : moves.length === 0 ? (
        <div className="text-center text-slate-400 py-6">No movements recorded.</div>
      ) : (
        <ol className="space-y-3">
          {moves.map((m) => (
            <li key={m.id} className="flex items-start gap-3">
              <div className="mt-1 w-2 h-2 rounded-full bg-brand-500 shrink-0" />
              <div className="text-sm">
                <div className="text-slate-800">
                  <span className="font-medium">{m.qty} {p.unit}</span>{' '}
                  {m.from_stage === 'NEW' ? 'created at' : `${m.from_stage} →`} {m.to_stage}
                  {m.invoice_no && <span className="text-slate-500"> · {m.invoice_no}</span>}
                </div>
                <div className="text-xs text-slate-400">
                  {new Date(m.created_at).toLocaleString()}{m.created_by_name ? ` · ${m.created_by_name}` : ''}
                </div>
                {m.note && <div className="text-xs text-slate-500 mt-0.5">{m.note}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
};

// ---------------- Generic modal shell ----------------
const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
    <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);
