import React, { useMemo, useState } from 'react';
import { Order, OrderStockCommit, StockCommitLine, getSizeKeyFromLabel } from '../../types';
import { X, Boxes, Undo2, PackageCheck, AlertCircle } from 'lucide-react';

interface StockCommitModalProps {
  order: Order;
  commits: OrderStockCommit[];
  saving?: boolean;
  onCommit: (lines: StockCommitLine[]) => void;
  onUndo: (commit: OrderStockCommit) => void;
  onClose: () => void;
}

export const StockCommitModal: React.FC<StockCommitModalProps> = ({
  order, commits, saving, onCommit, onUndo, onClose,
}) => {
  const numeric = order.size_format === 'numeric';
  const sizeLabels = order.size_sequence && order.size_sequence.length > 0
    ? order.size_sequence
    : (numeric ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL']);

  const labelToKey = useMemo(() => {
    const m: Record<string, string> = {};
    sizeLabels.forEach((l) => { m[l] = getSizeKeyFromLabel(l, numeric ? 'numeric' : 'standard'); });
    return m;
  }, [sizeLabels, numeric]);

  // Rows + per-cell caps come from the planned order breakdown, so completed
  // pieces can be entered and committed here in one step. Falls back to a
  // previously recorded completion breakdown for older orders.
  const completedRows = (order.size_breakdown && order.size_breakdown.length > 0)
    ? order.size_breakdown
    : (order.completion_breakdown || []);

  // Already-committed (non-undone) qty per color|label.
  const committed = useMemo(() => {
    const m: Record<string, number> = {};
    commits.filter((c) => !c.undone).forEach((c) => {
      (c.breakdown || []).forEach((l) => {
        const k = `${l.color}|${l.size}`;
        m[k] = (m[k] || 0) + l.qty;
      });
    });
    return m;
  }, [commits]);

  const remainingFor = (color: string, label: string, key: string) => {
    const row = completedRows.find((r) => r.color === color);
    const done = (row?.[key] as number) || 0;
    return Math.max(0, done - (committed[`${color}|${label}`] || 0));
  };

  // Editable "commit now" amounts, default to remaining.
  const [amounts, setAmounts] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    completedRows.forEach((row) => {
      sizeLabels.forEach((label) => {
        const key = labelToKey[label];
        init[`${row.color}|${label}`] = remainingFor(row.color, label, key);
      });
    });
    return init;
  });

  const [error, setError] = useState('');

  const totalNow = Object.values(amounts).reduce((s, n) => s + (n || 0), 0);

  const setAmount = (color: string, label: string, key: string, raw: number) => {
    const max = remainingFor(color, label, key);
    setAmounts((p) => ({ ...p, [`${color}|${label}`]: Math.max(0, Math.min(max, raw || 0)) }));
  };

  const fillRemaining = () => {
    const next: Record<string, number> = {};
    completedRows.forEach((row) => {
      sizeLabels.forEach((label) => next[`${row.color}|${label}`] = remainingFor(row.color, label, labelToKey[label]));
    });
    setAmounts(next);
  };
  const clearAll = () => setAmounts({});

  const submit = () => {
    setError('');
    const lines: StockCommitLine[] = [];
    completedRows.forEach((row) => {
      sizeLabels.forEach((label) => {
        const qty = amounts[`${row.color}|${label}`] || 0;
        if (qty > 0) lines.push({ color: row.color, size: label, qty });
      });
    });
    if (lines.length === 0) return setError('Enter at least one quantity to commit.');
    onCommit(lines);
  };

  const recent = commits.slice(0, 6);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Boxes className="text-brand-600" size={18} /> Commit to stock — {order.order_no}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-5">
          <p className="text-sm text-slate-600">
            Enter the pieces completed for each colour / size and push them into
            inventory. Committing also marks the order complete. You can commit
            part now and the rest later.
          </p>

          {completedRows.length === 0 ? (
            <div className="card-pad text-center text-slate-400 border border-dashed rounded-lg">
              This order has no size breakdown to commit.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-center text-sm min-w-max">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="p-2.5 text-left">Colour</th>
                    {sizeLabels.map((l) => <th key={l} className="p-2.5 w-20">{l}</th>)}
                    <th className="p-2.5">Row</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {completedRows.map((row, idx) => {
                    let rowTotal = 0;
                    return (
                      <tr key={idx}>
                        <td className="p-2.5 text-left font-medium text-slate-700">{row.color}</td>
                        {sizeLabels.map((label) => {
                          const key = labelToKey[label];
                          const rem = remainingFor(row.color, label, key);
                          const val = amounts[`${row.color}|${label}`] || 0;
                          rowTotal += val;
                          return (
                            <td key={label} className="p-1.5">
                              <input
                                type="number" min={0} max={rem}
                                disabled={rem === 0}
                                className="input text-center px-1 py-1 w-16 disabled:bg-slate-50 disabled:text-slate-300"
                                value={val || ''}
                                onChange={(e) => setAmount(row.color, label, key, parseInt(e.target.value) || 0)}
                              />
                              <div className="text-[10px] text-slate-400 mt-0.5">/ {rem}</div>
                            </td>
                          );
                        })}
                        <td className="p-2.5 font-semibold text-slate-800">{rowTotal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex gap-2">
              <button onClick={fillRemaining} className="btn-secondary btn-sm">Fill remaining</button>
              <button onClick={clearAll} className="btn-ghost btn-sm">Clear</button>
            </div>
            <div className="text-sm text-slate-600">Committing now: <span className="font-semibold text-slate-900">{totalNow}</span> pcs</div>
          </div>

          {error && <div className="text-sm text-red-600 flex items-center gap-1"><AlertCircle size={14} /> {error}</div>}

          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={onClose}>Close</button>
            <button className="btn-primary" onClick={submit} disabled={saving || totalNow === 0}>
              <PackageCheck size={16} /> {saving ? 'Committing…' : `Commit ${totalNow} pcs`}
            </button>
          </div>

          {/* Prior commits */}
          {recent.length > 0 && (
            <div className="pt-2 border-t border-slate-200">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Recent commits</div>
              <ul className="space-y-2">
                {recent.map((c) => (
                  <li key={c.id} className={`flex items-center justify-between text-sm rounded-lg border px-3 py-2 ${c.undone ? 'border-slate-100 bg-slate-50 text-slate-400' : 'border-slate-200'}`}>
                    <div>
                      <span className="font-semibold">{c.total_items} pcs</span>
                      <span className="text-slate-400"> · {new Date(c.created_at).toLocaleString()}</span>
                      {c.undone && <span className="ml-2 badge">undone</span>}
                    </div>
                    {!c.undone && (
                      <button onClick={() => onUndo(c)} className="btn-ghost btn-sm text-red-600">
                        <Undo2 size={14} /> Undo
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
