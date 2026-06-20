
import React from 'react';
import { Order, SizeBreakdown, getSizeKeyFromLabel } from '../../types';
import { X, CheckCircle2, AlertTriangle, ArrowLeftRight } from 'lucide-react';

interface CompletionModalProps {
  order: Order;
  form: { breakdown: SizeBreakdown[]; actualBoxCount: number };
  useNumericSizes: boolean;
  onToggleSizeFormat: () => void;
  onUpdateRow: (index: number, field: string, value: number) => void;
  onUpdateBoxCount: (count: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export const CompletionModal: React.FC<CompletionModalProps> = ({
  order,
  form,
  useNumericSizes,
  onToggleSizeFormat,
  onUpdateRow,
  onUpdateBoxCount,
  onSubmit,
  onClose
}) => {
  const sizeLabels = order.size_sequence && order.size_sequence.length > 0 
    ? order.size_sequence 
    : (useNumericSizes ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL']);

  const getRowTotal = (row: SizeBreakdown) => {
    let total = 0;
    sizeLabels.forEach(label => {
      const key = getSizeKeyFromLabel(label, useNumericSizes ? 'numeric' : 'standard');
      total += (row[key] || 0);
    });
    return total;
  };

  const orderedTotal = order.quantity
    || (order.size_breakdown || []).reduce((sum, r) => {
      let t = 0;
      (['s', 'm', 'l', 'xl', 'xxl', 'xxxl'] as const).forEach(k => { t += (r[k] || 0); });
      return sum + t;
    }, 0);
  const completedTotal = form.breakdown.reduce((sum, r) => sum + getRowTotal(r), 0);
  const variance = completedTotal - orderedTotal;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden max-h-[90vh] flex flex-col animate-scale-up">
        <div className="p-6 border-b flex justify-between items-center bg-green-50">
          <h3 className="text-xl font-bold text-green-900 flex items-center gap-2">
            <CheckCircle2 /> Complete Order: {order.order_no}
          </h3>
          <button onClick={onClose} className="text-green-700 hover:text-green-900"><X size={24} /></button>
        </div>
        
        <form onSubmit={onSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200 text-sm text-yellow-800 flex items-center gap-2">
            <AlertTriangle size={18} />
            Please enter the <strong>ACTUAL</strong> quantities produced.
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Ordered</div>
              <div className="text-2xl font-black text-slate-800">{orderedTotal}</div>
            </div>
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
              <div className="text-[11px] font-bold uppercase tracking-wide text-green-500">Completed</div>
              <div className="text-2xl font-black text-green-700">{completedTotal}</div>
            </div>
            <div className={`rounded-lg border p-3 text-center ${variance === 0 ? 'border-slate-200 bg-slate-50' : variance < 0 ? 'border-amber-200 bg-amber-50' : 'border-blue-200 bg-blue-50'}`}>
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Variance</div>
              <div className={`text-2xl font-black ${variance === 0 ? 'text-slate-700' : variance < 0 ? 'text-amber-600' : 'text-blue-600'}`}>{variance > 0 ? `+${variance}` : variance}</div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Actual Box Count</label>
            <input 
              type="number" 
              required
              min="0"
              className="w-32 border border-slate-300 rounded p-2 text-lg font-bold bg-white text-slate-900"
              value={form.actualBoxCount}
              onChange={e => onUpdateBoxCount(parseInt(e.target.value) || 0)}
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-bold text-slate-700">Actual Breakdown Matrix</label>
              <button 
                type="button"
                onClick={onToggleSizeFormat}
                className="text-xs flex items-center gap-1 text-slate-600 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 px-2 py-1 rounded border border-slate-200 transition-colors"
              >
                <ArrowLeftRight size={12} /> 
                {useNumericSizes ? 'Letters' : 'Numbers'}
              </button>
            </div>
            
            <div className="border rounded-lg overflow-hidden overflow-x-auto">
              <table className="w-full text-center text-sm min-w-max">
                <thead className="bg-slate-100 text-slate-600 font-semibold border-b">
                  <tr>
                    <th className="p-3 text-left">Color</th>
                    {sizeLabels.map(h => <th key={h} className="p-3 w-20">{h}</th>)}
                    <th className="p-3 bg-slate-100">Row Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {form.breakdown.map((row, idx) => (
                    <tr key={idx}>
                      <td className="p-3 text-left font-medium text-slate-700">{row.color}</td>
                      {sizeLabels.map(label => {
                        const key = getSizeKeyFromLabel(label, useNumericSizes ? 'numeric' : 'standard');
                        return (
                          <td key={label} className="p-2">
                            <input 
                              type="number" 
                              className="w-16 border rounded p-1.5 text-center bg-white text-slate-900" 
                              value={row[key] || ''} 
                              onChange={e => onUpdateRow(idx, key, parseInt(e.target.value) || 0)} 
                            />
                          </td>
                        );
                      })}
                      <td className="p-3 font-bold bg-slate-50">{getRowTotal(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={onClose} className="px-6 py-2 font-bold text-slate-500">Back</button>
            <button type="submit" className="bg-green-600 text-white px-10 py-3 rounded-xl font-extrabold shadow-lg hover:bg-green-700 flex items-center gap-2">
              <CheckCircle2 /> Submit Production & Finish Job
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
