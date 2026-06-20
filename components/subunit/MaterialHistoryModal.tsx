
import React, { useState } from 'react';
import { MaterialRequest, Order, MaterialStatus } from '../../types';
import { X, Archive, ChevronDown, ChevronRight, Plus, Printer, Paperclip, Pencil, Trash2 } from 'lucide-react';

interface MaterialHistoryModalProps {
  history: MaterialRequest[];
  orders: Order[];
  onClose: () => void;
  onAddNew: (orderId: string) => void;
  onEdit: (req: MaterialRequest) => void;
  onDelete: (id: string) => void;
  onPrint: (order: Order, reqs: MaterialRequest[]) => void;
}

export const MaterialHistoryModal: React.FC<MaterialHistoryModalProps> = ({
  history,
  orders,
  onClose,
  onAddNew,
  onEdit,
  onDelete,
  onPrint
}) => {
  const [expandedOrders, setExpandedOrders] = useState<string[]>([]);

  const toggleHistoryOrder = (orderId: string) => {
    setExpandedOrders(prev => 
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  };

  const grouped = history.reduce((acc, req) => {
    if (!acc[req.order_id]) acc[req.order_id] = [];
    acc[req.order_id].push(req);
    return acc;
  }, {} as Record<string, MaterialRequest[]>);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="p-4 border-b flex justify-between items-center bg-slate-50">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Archive size={20} className="text-slate-600" /> Request History
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          {history.length === 0 ? (
            <div className="p-8 text-center text-slate-400">No requests found.</div>
          ) : (
            // Added type assertion to Object.entries for correct inference of reqs as MaterialRequest[]
            (Object.entries(grouped) as [string, MaterialRequest[]][]).map(([orderId, reqs]) => {
              const order = orders.find(o => o.id === orderId);
              const isExpanded = expandedOrders.includes(orderId);
              return (
                <div key={orderId} className="mb-4 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div 
                    className="px-4 py-3 bg-slate-100 border-b border-slate-200 flex justify-between items-center cursor-pointer hover:bg-slate-200 transition-colors"
                    onClick={() => toggleHistoryOrder(orderId)}
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? <ChevronDown size={18} className="text-slate-500" /> : <ChevronRight size={18} className="text-slate-500" />}
                      <span className="font-bold text-slate-700 text-sm uppercase">Order #{order?.order_no || 'Unknown'}</span>
                      <span className="text-xs text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-300">Style: {order?.style_number}</span>
                      <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{reqs.length} Req(s)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={(e) => { e.stopPropagation(); onAddNew(orderId); }}
                        className="p-1.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded text-xs font-bold flex items-center gap-1 border border-indigo-200"
                      >
                        <Plus size={12} /> Add
                      </button>
                      <button 
                        onClick={(e) => { e.stopPropagation(); if(order) onPrint(order, reqs); }}
                        className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-white rounded border border-transparent hover:border-indigo-100 transition"
                      >
                        <Printer size={16} />
                      </button>
                    </div>
                  </div>
                  
                  {isExpanded && (
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                        <tr>
                          <th className="p-3 w-24">Date</th>
                          <th className="p-3">Material</th>
                          <th className="p-3 w-20 text-center">Req</th>
                          <th className="p-3 w-16 text-center">Unit</th>
                          <th className="p-3 w-20 text-center">Appr</th>
                          <th className="p-3 w-24 text-center">Status</th>
                          <th className="p-3 w-16"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reqs.map(req => {
                          const canEdit = req.status === MaterialStatus.PENDING || req.status === MaterialStatus.PARTIALLY_APPROVED;
                          const canDelete = req.status === MaterialStatus.PENDING;
                          return (
                            <tr key={req.id} className="hover:bg-slate-50 transition-colors">
                              <td className="p-3 text-slate-500 text-xs">{new Date(req.created_at).toLocaleDateString()}</td>
                              <td className="p-3 font-medium text-slate-800">
                                {req.material_content}
                                {req.attachments && req.attachments.length > 0 && (
                                  <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                                    <Paperclip size={10} /> {req.attachments.length}
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-center">{req.quantity_requested}</td>
                              <td className="p-3 text-center text-slate-500 text-xs">{req.unit || 'Nos'}</td>
                              <td className="p-3 text-center font-bold text-green-600">{req.quantity_approved}</td>
                              <td className="p-3 text-center">
                                <span className={`text-[10px] px-2 py-1 rounded font-bold uppercase ${
                                  req.status === 'PENDING' ? 'bg-orange-100 text-orange-600' :
                                  req.status === 'APPROVED' ? 'bg-green-100 text-green-600' :
                                  req.status === 'REJECTED' ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'
                                }`}>
                                  {req.status}
                                </span>
                              </td>
                              <td className="p-3 text-center flex items-center justify-end gap-1">
                                {canEdit && (
                                  <button onClick={() => onEdit(req)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition">
                                    <Pencil size={14} />
                                  </button>
                                )}
                                {canDelete && (
                                  <button onClick={() => onDelete(req.id)} className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition">
                                    <Trash2 size={14} />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            })
          )}
        </div>
        <div className="p-4 bg-slate-50 text-right border-t">
          <button onClick={onClose} className="bg-slate-800 text-white px-4 py-2 rounded font-medium hover:bg-slate-700">Close</button>
        </div>
      </div>
    </div>
  );
};
