import React from 'react';
import { ArrowLeftRight, X, Palette, Ruler, Box, Calculator } from 'lucide-react';
import { Style, StyleTemplate, TechPackItem } from '../../types';

interface CompareViewProps {
  compareList: Style[];
  template: StyleTemplate | null;
  onRemove: (id: string) => void;
  onBackToCatalog: () => void;
}

const RatioBadge: React.FC<{ item: { consumption_type?: string; consumption_val?: number } }> = ({ item }) =>
  item.consumption_type ? (
    <span className="inline-flex items-center gap-1 text-[9px] font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 ml-1">
      <Calculator size={10} />{item.consumption_val} {item.consumption_type === 'items_per_pc' ? 'i/pc' : 'pc/i'}
    </span>
  ) : null;

const TechCell: React.FC<{ item?: TechPackItem }> = ({ item }) => {
  if (!item) return <span className="text-slate-300 italic text-xs">—</span>;
  if (!item.variants) {
    return (
      <div className="text-xs font-medium text-slate-700 whitespace-pre-wrap leading-relaxed">
        {item.text || <span className="text-slate-300 italic">—</span>}
        <RatioBadge item={item} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {item.variants.map((v, i) => (
        <div key={i} className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-2">
          <div className="flex flex-wrap gap-1 mb-1">
            {v.colors.length ? v.colors.map(c => (
              <span key={c} className="bg-indigo-600 text-white text-[8px] font-black px-1.5 py-0.5 rounded uppercase">{c}</span>
            )) : <span className="text-[9px] text-slate-400 italic">shared</span>}
            <RatioBadge item={v} />
          </div>
          {v.sizeVariants ? (
            <div className="space-y-1 pl-2 border-l-2 border-blue-200">
              {v.sizeVariants.map((sv, j) => (
                <div key={j} className="text-[11px] text-slate-700">
                  <span className="font-black text-blue-600">{sv.sizes.join('/') || '?'}:</span> {sv.text || '—'}
                  <RatioBadge item={sv} />
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-slate-700 whitespace-pre-wrap">{v.text || '—'}</div>
          )}
        </div>
      ))}
    </div>
  );
};

export const CompareView: React.FC<CompareViewProps> = ({ compareList, template, onRemove, onBackToCatalog }) => {
  if (compareList.length === 0) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl min-h-[500px] flex flex-col items-center justify-center text-center p-20 animate-fade-in">
        <ArrowLeftRight size={48} className="mb-4 text-slate-200" />
        <p className="text-xl font-black text-slate-500">Compare desk is empty</p>
        <p className="text-sm text-slate-400 mt-2 mb-6">Add styles from the catalog to line them up side by side.</p>
        <button onClick={onBackToCatalog} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-sm hover:bg-indigo-700 transition-all">Back to Catalog</button>
      </div>
    );
  }

  const techCats = (template?.config || []).filter(c => c.name !== 'General Info' && c.fields.length > 0);
  const labelCellW = 'w-44 min-w-44 max-w-44';
  const styleCellW = 'w-72 min-w-72';

  const Row: React.FC<{ label: React.ReactNode; render: (s: Style) => React.ReactNode; tint?: boolean }> = ({ label, render, tint }) => (
    <tr className={tint ? 'bg-slate-50/40' : ''}>
      <td className={`${labelCellW} sticky left-0 z-10 align-top p-4 bg-white border-r border-slate-100 text-[10px] font-black text-slate-500 uppercase tracking-widest`}>{label}</td>
      {compareList.map(s => (
        <td key={s.id} className={`${styleCellW} align-top p-4 border-r border-slate-100`}>{render(s)}</td>
      ))}
    </tr>
  );

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-x-auto animate-fade-in">
      <table className="border-collapse w-max">
        <thead>
          <tr className="border-b-2 border-slate-100">
            <th className={`${labelCellW} sticky left-0 z-20 bg-white p-4 text-left border-r border-slate-100`}>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{compareList.length} styles</span>
            </th>
            {compareList.map(s => (
              <th key={s.id} className={`${styleCellW} p-4 text-left border-r border-slate-100 bg-slate-50/60`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xl font-black text-slate-800">{s.style_number}</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="text-[9px] font-black bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full uppercase">{s.category}</span>
                      <span className="text-[9px] font-black bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full uppercase">{s.garment_type}</span>
                    </div>
                  </div>
                  <button onClick={() => onRemove(s.id)} className="p-1 text-slate-300 hover:text-red-500 transition-colors"><X size={18} /></button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr><td colSpan={compareList.length + 1} className="px-4 pt-5 pb-1 text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] sticky left-0">Attributes</td></tr>
          <Row label={<span className="flex items-center gap-1.5"><Palette size={12} /> Colours</span>} tint render={s => (
            <div className="flex flex-wrap gap-1">{(s.available_colors || []).filter(c => c.trim()).map((c, i) => <span key={i} className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{c}</span>)}{!(s.available_colors || []).filter(c => c.trim()).length && <span className="text-slate-300 italic text-xs">—</span>}</div>
          )} />
          <Row label={<span className="flex items-center gap-1.5"><Ruler size={12} /> Sizes</span>} render={s => (
            <div className="flex flex-wrap gap-1">{(s.available_sizes || []).map((sz, i) => <span key={i} className="text-[10px] font-bold bg-indigo-600 text-white px-2 py-0.5 rounded">{sz}</span>)}</div>
          )} />
          <Row label={<span className="flex items-center gap-1.5"><Box size={12} /> Packing</span>} tint render={s => (
            <span className="text-xs font-bold text-slate-700 capitalize">{s.packing_type} · {s.pcs_per_box}/box</span>
          )} />

          {techCats.map(cat => (
            <React.Fragment key={cat.name}>
              <tr><td colSpan={compareList.length + 1} className="px-4 pt-5 pb-1 text-[10px] font-black text-indigo-400 uppercase tracking-[0.3em] sticky left-0">{cat.name}</td></tr>
              {cat.fields.map((field, fi) => (
                <Row key={field} label={field} tint={fi % 2 === 1} render={s => <TechCell item={s.tech_pack[cat.name]?.[field]} />} />
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};
