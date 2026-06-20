
import React, { useEffect, useState } from 'react';
import { fetchOrders, updateOrderStatus, fetchMaterialRequests, deleteMaterialRequest, triggerMaterialEmail, fetchOrderLogs, addOrderLog, fetchStyleByNumber, fetchStyleTemplate, fetchOrderStockCommits, commitOrderStock, undoOrderStockCommit, deliverCompletionReport } from '../services/db';
import { Order, OrderStatus, getNextOrderStatus, SizeBreakdown, MaterialRequest, OrderLog, MaterialStatus, formatOrderNumber, Style, ConsumptionType, Attachment, OrderStockCommit, StockCommitLine, getSizeKeyFromLabel } from '../types';
import { StatusBadge, BulkActionToolbar } from '../components/Widgets';
import { ArrowRight, Printer, PackagePlus, Box, AlertTriangle, Eye, CheckCircle2, History, ListTodo, Archive, Clock, Search, Mail, Loader2, Info, Boxes } from 'lucide-react';
import { brandHeaderDualLogoHtml } from '../services/brandAssets';

import { OrderDetailsModal } from '../components/subunit/OrderDetailsModal';
import { TimelineModal } from '../components/subunit/TimelineModal';
import { MaterialHistoryModal } from '../components/subunit/MaterialHistoryModal';
import { MaterialRequestModal } from '../components/subunit/MaterialRequestModal';
import { StockCommitModal } from '../components/subunit/StockCommitModal';
import { useAuth } from '../components/Layout';

const CURRENT_UNIT_ID = 2; // Sewing Unit A

interface RequirementDetail {
  label: string;
  count: number;
  calc: number;
  text: string;
  attachments: Attachment[];
}

interface DetailedRequirement {
  name: string;
  total: number;
  breakdown: RequirementDetail[];
}

