
import React, { useMemo, useState } from 'react';
import { Search, RefreshCw, Eye, Send, Loader2, Square, CheckSquare, ArrowUpDown, Clock, FileText } from 'lucide-react';
import { Order, Unit, formatOrderNumber, OrderStatus } from '../../types';
import { StatusBadge } from '../Widgets';

type SortKey = 'recent' | 'due' | 'qty' | 'status' | 'orderno';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Newest first' },
  { key: 'due', label: 'Due date (soonest)' },
  { key: 'qty', label: 'Volume (high to low)' },
  { key: 'status', label: 'Status (A-Z)' },
  { key: 'orderno', label: 'Order number' },
];

interface MasterOrderListProps {
  orders: Order[];
  units: Unit[];
  onRefresh: () => void;
  onViewDetails: (order: Order) => void;
  onSendEmail: (orderId: string) => void;
  onViewTimeline?: (order: Order) => void;
  emailLoading: string | null;
  isBulkMode?: boolean;
  selectedOrderIds?: string[];
  onToggleSelect?: (id: string) => void;
  title?: string;
  emptyMessage?: string;
  showSort?: boolean;
}

export const MasterOrderList: React.FC<MasterOrderListProps> = ({ 
  orders, units, onRefresh, onViewDetails, onSendEmail, emailLoading,
  isBulkMode = false, selectedOrderIds = [], onToggleSelect, onViewTimeline,
  title = 'Master Production List', emptyMessage = 'No matching orders found.', showSort = true,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('recent');

  const filteredOrders = useMemo(() => {
    const matches = orders.filter(order => {
      const formattedNo = formatOrderNumber(order);
      return formattedNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
             order.style_number.toLowerCase().includes(searchTerm.toLowerCase());
    });
    const sorted = [...matches];
    switch (sortBy) {
      case 'due':
        sorted.sort((a, b) => (a.target_delivery_date || '9999').localeCompare(b.target_delivery_date || '9999'));
        break;
      case 'qty':
        sorted.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
        break;
      case 'status':
        sorted.sort((a, b) => String(a.status).localeCompare(String(b.status)));
        break;
      case 'orderno':
        sorted.sort((a, b) => formatOrderNumber(a).localeCompare(formatOrderNumber(b), undefined, { numeric: true }));
        break;
      case 'recent':
      default:
        sorted.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
        break;
    }
    return sorted;
  }, [orders, searchTerm, sortBy]);

  return (
    <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden flex flex-col animate-fade-in relative pb-12">
      <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/50">
        <h3 className="font-black text-slate-700 uppercase tracking-tight">{title}</h3>
        <div className="flex gap-2">
          {showSort && (
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                className="appearance-none pl-10 pr-8 py-2.5 border border-slate-300 rounded-xl text-sm bg-white text-slate-700 font-semibold focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer"
                title="Sort orders"
              >
                {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <ArrowUpDown className="absolute left-3 top-3 text-slate-400 pointer-events-none" size={18} />
            </div>
          )}
          <div className="relative">
            <input 
              type="text" 
              placeholder="Search Style or Order #..." 
              className="pl-11 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm bg-white text-slate-900 focus:ring-2 focus:ring-indigo-500 outline-none w-72" 
              value={searchTerm} 
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Search className="absolute left-4 top-3 text-slate-400" size={18} />
          </div>
          <button onClick={onRefresh} className="p-2.5 bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 rounded-xl transition-all">
            <RefreshCw size={20}/>
          </button>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b">
            <tr>
              {isBulkMode && <th className="p-5 w-12"></th>}
              <th className="p-5">Order Reference</th>
              <th className="p-5">Style Number</th>
              <th className="p-5">Assignee</th>
              <th className="p-5">Volume</th>
              <th className="p-5">Current Status</th>
              {!isBulkMode && <th className="p-5 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredOrders.map((order) => {
              const unitName = units.find(u => u.id === order.unit_id)?.name || 'HQ';
              const formattedOrderNo = formatOrderNumber(order);
              const isSelected = selectedOrderIds.includes(order.id);

              return (
                <tr 
                  key={order.id} 
                  className={`hover:bg-slate-50/80 cursor-pointer group transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`} 
                  onClick={() => isBulkMode ? onToggleSelect?.(order.id) : onViewDetails(order)}
                >
                  {isBulkMode && (
                    <td className="p-5">
                      {isSelected ? <CheckSquare className="text-indigo-600"/> : <Square className="text-slate-300"/>}
                    </td>
                  )}
                  <td className="p-5">
                    <div className="font-black text-slate-800 text-lg group-hover:text-indigo-600 transition-colors">{formattedOrderNo}</div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight mt-0.5">Due: {order.target_delivery_date}</div>
                  </td>
                  <td className="p-5 text-slate-600 font-bold">{order.style_number}</td>
                  <td className="p-5 font-medium text-slate-500">{unitName}</td>
                  <td className="p-5 font-black text-slate-700 tabular-nums">{order.quantity}</td>
                  <td className="p-5"><StatusBadge status={order.status} /></td>
                  {!isBulkMode && (
                    <td className="p-5 text-right flex justify-end gap-3" onClick={e => e.stopPropagation()}>
                      <button onClick={() => onSendEmail(order.id)} disabled={emailLoading === order.id} className="p-2 bg-white text-slate-400 hover:text-indigo-600 rounded-xl border border-slate-100 hover:border-indigo-100 transition-all shadow-sm">
                        {emailLoading === order.id ? <Loader2 size={18} className="animate-spin" /> : <Send size={18}/>}
                      </button>
                      {onViewTimeline && (
                        <button onClick={() => onViewTimeline(order)} title="Timeline" className="p-2 bg-teal-50 text-teal-600 hover:bg-teal-600 hover:text-white rounded-xl transition-all shadow-sm">
                          <Clock size={18}/>
                        </button>
                      )}
                      {order.status === OrderStatus.COMPLETED && (
                        <button onClick={() => window.open(`https://tintura-sst.vercel.app/api/completion-report?id=${encodeURIComponent(String(order.id))}`, '_blank')} title="Completion report" className="p-2 bg-violet-50 text-violet-600 hover:bg-violet-600 hover:text-white rounded-xl transition-all shadow-sm">
                        <FileText size={18}/>
                        </button>
                      )}
                      <button onClick={() => onViewDetails(order)} className="p-2 bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-xl transition-all shadow-sm">
                        <Eye size={18}/>
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredOrders.length === 0 && <div className="p-20 text-center text-slate-400">{emptyMessage}</div>}
      </div>
    </div>
  );
};
