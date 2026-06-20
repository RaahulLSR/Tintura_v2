
import React, { useState, useEffect } from 'react';
import { X, Clock, RotateCcw, CheckCircle2, Loader2, History } from 'lucide-react';
import { BulkEditHistory } from '../../types';
import { fetchBulkEditHistory, undoBulkEdit, fetchOrderEditHistory, undoOrderEdit } from '../../services/db';

interface HistoryModalProps {
  onClose: () => void;
  onUndoSuccess: () => void;
  type?: 'style' | 'order';
}

export const HistoryModal: React.FC<HistoryModalProps> = ({ onClose, onUndoSuccess, type = 'style' }) => {
  const [historyItems, setHistoryItems] = useState<BulkEditHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const loadHistory = async () => {
    setLoading(true);
    const data = type === 'style' ? await fetchBulkEditHistory() : await fetchOrderEditHistory();
    setHistoryItems(data);
    setLoading(false);
  };

  useEffect(() => { loadHistory(); }, [type]);

  const handleUndo = async (item: BulkEditHistory) => {
    const msg = type === 'style' 
      ? `revert technical data for ${item.affected_count} styles`
      : `revert distribution data for ${item.affected_count} orders`;

    if (!confirm(`Are you sure you want to ${msg} to their state on ${new Date(item.created_at).toLocaleString()}?`)) return;
    
    setUndoingId(item.id);
    const result = type === 'style' ? await undoBulkEdit(item.id) : await undoOrderEdit(item.id);
    
    if (result.success) {
      alert("Restore successful.");
      onUndoSuccess();
      loadHistory();
    } else {
      alert(`Undo failed: ${result.error}`);
    }
    setUndoingId(null);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-scale-up border border-slate-200 flex flex-col max-h-[85vh]">
        <div className="p-6 border-b bg-slate-50 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
              <History size={24}/>
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                {type === 'style' ? 'Style DB History' : 'Order Distribution History'}
              </h3>
              <p className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-0.5">Audit and rollback modifications</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 p-2"><X size={28}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/20">
          {loading ? (
            <div className="py-20 text-center flex flex-col items-center">
              <Loader2 className="animate-spin text-indigo-600 mb-3" size={40}/>
              <p className="text-slate-400 font-bold uppercase text-xs">Retrieving audit logs...</p>
            </div>
          ) : historyItems.length === 0 ? (
            <div className="py-20 text-center text-slate-300">
              <Clock size={48} className="mx-auto mb-4 opacity-20"/>
              <p className="font-bold">No modification logs found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {historyItems.map((item) => (
                <div key={item.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden hover:shadow-md transition-all group">
                  <div className="p-5 flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-100 uppercase tracking-tighter">
                          {new Date(item.created_at).toLocaleDateString()} &bull; {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-1 rounded uppercase tracking-tighter">
                          {item.affected_count} Records Affected
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-800 leading-snug">
                        {item.description}
                      </h4>
                    </div>
                    
                    <button 
                      onClick={() => handleUndo(item)}
                      disabled={undoingId !== null}
                      className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black uppercase transition-all shadow-sm ${undoingId === item.id ? 'bg-orange-50 text-orange-600' : 'bg-slate-900 text-white hover:bg-orange-600'}`}
                    >
                      {undoingId === item.id ? <Loader2 size={14} className="animate-spin"/> : <RotateCcw size={14}/>}
                      {undoingId === item.id ? 'Restoring...' : 'Undo'}
                    </button>
                  </div>
                  
                  <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                     <div className="flex items-center gap-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">
                       <CheckCircle2 size={12} className="text-green-500"/> System Snapshot Point
                     </div>
                     <span className="text-[9px] font-mono text-slate-300">REF: {item.id.slice(0, 8)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-6 border-t bg-white shrink-0 text-right">
          <button onClick={onClose} className="px-10 py-3 bg-slate-100 text-slate-600 rounded-xl font-black uppercase text-xs hover:bg-slate-200 transition-all">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
