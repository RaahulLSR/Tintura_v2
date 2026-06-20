
import React, { useEffect, useState } from 'react';
import { fetchOrders, updateOrderStatus, uploadOrderAttachment } from '../services/db';
import { Order, OrderStatus, formatOrderNumber } from '../types';
import { CheckCheck, ClipboardList, ThumbsUp, ThumbsDown, Upload, FileText } from 'lucide-react';

interface OrderQCModal {
    id: string;
    type: 'ACCEPT' | 'REJECT';
    orderNo: string;
}

export const QCDashboard: React.FC = () => {
  // Order State
  const [qcOrders, setQcOrders] = useState<Order[]>([]);
  const [orderModal, setOrderModal] = useState<OrderQCModal | null>(null);
  const [qcDescription, setQcDescription] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const loadData = async () => {
    // Load Orders waiting for QC
    const allOrders = await fetchOrders();
    setQcOrders(allOrders.filter(o => o.status === OrderStatus.QC));
  };

  useEffect(() => { loadData(); }, []);

  // --- ORDER LOGIC ---
  const handleOrderAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderModal) return;
    setIsProcessing(true);

    let attachmentUrl = undefined;
    if (selectedFile) {
        const url = await uploadOrderAttachment(selectedFile);
        if (url) attachmentUrl = url;
    }

    if (orderModal.type === 'ACCEPT') {
        // Updated: Move to QC_APPROVED instead of COMPLETED
        await updateOrderStatus(
            orderModal.id, 
            OrderStatus.QC_APPROVED, 
            `QC PASSED: ${qcDescription}`, 
            undefined, 
            attachmentUrl
        );
    } else {
        // Move back to IN_PROGRESS (Previously STARTED)
        await updateOrderStatus(
            orderModal.id, 
            OrderStatus.IN_PROGRESS, 
            `QC REJECTED: ${qcDescription}`, 
            undefined, 
            attachmentUrl
        );
    }

    setIsProcessing(false);
    setOrderModal(null);
    setQcDescription("");
    setSelectedFile(null);
    loadData();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <ClipboardList className="text-indigo-600"/> Quality Control Station
        </h2>
      </div>

      {/* --- ORDERS VIEW --- */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200">
            <div className="p-4 border-b bg-indigo-50 font-semibold text-indigo-800 flex items-center gap-2">
            <CheckCheck size={18} /> Orders Pending Final Review
            </div>
            {qcOrders.length === 0 ? (
                <div className="p-10 text-center text-slate-400">All caught up! No orders pending QC.</div>
            ) : (
            <div className="grid grid-cols-1 divide-y divide-slate-100">
                {qcOrders.map(order => {
                    const formattedNo = formatOrderNumber(order);
                    return (
                        <div key={order.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-slate-50 transition">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">{formattedNo}</h3>
                                <div className="text-sm text-slate-500 mb-2">{order.style_number} &bull; {order.quantity} Units</div>
                                <p className="text-sm text-slate-600 bg-slate-100 p-2 rounded inline-block">
                                    {order.description || "No description provided."}
                                </p>
                            </div>
                            <div className="flex gap-3">
                                <button 
                                    onClick={() => setOrderModal({ id: order.id, type: 'REJECT', orderNo: formattedNo })}
                                    className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 flex items-center gap-2 font-medium"
                                >
                                    <ThumbsDown size={18} /> Reject
                                </button>
                                <button 
                                    onClick={() => setOrderModal({ id: order.id, type: 'ACCEPT', orderNo: formattedNo })}
                                    className="px-4 py-2 bg-green-50 text-green-600 border border-green-200 rounded-lg hover:bg-green-100 flex items-center gap-2 font-medium"
                                >
                                    <ThumbsUp size={18} /> Accept
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            )}
      </div>

      {/* QC Modal */}
      {orderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
                <h3 className={`text-xl font-bold mb-2 flex items-center gap-2 ${orderModal.type === 'ACCEPT' ? 'text-green-600' : 'text-red-600'}`}>
                    {orderModal.type === 'ACCEPT' ? <ThumbsUp /> : <ThumbsDown />}
                    {orderModal.type === 'ACCEPT' ? 'Accept Order' : 'Reject Order'}
                </h3>
                <p className="text-slate-600 mb-4">
                    Order: <span className="font-bold">{orderModal.orderNo}</span><br/>
                    {orderModal.type === 'ACCEPT' 
                        ? 'This will mark the order as QC APPROVED.' 
                        : 'This will return the order to IN PROGRESS status for rework.'}
                </p>

                <form onSubmit={handleOrderAction} className="space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">
                            {orderModal.type === 'ACCEPT' ? 'Quality Notes / Certification' : 'Reason for Rejection'}
                        </label>
                        <textarea 
                            required
                            className="w-full border border-slate-300 rounded-lg p-3 focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-slate-900"
                            rows={3}
                            placeholder={orderModal.type === 'ACCEPT' ? "Verified all specs..." : "Stitching issue on left sleeve..."}
                            value={qcDescription}
                            onChange={e => setQcDescription(e.target.value)}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-1">Upload QC Image / File (Optional)</label>
                        <div className="border border-dashed border-slate-300 rounded-lg p-3 text-center bg-slate-50 hover:bg-slate-100 transition cursor-pointer relative">
                            <input 
                                type="file" 
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                            />
                            <div className="flex flex-col items-center justify-center text-slate-500 text-xs">
                                <Upload size={20} className="mb-1"/>
                                {selectedFile ? (
                                    <span className="font-bold text-indigo-600 flex items-center gap-1">
                                        <FileText size={12}/> {selectedFile.name}
                                    </span>
                                ) : (
                                    <span>Click to upload evidence</span>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex justify-end gap-3 mt-6">
                        <button 
                            type="button" 
                            disabled={isProcessing}
                            onClick={() => { setOrderModal(null); setSelectedFile(null); }}
                            className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            disabled={isProcessing}
                            className={`px-4 py-2 text-white rounded-lg font-medium shadow-md flex items-center gap-2 ${
                                orderModal.type === 'ACCEPT' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                            } ${isProcessing ? 'opacity-70 cursor-not-allowed' : ''}`}
                        >
                            {isProcessing ? 'Uploading...' : `Confirm ${orderModal.type === 'ACCEPT' ? 'Approval' : 'Rejection'}`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      )}
    </div>
  );
};
