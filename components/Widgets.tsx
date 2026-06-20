
import React from 'react';
import { OrderStatus } from '../types';

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  let colorClass = 'bg-slate-100 text-slate-700 border-slate-200';

  switch (status) {
    // Order Statuses
    case OrderStatus.ASSIGNED: colorClass = 'bg-blue-50 text-blue-700 border-blue-200'; break;
    case OrderStatus.IN_PROGRESS: colorClass = 'bg-amber-50 text-amber-700 border-amber-200'; break;
    case OrderStatus.QC: colorClass = 'bg-orange-50 text-orange-700 border-orange-200'; break;
    case OrderStatus.QC_APPROVED: colorClass = 'bg-teal-50 text-teal-700 border-teal-200'; break;
    case OrderStatus.PACKED: colorClass = 'bg-violet-50 text-violet-700 border-violet-200'; break;
    case OrderStatus.COMPLETED: colorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200'; break;
  }

  return (
    <span className={`badge ${colorClass}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
};

export const BulkActionToolbar: React.FC<{ 
  selectedCount: number; 
  actions: { label: string; onClick: () => void; variant?: 'primary' | 'danger' }[] 
}> = ({ selectedCount, actions }) => {
  if (selectedCount === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-white border border-slate-200 shadow-2xl rounded-full px-6 py-3 flex items-center space-x-4 z-40 animate-slide-up">
      <span className="font-semibold text-slate-700">{selectedCount} Selected</span>
      <div className="h-4 w-px bg-slate-300"></div>
      {actions.map((action, idx) => (
        <button
          key={idx}
          onClick={action.onClick}
          className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
            action.variant === 'danger' 
            ? 'bg-red-50 text-red-600 hover:bg-red-100' 
            : 'bg-brand-600 text-white hover:bg-brand-700'
          }`}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
