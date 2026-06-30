import React, { useEffect, useMemo, useState } from 'react';
import { fetchStyles, fetchStockLevels, fetchOrders } from '../services/db';
import { Style, StockLevel, Order, OrderStatus } from '../types';
import { sizeLabelParts } from '../services/sizes';
import { useAuth } from '../components/Layout';
import { Package, Search, RefreshCcw, Boxes, Layers, Palette, Factory } from 'lucide-react';

export const InventoryDashboard: React.FC = () => {
  const { user } = useAuth();
  const [styles, setStyles] = useState<Style[]>([]);
  const [stock, setStock] = useState<StockLevel[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    const [s, lv, o] = await Promise.all([fetchStyles(), fetchStockLevels(), fetchOrders()]);
    setStyles(s);
    setStock(lv);
    setOrders(o);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // qty lookup: style -> color -> size -> qty
  const stockMap = useMemo(() => {
    const m: Record<string, Record<string, Record<string, number>>> = {};
    for (const row of stock) {
      m[row.style_number] ??= {};
      m[row.style_number][row.color] ??= {};
      m[row.style_number][row.color][row.size] = (m[row.style_number][row.color][row.size] || 0) + row.quantity;
    }
    return m;
  }, [stock]);

  const totalUnits = useMemo(() => stock.reduce((a, r) => a + r.quantity, 0), [stock]);
  const stylesInStock = useMemo(
    () => new Set(stock.filter(r => r.quantity > 0).map(r => r.style_number)).size,
    [stock]
  );

  // In production = orders not yet completed/committed to stock, grouped by style.
  const inProduction = useMemo(() => {
    const open = orders.filter(o => o.status !== OrderStatus.COMPLETED);
    const byStyle: Record<string, number> = {};
    for (const o of open) byStyle[o.style_number] = (byStyle[o.style_number] || 0) + (Number(o.quantity) || 0);
    const totalUnits = Object.values(byStyle).reduce((a, n) => a + n, 0);
    return { byStyle, totalUnits, orderCount: open.length, styleCount: Object.keys(byStyle).length };
  }, [orders]);

  // Merge in any style_number that has stock but is NOT in the Style master,
  // so committed inventory always shows up even without a master record.
  const mergedStyles = useMemo(() => {
    const known = new Set(styles.map(s => s.style_number));
    const extras: Style[] = [];
    for (const styleNo of Object.keys(stockMap)) {
      if (known.has(styleNo)) continue;
      const colors = Object.keys(stockMap[styleNo] || {});
      const sizes = Array.from(new Set(Object.values(stockMap[styleNo] || {}).flatMap(c => Object.keys(c))));
      extras.push({
        id: `stock-${styleNo}`,
        style_number: styleNo,
        style_text: '',
        category: 'Stock only (no master)',
        packing_type: '',
        pcs_per_box: 0,
        tech_pack: {},
        available_colors: colors,
        available_sizes: sizes,
      } as Style);
    }
    return [...styles, ...extras];
  }, [styles, stockMap]);

  const visibleStyles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mergedStyles;
    return mergedStyles.filter(s =>
      s.style_number.toLowerCase().includes(q) ||
      (s.category || '').toLowerCase().includes(q));
  }, [mergedStyles, search]);

  const styleTotal = (styleNo: string) => {
    const colors = stockMap[styleNo];
    if (!colors) return 0;
    let t = 0;
    for (const c of Object.values(colors)) for (const q of Object.values(c)) t += q;
    return t;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Package className="text-brand-600" /> Inventory
          </h1>
          <p className="page-subtitle">Live finished-goods stock by style, colour and size.</p>
        </div>
        <button onClick={load} className="btn-secondary">
          <RefreshCcw size={16} /> Refresh
        </button>
      </div>

      {/* Personalized banner */}
      <div className="card card-pad bg-gradient-to-r from-brand-50 to-white border-brand-200">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">Hi {(user?.full_name || user?.username || 'there').split(' ')[0]} 👋</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {totalUnits.toLocaleString()} units finished and on the shelf · {inProduction.totalUnits.toLocaleString()} still being produced.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-emerald-50">
              <span className="text-lg font-black text-emerald-700">{totalUnits.toLocaleString()}</span>
              <span className="text-[10px] font-bold text-emerald-600 uppercase">On hand</span>
            </div>
            <div className="flex flex-col items-center px-3 py-1.5 rounded-xl bg-amber-50">
              <span className="text-lg font-black text-amber-700">{inProduction.totalUnits.toLocaleString()}</span>
              <span className="text-[10px] font-bold text-amber-600 uppercase">In production</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 text-slate-500"><Boxes size={16} /><span className="stat-label">Total Units in Stock</span></div>
          <span className="stat-value">{totalUnits.toLocaleString()}</span>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-slate-500"><Factory size={16} /><span className="stat-label">In Production</span></div>
          <span className="stat-value">{inProduction.totalUnits.toLocaleString()}</span>
          <span className="text-[11px] text-slate-400 mt-0.5">{inProduction.orderCount} open order{inProduction.orderCount === 1 ? '' : 's'}</span>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-slate-500"><Layers size={16} /><span className="stat-label">Styles in Stock</span></div>
          <span className="stat-value">{stylesInStock}</span>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 text-slate-500"><Palette size={16} /><span className="stat-label">Total Styles</span></div>
          <span className="stat-value">{styles.length}</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          className="input pl-10"
          placeholder="Search by style number or category…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="card card-pad text-center text-slate-500">Loading inventory…</div>
      ) : visibleStyles.length === 0 ? (
        <div className="card card-pad text-center text-slate-500">No styles found.</div>
      ) : (
        <div className="space-y-4">
          {visibleStyles.map(style => {
            const colors = style.available_colors?.length
              ? style.available_colors
              : Object.keys(stockMap[style.style_number] || {});
            const sizes = style.available_sizes?.length
              ? style.available_sizes
              : Array.from(new Set(Object.values(stockMap[style.style_number] || {}).flatMap(c => Object.keys(c))));
            const total = styleTotal(style.style_number);
            const producing = inProduction.byStyle[style.style_number] || 0;

            return (
              <div key={style.id} className="card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
                  <div>
                    <span className="font-bold text-slate-900">{style.style_number}</span>
                    {style.category && <span className="ml-2 text-xs text-slate-500">{style.category}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {producing > 0 && (
                      <span className="badge bg-amber-50 text-amber-700 border-amber-200 inline-flex items-center gap-1">
                        <Factory size={11} /> {producing.toLocaleString()} in production
                      </span>
                    )}
                    <span className={`badge ${total > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                      {total.toLocaleString()} units
                    </span>
                  </div>
                </div>

                {colors.length === 0 || sizes.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-slate-400">No colour/size grid defined for this style.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-100">
                          <th className="text-left font-semibold px-5 py-2 sticky left-0 bg-white">Colour</th>
                          {sizes.map(sz => {
                            const { top, bottom } = sizeLabelParts(sz);
                            return (
                              <th key={sz} className="px-3 py-2 text-center font-semibold">
                                <div className="flex flex-col items-center leading-none">
                                  <span>{top}</span>
                                  {bottom && <span className="text-[10px] text-slate-400 font-medium">{bottom}</span>}
                                </div>
                              </th>
                            );
                          })}
                          <th className="px-4 py-2 text-center font-semibold">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {colors.map(color => {
                          const cells = stockMap[style.style_number]?.[color] || {};
                          const rowTotal = Object.values(cells).reduce((a, q) => a + q, 0);
                          return (
                            <tr key={color} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                              <td className="px-5 py-2 font-medium text-slate-700 sticky left-0 bg-white">{color}</td>
                              {sizes.map(sz => {
                                const q = cells[sz] || 0;
                                return (
                                  <td key={sz} className={`px-3 py-2 text-center tabular-nums ${q > 0 ? 'text-slate-900 font-semibold' : 'text-slate-300'}`}>
                                    {q || '–'}
                                  </td>
                                );
                              })}
                              <td className="px-4 py-2 text-center font-bold text-slate-900 tabular-nums">{rowTotal || '–'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
