
import React from 'react';
import { Package, Activity } from 'lucide-react';

interface DashboardStatsProps {
  liveStockCount: number;
  activeOrderCount: number;
}

export const DashboardStats: React.FC<DashboardStatsProps> = ({ liveStockCount, activeOrderCount }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between group hover:border-indigo-300 transition-colors">
      <div>
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Live Inventory Stock</p>
        <p className="text-5xl font-black text-slate-800 mt-2">{liveStockCount}</p>
      </div>
      <div className="p-5 bg-indigo-50 text-indigo-600 rounded-2xl group-hover:scale-110 transition-transform">
        <Package size={40} />
      </div>
    </div>
    <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between group hover:border-blue-300 transition-colors">
      <div>
        <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Orders In Progress</p>
        <p className="text-5xl font-black text-slate-800 mt-2">{activeOrderCount}</p>
      </div>
      <div className="p-5 bg-blue-50 text-blue-600 rounded-2xl group-hover:scale-110 transition-transform">
        <Activity size={40} />
      </div>
    </div>
  </div>
);