export const SubunitDashboard: React.FC = () => {
  const { user } = useAuth();
  const actor = user?.full_name || user?.username || 'Manager';
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [emailLoading, setEmailLoading] = useState<string | null>(null);
  
  const [detailsModal, setDetailsModal] = useState<Order | null>(null);
  const [timelineModal, setTimelineModal] = useState<{orderId: string, orderNo: string} | null>(null);
  const [materialModal, setMaterialModal] = useState<string | null>(null);
  const [showMaterialHistory, setShowMaterialHistory] = useState(false);

  const [stockModalOrder, setStockModalOrder] = useState<Order | null>(null);
  const [orderCommits, setOrderCommits] = useState<OrderStockCommit[]>([]);
  const [stockSaving, setStockSaving] = useState(false);

  const [timelineLogs, setTimelineLogs] = useState<OrderLog[]>([]);
  const [statusUpdateText, setStatusUpdateText] = useState("");
  const [materialHistory, setMaterialHistory] = useState<MaterialRequest[]>([]);
  const [isEditingRequest, setIsEditingRequest] = useState<{ id: string, originalData: MaterialRequest } | null>(null);
  
  const [useNumericSizes, setUseNumericSizes] = useState(false);

  const refreshOrders = () => {
    fetchOrders().then(data => {
        const subunitOrders = data.filter(o => o.unit_id === CURRENT_UNIT_ID);
        setOrders(subunitOrders);
    });
  };

  useEffect(() => { refreshOrders(); }, []);

  const displayedOrders = orders.filter(o => {
      const formattedNo = formatOrderNumber(o);
      const matchesTab = activeTab === 'active' ? o.status !== OrderStatus.COMPLETED : o.status === OrderStatus.COMPLETED;
      const matchesSearch = formattedNo.toLowerCase().includes(searchTerm.toLowerCase()) || o.style_number.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesTab && matchesSearch;
  });

  const toggleSelect = (id: string) => {
    setSelectedOrders(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleBulkStatusUpdate = async () => {
    const hasInProgress = selectedOrders.some(id => {
      const o = orders.find(ord => ord.id === id);
      return o?.status === OrderStatus.IN_PROGRESS;
    });

    if (hasInProgress) {
      if (!confirm("Move the selected orders into QC review? You can continue advancing them from here.")) {
        return;
      }
    }

    setLoading(true);
    await Promise.all(selectedOrders.map(async (id) => {
      const order = orders.find(o => o.id === id);
      if (order && order.status !== OrderStatus.COMPLETED) {
        const next = getNextOrderStatus(order.status);
        if (next) await updateOrderStatus(id, next);
      }
    }));
    setSelectedOrders([]);
    setLoading(false);
    refreshOrders();
  };

  const handleSingleStatusUpdate = async (id: string, currentStatus: OrderStatus) => {
    // Move into in-house QC review
    if (currentStatus === OrderStatus.IN_PROGRESS) {
      if (!confirm("Move this order into QC review? You can keep advancing it from here.")) {
        return;
      }
    }

    if (currentStatus === OrderStatus.QC_APPROVED) {
        const order = orders.find(o => o.id === id);
        if (order) {
            setUseNumericSizes(order.size_format === 'numeric');
            // Skip the separate completion popup — open the editable stock-commit
            // sheet directly. The user enters completed pieces there and pushing
            // them to inventory also marks the order complete.
            openStockModal(order);
        }
        return;
    }
    const next = getNextOrderStatus(currentStatus);
    if (next) {
        setLoading(true);
        await updateOrderStatus(id, next);
        setLoading(false);
        refreshOrders();
    }
  };

  const handleSendMaterialEmail = async (orderId: string) => {
    setEmailLoading(orderId);
    const result = await triggerMaterialEmail(orderId);
    setEmailLoading(null);
    alert(result.message);
  };

  const openTimeline = (orderId: string, orderNo: string) => {
      setTimelineModal({ orderId, orderNo });
      setTimelineLogs([]);
      setStatusUpdateText("");
      fetchOrderLogs(orderId).then(setTimelineLogs);
  };

  const submitManualStatusUpdate = async (attachments: { url: string; name?: string }[] = []) => {
      if (!timelineModal) return;
      const text = statusUpdateText.trim();
      if (!text && attachments.length === 0) return;
      await addOrderLog(timelineModal.orderId, 'MANUAL_UPDATE', text, 'System', attachments);
      const logs = await fetchOrderLogs(timelineModal.orderId);
      setTimelineLogs(logs);
      setStatusUpdateText("");
  };

  // Rebuild the completed-pieces breakdown from every (non-undone) stock commit,
  // so partial commits accumulate into the order's recorded completion.
  const buildCompletionFromCommits = (order: Order, commits: OrderStockCommit[]): SizeBreakdown[] => {
      const format = order.size_format === 'numeric' ? 'numeric' : 'standard';
      const byColor: Record<string, SizeBreakdown> = {};
      commits.filter((c) => !c.undone).forEach((c) => {
          (c.breakdown || []).forEach((l) => {
              const key = getSizeKeyFromLabel(l.size, format);
              if (!byColor[l.color]) byColor[l.color] = { color: l.color };
              byColor[l.color][key] = ((byColor[l.color][key] as number) || 0) + l.qty;
          });
      });
      return Object.values(byColor);
  };

  const openStockModal = async (order: Order) => {
      const commits = await fetchOrderStockCommits(order.id);
      setOrderCommits(commits);
      setStockModalOrder(order);
  };

  const handleCommitStock = async (lines: StockCommitLine[]) => {
      if (!stockModalOrder) return;
      setStockSaving(true);
      try {
          await commitOrderStock(stockModalOrder, lines, actor);
          const commits = await fetchOrderStockCommits(stockModalOrder.id);
          setOrderCommits(commits);

          // The first commit also completes the order. Its completion breakdown
          // is derived from the committed pieces (cumulative across commits).
          if (stockModalOrder.status !== OrderStatus.COMPLETED) {
              const breakdown = buildCompletionFromCommits(stockModalOrder, commits);
              const boxCount = stockModalOrder.actual_box_count ?? stockModalOrder.box_count ?? 0;
              await updateOrderStatus(stockModalOrder.id, OrderStatus.COMPLETED, undefined, {
                  completion_breakdown: breakdown,
                  actual_box_count: boxCount,
              });
              setStockModalOrder({
                  ...stockModalOrder,
                  status: OrderStatus.COMPLETED,
                  completion_breakdown: breakdown,
                  actual_box_count: boxCount,
              });
              // Deliver the order completion report to Admin's Tintura SST inbox + email.
              deliverCompletionReport({
                  ...stockModalOrder,
                  status: OrderStatus.COMPLETED,
                  completion_breakdown: breakdown,
                  actual_box_count: boxCount,
              }).catch(() => {});
          }
          refreshOrders();
      } catch (err: any) {
          alert(err?.message || 'Failed to commit stock.');
      } finally {
          setStockSaving(false);
      }
  };

  const handleUndoCommit = async (commit: OrderStockCommit) => {
      if (!confirm(`Undo this commit and remove ${commit.total_items} pcs from inventory?`)) return;
      setStockSaving(true);
      try {
          await undoOrderStockCommit(commit);
          if (stockModalOrder) setOrderCommits(await fetchOrderStockCommits(stockModalOrder.id));
      } catch (err: any) {
          alert(err?.message || 'Failed to undo commit.');
      } finally {
          setStockSaving(false);
      }
  };

  const handleOpenMaterialHistory = async () => {
      const allRequests = await fetchMaterialRequests();
      const unitOrderIds = orders.map(o => o.id);
      setMaterialHistory(allRequests.filter(req => unitOrderIds.includes(req.order_id)));
      setShowMaterialHistory(true);
  };

  const handleDeleteRequest = async (id: string) => {
      if (!confirm("Are you sure?")) return;
      await deleteMaterialRequest(id);
      handleOpenMaterialHistory();
  };

  const handleEditRequest = (req: MaterialRequest) => {
      setIsEditingRequest({ id: req.id, originalData: req });
      setMaterialModal(req.order_id);
      setShowMaterialHistory(false);
  };

  const calculateRequirementValue = (qty: number, type: ConsumptionType, val: number) => {
    if (!val) return 0;
    return type === 'items_per_pc' ? qty * val : qty / val;
  };

  const getDetailedRequirements = (order: Order, linkedStyle: Style): DetailedRequirement[] => {
    if (!linkedStyle || !order.size_breakdown) return [];
    
    const detailedReqs: DetailedRequirement[] = [];
    const sizeKeys = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'] as const;
    const sizeLabels = order.size_format === 'numeric' ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL'];

    for (const catName in linkedStyle.tech_pack) {
      for (const fieldName in linkedStyle.tech_pack[catName]) {
        const item = linkedStyle.tech_pack[catName][fieldName];
        const req: DetailedRequirement = { name: fieldName, total: 0, breakdown: [] };

        if (item.variants) {
          for (const variant of item.variants) {
            const matchingRows = order.size_breakdown.filter(r => variant.colors.includes(r.color));
            if (matchingRows.length === 0) continue;

            if (variant.sizeVariants) {
              for (const sv of variant.sizeVariants) {
                const targetKeys = sizeKeys.filter((_, i) => sv.sizes.includes(sizeLabels[i]));
                const qty = matchingRows.reduce((sum, row) => sum + targetKeys.reduce((s, k) => s + (row[k] || 0), 0), 0);
                
                if (qty > 0) {
                  const rType = sv.consumption_type || variant.consumption_type || item.consumption_type || 'items_per_pc';
                  const rVal = sv.consumption_val !== undefined ? sv.consumption_val : (variant.consumption_val !== undefined ? variant.consumption_val : (item.consumption_val || 0));
                  const calc = calculateRequirementValue(qty, rType, rVal);
                  
                  req.breakdown.push({
                    label: `${variant.colors.join('/')} - ${sv.sizes.join('/')}`,
                    count: qty,
                    calc: Math.ceil(calc * 100) / 100,
                    text: sv.text || variant.text || item.text,
                    attachments: sv.attachments.length > 0 ? sv.attachments : (variant.attachments.length > 0 ? variant.attachments : item.attachments)
                  });
                  req.total += calc;
                }
              }
            } else if (variant.consumption_type) {
              const qty = matchingRows.reduce((sum, row) => sum + ( (row.s || 0) + (row.m || 0) + (row.l || 0) + (row.xl || 0) + (row.xxl || 0) + (row.xxxl || 0) ), 0);
              const calc = calculateRequirementValue(qty, variant.consumption_type, variant.consumption_val || 0);
              req.breakdown.push({
                label: `Color: ${variant.colors.join('/')}`,
                count: qty,
                calc: Math.ceil(calc * 100) / 100,
                text: variant.text || item.text,
                attachments: variant.attachments.length > 0 ? variant.attachments : item.attachments
              });
              req.total += calc;
            }
          }
        } else if (item.consumption_type) {
          const calc = calculateRequirementValue(order.quantity, item.consumption_type, item.consumption_val || 0);
          req.breakdown.push({
            label: "Global Requirement",
            count: order.quantity,
            calc: Math.ceil(calc * 100) / 100,
            text: item.text,
            attachments: item.attachments
          });
          req.total = calc;
        }

        if (req.total > 0) {
          req.total = Math.ceil(req.total * 100) / 100;
          detailedReqs.push(req);
        }
      }
    }
    return detailedReqs;
  };

  const handlePrintMaterialForecast = async (order: Order) => {
    const styleRefPart = order.style_number.split(' - ')[0].trim();
    if (!styleRefPart) return;

    const style = await fetchStyleByNumber(styleRefPart);
    if (!style) return;

    const detailedReqs = getDetailedRequirements(order, style);
    if (detailedReqs.length === 0) return alert("No projected requirements found in linked Tech Pack.");

    // Map each tech-pack field/material name -> the instruction text entered for it,
    // so the printed forecast shows the entered text against each item name.
    const itemTextByName: Record<string, string> = {};
    for (const cat in style.tech_pack) {
      if (cat === '__poster__' || cat === '__custom__') continue;
      for (const f in style.tech_pack[cat]) {
        const t = (style.tech_pack[cat][f] as any)?.text;
        if (t && !itemTextByName[f]) itemTextByName[f] = String(t);
      }
    }

    const formattedNo = formatOrderNumber(order);
    const win = window.open('', 'MaterialForecast', 'width=1000,height=800');
    if (win) {
      win.document.write(`
        <html><head><title>Material Forecast - ${formattedNo}</title>
        <style>
          body { font-family: sans-serif; padding: 30px; font-size: 11px; color: #1e293b; }
          .header { text-align: center; border-bottom: 3px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
          .brand { font-size: 22px; font-weight: 900; }
          .title { font-size: 14px; font-weight: bold; text-transform: uppercase; margin-top: 5px; color: #64748b; letter-spacing: 1px; }
          .meta { margin-bottom: 20px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; background: #f8fafc; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; }
          .meta-item { font-size: 12px; font-weight: bold; }
          .section { margin-bottom: 20px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; page-break-inside: avoid; }
          .section-header { background: #4f46e5; color: #fff; padding: 8px 12px; font-weight: 900; font-size: 12px; display: flex; justify-content: space-between; align-items: center; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #e2e8f0; padding: 6px 10px; text-align: left; vertical-align: top; }
          th { background: #f1f5f9; font-size: 9px; text-transform: uppercase; color: #64748b; }
          .val { font-weight: 900; font-size: 13px; color: #4f46e5; }
          .img-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 5px; }
          .img-grid img { width: 100%; border-radius: 4px; border: 1px solid #e2e8f0; max-height: 120px; object-fit: contain; }
          .footer { margin-top: 30px; text-align: center; font-size: 9px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
        </style>
        </head><body>
          <div class="header">
            <div class="brand">TINTURA SST</div>
            <div class="title">Projected Material Requirements Forecast</div>
          </div>
          <div class="meta">
            <div class="meta-item"><small style="color:#64748b; text-transform:uppercase; display:block;">Job No:</small>${formattedNo}</div>
            <div class="meta-item"><small style="color:#64748b; text-transform:uppercase; display:block;">Style:</small>${order.style_number}</div>
            <div class="meta-item"><small style="color:#64748b; text-transform:uppercase; display:block;">Batch:</small>${order.quantity} PCS</div>
            <div class="meta-item"><small style="color:#64748b; text-transform:uppercase; display:block;">Generated:</small>${new Date().toLocaleDateString()}</div>
          </div>
          ${detailedReqs.map(req => `
            <div class="section">
              <div class="section-header">
                <span>${req.name}</span>
                <span style="background:rgba(255,255,255,0.2); padding:2px 8px; border-radius:4px;">TOTAL: ${req.total}</span>
              </div>
              ${itemTextByName[req.name] ? `<div style="padding:8px 12px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:11px; font-weight:600; color:#334155;"><span style="font-size:8px; font-weight:900; text-transform:uppercase; color:#94a3b8; display:block; margin-bottom:2px;">Instructions</span>${itemTextByName[req.name]}</div>` : ''}
              <table>
                <thead>
                  <tr>
                    <th width="140">Segment Scope</th>
                    <th width="70" style="text-align:center">Base Qty</th>
                    <th width="90" style="text-align:right">Calculated Req.</th>
                    <th>Reference & Visuals</th>
                  </tr>
                </thead>
                <tbody>
                  ${req.breakdown.map(b => `
                    <tr>
                      <td style="font-weight:bold; color:#334155;">${b.label}</td>
                      <td style="text-align:center; color:#64748b;">${b.count}</td>
                      <td style="text-align:right" class="val">${b.calc}</td>
                      <td>
                        <div style="font-size:12px; font-weight:bold; margin-bottom:5px;">${b.text || '---'}</div>
                        <div class="img-grid">${b.attachments.filter(a => a.type === 'image').map(img => `<img src="${img.url}"/>`).join('')}</div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `).join('')}
          <div class="footer">Document generated via Tintura SST ERP. All quantities are estimates based on technical ratios.</div>
          <script>window.onload = () => { window.print(); };</script>
        </body></html>
      `);
      win.document.close();
    }
  };

  const handlePrintOrderSheet = async (order: Order) => {
      let techPackHtml = '';
      let preProductionHtml = '';
      
      const styleRefPart = order.style_number.split(' - ')[0].trim();
      if (styleRefPart) {
          const [style, template] = await Promise.all([
              fetchStyleByNumber(styleRefPart),
              fetchStyleTemplate()
          ]);
          
          if (style && template) {
              const renderField = (f: string, catName: string) => {
                  const item = style.tech_pack[catName]?.[f] || { text: 'N/A', attachments: [] };
                  let contentHtml = '';
                  if (item.variants) {
                    contentHtml = item.variants.map(v => {
                      let sizeHtml = '';
                      if (v.sizeVariants) {
                        sizeHtml = `<div style="margin-top:8px; display:grid; grid-template-columns:1fr; gap:6px;">${v.sizeVariants.map(sv => `
                          <div style="background:#fff; border:1px solid #e2e8f0; border-left:3px solid #4f46e5; padding:8px; border-radius:4px; page-break-inside:avoid;">
                            <div style="margin-bottom:3px; font-weight:bold; font-size:9px; color:#4f46e5; text-transform:uppercase;">SIZES: ${sv.sizes.join(', ')}</div>
                            <div style="font-size:11px; font-weight:bold;">${sv.text || '---'}</div>
                            <div style="display:grid; grid-template-columns:${sv.attachments.filter(a => a.type === 'image').length === 1 ? '1fr' : '1fr 1fr'}; gap:5px; margin-top:5px;">
                              ${sv.attachments.filter(a => a.type === 'image').map(a => `<img src="${a.url}" style="width:100%; border-radius:2px; border:1px solid #ddd;"/>`).join('')}
                            </div>
                          </div>
                        `).join('')}</div>`;
                      }
                      return `
                        <div style="border:1px solid #e2e8f0; padding:10px; border-radius:6px; margin-top:8px; background:#f8fafc; page-break-inside:avoid;">
                          <div style="margin-bottom:4px;">${v.colors.map(c => `<span style="background:#334155; color:#fff; font-size:8px; font-weight:bold; padding:1px 5px; border-radius:2px; margin-right:3px; text-transform:uppercase;">${c}</span>`).join('')}</div>
                          <div style="font-size:12px; font-weight:bold;">${v.text || '---'}</div>
                          <div style="display:grid; grid-template-columns:${v.attachments.filter(a => a.type === 'image').length === 1 ? '1fr' : '1fr 1fr'}; gap:5px; margin-top:5px;">
                            ${v.attachments.filter(a => a.type === 'image').map(a => `<img src="${a.url}" style="width:100%; border-radius:3px; border:1px solid #ddd;"/>`).join('')}
                          </div>
                          ${sizeHtml}
                        </div>`;
                    }).join('');
                  } else {
                    contentHtml = `
                      <div style="font-size:12px; font-weight:bold; background:#f8fafc; padding:10px; border-radius:6px; border:1px solid #e2e8f0;">
                        ${item.text || '---'}
                        <div style="display:grid; grid-template-columns:${item.attachments.filter(a => a.type === 'image').length === 1 ? '1fr' : '1fr 1fr'}; gap:8px; margin-top:8px;">
                          ${item.attachments.filter(a => a.type === 'image').map(a => `<img src="${a.url}" style="width:100%; border-radius:4px; border:1px solid #ddd;"/>`).join('')}
                        </div>
                      </div>`;
                  }

                  return `
                    <div style="margin-bottom:12px; border-bottom:1px solid #f1f5f9; padding-bottom:6px; page-break-inside:avoid;">
                      <div style="font-size:9px; font-weight:bold; color:#94a3b8; text-transform:uppercase; margin-bottom:3px;">${f}</div>
                      ${contentHtml}
                    </div>
                  `;
              };

              // Split Pre-production from other technical fields
              const preProdCat = template.config.find(c => c.name.toLowerCase().includes('pre production'));
              if (preProdCat) {
                  preProductionHtml = `
                    <div style="page-break-before:always; margin-top:30px;">
                        <h3 style="background:#334155; color:#fff; padding:6px 12px; font-size:11px; text-transform:uppercase; letter-spacing:1px; border-radius:4px;">Pre-Production Requirements</h3>
                        <div style="padding:10px 0;">${preProdCat.fields.map(f => renderField(f, preProdCat.name)).join('')}</div>
                    </div>
                  `;
              }

              techPackHtml = template.config.filter(c => 
                c.name !== "General Info" && 
                !c.name.toLowerCase().includes('pre production') && 
                !c.name.toLowerCase().includes('packing') &&
                !c.name.toLowerCase().includes('requirements during production')
              ).map(cat => {
                  return `
                    <div style="margin-top:25px; page-break-inside:avoid;">
                      <h3 style="background:#f1f5f9; color:#334155; padding:6px 12px; font-size:11px; text-transform:uppercase; letter-spacing:1px; border-radius:4px; border-left:4px solid #334155;">${cat.name} Reference</h3>
                      <div style="padding:10px 0;">${cat.fields.map(f => renderField(f, cat.name)).join('')}</div>
                    </div>
                  `;
              }).join('');
          }
      }

      const headers = order.size_format === 'numeric' ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
      const keys = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'] as const;
      const getRowTotal = (row: SizeBreakdown) => (row.s || 0) + (row.m || 0) + (row.l || 0) + (row.xl || 0) + (row.xxl || 0) + (row.xxxl || 0);
      const breakdownRows = (order.size_breakdown || []).map(row => `<tr><td style="text-align:left; font-weight:bold; border: 1px solid #333;">${row.color}</td>${keys.map(k => `<td style="border: 1px solid #333;">${(row as any)[k]}</td>`).join('')}<td style="font-weight:bold; background:#f1f5f9; border: 1px solid #333;">${getRowTotal(row)}</td></tr>`).join('');
      const formattedNo = formatOrderNumber(order);
      
      let orderDate = 'N/A';
      if (order.created_at) {
        const d = new Date(order.created_at);
        orderDate = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
      }
      
      let attachmentHtml = '';
      const orderImgs = (order.attachments || []).filter(a => a.type === 'image');
      if (orderImgs.length > 0) {
          attachmentHtml = `<div class="section-title">Order Level Reference Docs</div><div style="display:grid; grid-template-columns:${orderImgs.length === 1 ? '1fr' : '1fr 1fr'}; gap:10px;">`;
          orderImgs.forEach(att => {
              attachmentHtml += `<div style="border:1px solid #e2e8f0; padding:8px; text-align:center; page-break-inside:avoid; background:#fff;"><img src="${att.url}" style="width:100%; border-radius:4px;" /><div style="font-size:9px; margin-top:4px; font-weight:bold; color:#64748b;">REF: ${att.name}</div></div>`;
          });
          attachmentHtml += `</div>`;
      }

      const win = window.open('', 'PrintOrderSheet', 'width=1000,height=800');
      if (win) {
          win.document.write(`<html><head><title>Job Sheet - ${formattedNo}</title>
          <style>
            body { font-family: sans-serif; padding: 30px; font-size: 10px; color: #1e293b; line-height: 1.3; }
            .header { text-align: center; border-bottom: 3px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
            .brand { font-size: 28px; font-weight: 900; }
            .title { font-size: 12px; font-weight: bold; text-transform: uppercase; margin-top: 5px; color:#64748b; letter-spacing:1px; }
            .grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 15px; }
            .box { padding: 8px 12px; border: 1.5px solid #1e293b; border-radius: 4px; }
            .label { font-size: 8px; text-transform: uppercase; color: #64748b; font-weight: bold; display:block; margin-bottom:2px; }
            .value { font-size: 12px; font-weight: bold; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { border: 1px solid #1e293b; padding: 6px; text-align: center; }
            th { background: #f8fafc; font-weight: bold; text-transform: uppercase; font-size: 8px; }
            .section-title { font-size: 12px; font-weight: 900; border-bottom: 1.5px solid #1e293b; padding-bottom: 3px; margin-top: 20px; margin-bottom: 10px; text-transform: uppercase; }
            .notes-box { padding: 10px 15px; border: 1.5px solid #1e293b; background: #f8fafc; border-radius: 6px; font-size: 11px; font-weight: bold; white-space: pre-wrap; }
          </style>
          </head><body>
            <div class="header">
              ${brandHeaderDualLogoHtml('Manufacturing Job Execution Sheet')}
            </div>
            <div class="grid">
              <div class="box"><span class="label">Job ID</span><div class="value">${formattedNo}</div></div>
              <div class="box"><span class="label">Style</span><div class="value">${order.style_number}</div></div>
              <div class="box"><span class="label">Batch Volume</span><div class="value">${order.quantity} PCS</div></div>
              <div class="box"><span class="label">Order Date</span><div class="value">${orderDate}</div></div>
              <div class="box"><span class="label">Target Date</span><div class="value">${order.target_delivery_date}</div></div>
            </div>
            
            <div class="section-title">Job Summary & Meta</div>
            <div class="notes-box" style="margin-bottom:15px;">
               Facility: Unit ID ${order.unit_id}. Processed via SST Manufacturing Database.
            </div>

            <div class="section-title">Color / Size Breakdown Matrix</div>
            <table>
              <thead>
                <tr><th style="text-align:left; border: 1px solid #333;">Color Variant</th>${headers.map(h => `<th style="border: 1px solid #333;">${h}</th>`).join('')}<th style="border: 1px solid #333;">Total</th></tr>
              </thead>
              <tbody>${breakdownRows}</tbody>
            </table>

            <div class="section-title">Production Notes & Core Instructions</div>
            <div class="notes-box" style="min-height: 40px;">${order.description || "No specific instructions provided."}</div>

            ${attachmentHtml}
            ${preProductionHtml}
            <div style="page-break-before: auto;">
                ${techPackHtml}
            </div>
            <script>window.onload = () => { setTimeout(() => window.print(), 1000); };</script>
          </body></html>`);
          win.document.close();
      }
  };
  
  const handlePrintAccessoriesReceipt = (order: Order, reqs: MaterialRequest[]) => {
      const formattedNo = formatOrderNumber(order);
      const win = window.open('', 'OrderReceipt', 'width=1000,height=800');
      if (win) {
          const page1Rows = reqs.map((req, idx) => `<tr><td style="text-align:center;">${idx + 1}</td><td>${req.material_content}</td><td style="text-align:center;">${req.unit || 'Nos'}</td><td style="text-align:right; font-weight:bold;">${req.quantity_requested}</td></tr>`).join('');
          const page2Rows = reqs.map((req, idx) => {
              const balance = req.quantity_requested - req.quantity_approved;
              return `<tr><td style="text-align:center;">${idx + 1}</td><td>${req.material_content}</td><td style="text-align:right;">${req.quantity_requested}</td><td style="text-align:right; font-weight:bold; color:green;">${req.quantity_approved}</td><td style="text-align:right; font-weight:bold; color:${balance > 0 ? 'red' : 'black'};">${balance}</td><td style="text-align:center; font-size:10px; text-transform:uppercase;">${req.status.replace('_', ' ')}</td></tr>`;
          }).join('');
          const headerHTML = `<div class="header"><div class="brand">TINTURA SST</div><div class="title">ACCESSORIES REQUIREMENT RECEIPT</div><div class="meta">ORDER NO: ${formattedNo} &nbsp;|&nbsp; STYLE: ${order.style_number} &nbsp;|&nbsp; DATE: ${new Date().toLocaleDateString()}</div></div>`;
          win.document.write(`<html><head><title>Accessories Receipt - ${formattedNo}</title><style>@media print { .page-break { page-break-before: always; } body { -webkit-print-color-adjust: exact; } } body { font-family: 'Arial', sans-serif; padding: 40px; color: #333; } .header { text-align: center; border-bottom: 3px solid #000; margin-bottom: 25px; padding-bottom: 15px; } .brand { font-size: 24px; font-weight: 900; margin-bottom: 5px; letter-spacing: 1px; } .title { font-size: 20px; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; } .meta { font-size: 16px; font-weight: 800; background: #eee; padding: 10px; border: 1px solid #000; text-align: center; } .page-title { font-size: 14px; font-weight: bold; text-transform: uppercase; margin-bottom: 10px; text-align:left; border-left: 5px solid #000; padding-left: 10px; } table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 20px; } th, td { border: 1px solid #ccc; padding: 8px; } th { background: #f4f4f4; text-transform: uppercase; }</style></head><body>${headerHTML}<div class="page-title">Page 1: Request Sheet</div><table><thead><tr><th width="50">S.No</th><th>Material Description</th><th width="80">Unit</th><th width="100" style="text-align:right">Total Requested</th></tr></thead><tbody>${page1Rows}</tbody></table><div style="text-align:center; font-size:10px; margin-top:20px;">-- Verified By Production --</div><div class="page-break"></div>${headerHTML}<div class="page-title">Page 2: Approval & Balance Sheet</div><table><thead><tr><th width="50">S.No</th><th>Material Description</th><th width="80" style="text-align:right">Req</th><th width="80" style="text-align:right">Approved</th><th width="80" style="text-align:right">Balance</th><th width="100">Status</th></tr></thead><tbody>${page2Rows}</tbody></table><div style="text-align:center; font-size:10px; margin-top:20px;">-- Approved By Materials Dept --</div><script>window.onload = () => { setTimeout(() => window.print(), 500); };</script></body></html>`);
          win.document.close();
      }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:justify-between xl:items-center gap-4">
        <div>
            <h2 className="text-3xl font-black text-slate-800 flex items-center gap-3">
              <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-200">
                <Box size={28}/> 
              </div>
              Sub-Unit Operations
            </h2>
            <div className="mt-2 flex items-center gap-2">
              <div className="bg-indigo-50 text-indigo-800 text-xs font-bold px-3 py-1 rounded-full border border-indigo-100 uppercase tracking-widest">
                Unit ID: {CURRENT_UNIT_ID}
              </div>
              <div className="bg-slate-100 text-slate-500 text-[10px] font-bold px-3 py-1 rounded-full border border-slate-200 uppercase tracking-widest">
                Sewing Section A
              </div>
            </div>
        </div>
        <div className="flex flex-col md:flex-row gap-3 items-center">
            <div className="relative w-full md:w-80">
                <input type="text" placeholder="Search by Order # or Style..." className="pl-11 pr-4 py-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none w-full bg-white text-slate-900 shadow-sm transition-all" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
            </div>
            <button onClick={handleOpenMaterialHistory} className="bg-white border border-slate-200 text-slate-700 px-5 py-3 rounded-xl flex items-center gap-2 font-bold hover:bg-slate-50 shadow-sm transition-all active:scale-95"><Archive size={20} className="text-indigo-600"/><span>Req History</span></button>
            <div className="bg-white p-1.5 rounded-xl border border-slate-200 shadow-sm flex gap-1">
                <button onClick={() => setActiveTab('active')} className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'active' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><ListTodo size={18}/> Active</button>
                <button onClick={() => setActiveTab('history')} className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${activeTab === 'history' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><History size={18}/> Completed</button>
            </div>
        </div>
      </div>
      
      <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden">
        {displayedOrders.length === 0 ? (
            <div className="p-20 text-center">
              <Info size={48} className="mx-auto text-slate-200 mb-4" />
              <p className="text-slate-400 text-lg font-medium">No production orders found in this section.</p>
            </div>
        ) : (
            <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b">
                <tr><th className="p-5 w-12"></th><th className="p-5">Order Reference</th><th className="p-5">Style & Quantity</th><th className="p-5">Production Progress</th><th className="p-5 text-right">Actions</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
                {displayedOrders.map(order => {
                const canAdvance = order.status !== OrderStatus.COMPLETED;
                const isReadyToComplete = order.status === OrderStatus.QC_APPROVED;
                const isCompleted = order.status === OrderStatus.COMPLETED;
                const formattedOrderNo = formatOrderNumber(order);
                return (
                    <tr key={order.id} className={`hover:bg-slate-50/80 transition-colors group ${selectedOrders.includes(order.id) ? 'bg-indigo-50/50' : ''} cursor-pointer`} onClick={() => { setUseNumericSizes(order.size_format === 'numeric'); setDetailsModal(order); }}>
                    <td className="p-5" onClick={e => e.stopPropagation()}>
                        {!isCompleted && <input type="checkbox" disabled={!canAdvance || isReadyToComplete} checked={selectedOrders.includes(order.id)} onChange={() => toggleSelect(order.id)} className="w-5 h-5 text-indigo-600 rounded-lg border-slate-300 focus:ring-indigo-500 disabled:opacity-30 cursor-pointer" />}
                    </td>
                    <td className="p-5">
                        <div className="font-black text-xl text-slate-800 group-hover:text-indigo-600 transition-colors">{formattedOrderNo}</div>
                        <div className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mt-1">
                          <Clock size={12}/> Due: {order.target_delivery_date}
                        </div>
                    </td>
                    <td className="p-5">
                        <div className="text-base font-bold text-slate-700">{order.style_number}</div>
                        <div className="text-xs font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md inline-block mt-1 uppercase tracking-tighter">Target: {order.quantity} pcs ({order.box_count || '---'} Boxes)</div>
                    </td>
                    <td className="p-5">
                        <StatusBadge status={order.status} />
                        {order.qc_notes && (
                          <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-100">
                            <div className="text-[10px] font-black text-red-600 uppercase flex items-center gap-1 mb-0.5"><AlertTriangle size={12}/> QC Feedback</div>
                            <div className="text-xs text-red-700 font-medium line-clamp-1">{order.qc_notes}</div>
                          </div>
                        )}
                    </td>
                    <td className="p-5 text-right flex justify-end gap-3 items-center flex-wrap" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { setUseNumericSizes(order.size_format === 'numeric'); setDetailsModal(order); }} className="p-2.5 bg-white hover:bg-slate-100 text-slate-600 rounded-xl border border-slate-200 shadow-sm transition-all active:scale-90" title="View Detail"><Eye size={20}/></button>
                        <button onClick={() => handleSendMaterialEmail(order.id)} disabled={emailLoading === order.id} className="p-2.5 bg-orange-50 hover:bg-orange-100 text-orange-600 rounded-xl border border-orange-200 shadow-sm transition-all active:scale-90" title="Email Req List">{emailLoading === order.id ? <Loader2 size={20} className="animate-spin" /> : <Mail size={20}/>}</button>
                        {isCompleted && (
                            <>
                                <button onClick={() => openTimeline(order.id, formattedOrderNo)} className="p-2.5 bg-teal-50 hover:bg-teal-100 text-teal-600 rounded-xl border border-teal-200 transition-all active:scale-90" title="Timeline"><Clock size={20}/></button>
                                <button onClick={() => window.open(`https://tintura-sst.vercel.app/api/completion-report?id=${encodeURIComponent(String(order.id))}`, '_blank')} className="p-2.5 bg-violet-50 hover:bg-violet-100 text-violet-600 rounded-xl border border-violet-200 transition-all active:scale-90" title="Completion Report"><Printer size={20}/></button>
                                <button onClick={() => openStockModal(order)} className="px-4 py-2.5 rounded-xl inline-flex items-center gap-2 shadow-sm font-black text-sm uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white transition-all active:scale-95" title="Commit completed pieces to inventory"><Boxes size={18}/><span>Commit Stock</span></button>
                            </>
                        )}
                        {!isCompleted && (
                            <>
                                <button onClick={() => openTimeline(order.id, formattedOrderNo)} className="p-2.5 bg-teal-50 hover:bg-teal-100 text-teal-600 rounded-xl border border-teal-200 transition-all active:scale-90" title="Timeline"><Clock size={20}/></button>
                                <button onClick={() => { setIsEditingRequest(null); setMaterialModal(order.id); }} className="p-2.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl border border-blue-200 transition-all active:scale-90" title="Requisition"><PackagePlus size={20}/></button>
                                {canAdvance && (
                                    <button onClick={() => handleSingleStatusUpdate(order.id, order.status)} className={`px-5 py-2.5 rounded-xl inline-flex items-center gap-2 shadow-lg font-black text-sm uppercase tracking-wider text-white transition-all active:scale-95 ${isReadyToComplete ? 'bg-green-600 hover:bg-green-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                                        {isReadyToComplete ? <><CheckCircle2 size={18} /><span>Finalize</span></> : <><ArrowRight size={18} /><span>Advance</span></>}
                                    </button>
                                )}
                            </>
                        )}
                    </td>
                    </tr>
                );
                })}
            </tbody>
            </table>
        )}
      </div>

      {activeTab === 'active' && <BulkActionToolbar selectedCount={selectedOrders.length} actions={[{ label: 'Advance Status', onClick: handleBulkStatusUpdate }]} />}

      {detailsModal && (
        <OrderDetailsModal 
          order={detailsModal} 
          useNumericSizes={useNumericSizes} 
          onToggleSizeFormat={() => setUseNumericSizes(!useNumericSizes)} 
          onClose={() => setDetailsModal(null)} 
          onPrint={() => handlePrintOrderSheet(detailsModal)} 
          onPrintMaterials={() => handlePrintMaterialForecast(detailsModal)}
        />
      )}

      {timelineModal && (
        <TimelineModal 
          orderNo={timelineModal.orderNo} 
          logs={timelineLogs} 
          statusUpdateText={statusUpdateText} 
          setStatusUpdateText={setStatusUpdateText} 
          onSubmitLog={submitManualStatusUpdate} 
          onClose={() => setTimelineModal(null)} 
        />
      )}

      {stockModalOrder && (
        <StockCommitModal
          order={stockModalOrder}
          commits={orderCommits}
          saving={stockSaving}
          onCommit={handleCommitStock}
          onUndo={handleUndoCommit}
          onClose={() => setStockModalOrder(null)}
        />
      )}

      {showMaterialHistory && (
        <MaterialHistoryModal 
          history={materialHistory} 
          orders={orders} 
          onClose={() => setShowMaterialHistory(false)} 
          onAddNew={(orderId) => { setIsEditingRequest(null); setMaterialModal(orderId); setShowMaterialHistory(false); }} 
          onEdit={handleEditRequest} 
          onDelete={handleDeleteRequest} 
          onPrint={handlePrintAccessoriesReceipt} 
        />
      )}

      {materialModal && (
        <MaterialRequestModal 
          orderId={materialModal} 
          orderNo={orders.find(o => o.id === materialModal) ? formatOrderNumber(orders.find(o => o.id === materialModal)!) : ''} 
          orders={orders} 
          onClose={() => setMaterialModal(null)} 
          isEditingRequest={isEditingRequest} 
          useNumericSizes={useNumericSizes} 
          onRefresh={refreshOrders} 
        />
      )}
    </div>
  );
};
