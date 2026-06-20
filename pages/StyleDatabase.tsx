
import React, { useEffect, useState, useRef } from 'react';
import { fetchStyles, upsertStyle, fetchStyleTemplate, deleteStyle, uploadOrderAttachment, fetchOrders, recordBulkEditHistory, syncAllOrdersWithStyles } from '../services/db';
import { Style, StyleTemplate, Attachment, TechPackItem, ConsumptionType, Order, POSTER_KEY, getStyleMainImage, getStyleCustomItems } from '../types';
import { 
  Plus, Search, Grid, Copy, Trash2, Settings, ArrowLeftRight, CheckSquare, Square, FileUp, Table, BookOpen, ChevronRight, Edit3, Printer, X, FileSpreadsheet, History, Calculator, Loader2, Wrench, ChevronDown
} from 'lucide-react';

// Imported modular components
import { StyleFullView } from '../components/style-db/StyleFullView';
import { AuditMatrixModal } from '../components/style-db/AuditMatrixModal';
import { BulkUpdateModal } from '../components/style-db/BulkUpdateModal';
import { BulkImportModal } from '../components/style-db/BulkImportModal';
import { StyleEditor } from '../components/style-db/StyleEditor';
import { CompareView } from '../components/style-db/CompareView';
import { countFilledFields } from '../components/style-db/styleValidation';
import { BulkAttributeUpdateModal } from '../components/style-db/BulkAttributeUpdateModal';
import { HistoryModal } from '../components/style-db/HistoryModal';

export const StyleDatabase: React.FC = () => {
  const [styles, setStyles] = useState<Style[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [template, setTemplate] = useState<StyleTemplate | null>(null);
  const [viewMode, setViewMode] = useState<'catalog' | 'compare'>('catalog');
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState<Style | null>(null);
  const [viewingStyle, setViewingStyle] = useState<Style | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [compareList, setCompareList] = useState<Style[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [garmentTypeOptions, setGarmentTypeOptions] = useState(['Pant', 'Trackpant', 'Shorts', 'T-shirt']);
  const [demographicOptions, setDemographicOptions] = useState(['Men', 'Boys']);
  const [isAuditViewOpen, setIsAuditViewOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [editTarget, setEditTarget] = useState<{ category?: string, field?: string } | null>(null);
  
  // Sync State
  const [isSyncing, setIsSyncing] = useState(false);

  // Bulk Mode States
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedStyleIds, setSelectedStyleIds] = useState<string[]>([]);
  const [isBulkUpdateModalOpen, setIsBulkUpdateModalOpen] = useState(false);
  const [isBulkImportModalOpen, setIsBulkImportModalOpen] = useState(false);
  const [isBulkAttributeUpdateOpen, setIsBulkAttributeUpdateOpen] = useState(false);
  const [bulkImportData, setBulkImportData] = useState<any[]>([]);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  // Bulk Selection Filters
  const [bulkSelFilter, setBulkSelFilter] = useState({ garment: '', demographic: '', category: '' });
  
  // Revised Bulk Update Form Structure
  const [bulkUpdateMeta, setBulkUpdateMeta] = useState<{
    strategy: 'overwrite' | 'append';
  }>({
    strategy: 'overwrite'
  });

  const [bulkFieldValues, setBulkFieldValues] = useState<Record<string, {
    isEnabled: boolean;
  } & TechPackItem>>({});

  const loadData = async () => {
    const [s, t, o] = await Promise.all([fetchStyles(), fetchStyleTemplate(), fetchOrders()]);
    setStyles(s);
    setTemplate(t);
    setOrders(o);
    const existingGarments = Array.from(new Set([...garmentTypeOptions, ...s.map(style => style.garment_type).filter(Boolean) as string[]]));
    const existingDemos = Array.from(new Set([...demographicOptions, ...s.map(style => style.demographic).filter(Boolean) as string[]]));
    setGarmentTypeOptions(existingGarments);
    setDemographicOptions(existingDemos);
    
    if (t) {
      const initialValues: Record<string, any> = {};
      t.config.forEach(cat => {
        cat.fields.forEach(f => {
          initialValues[`${cat.name}|${f}`] = { isEnabled: false, text: '', attachments: [] };
        });
      });
      setBulkFieldValues(initialValues);
    }
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!toolsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [toolsOpen]);

  const handleGlobalSync = async () => {
    if (!confirm("This will recalculate material forecasts for ALL existing orders based on current blueprints in the Style Database. This ensures consistency after tech-pack changes. Continue?")) return;
    
    setIsSyncing(true);
    try {
      const result = await syncAllOrdersWithStyles();
      alert(`Master Sync Complete!\n${result.updated} orders were recalculated and updated from the Style Database.`);
      loadData();
    } catch (err: any) {
      alert("Sync failed: " + err.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const filteredStyles = styles.filter(s => 
    s.style_number.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.category.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (s.garment_type && s.garment_type.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleSaveStyle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditing) return;
    setIsUploading(true);

    // RECORD HISTORY BEFORE SAVE IF EDITING
    if (isEditing.id) {
       const original = styles.find(s => s.id === isEditing.id);
       if (original) {
          await recordBulkEditHistory(`Individual Update: ${original.style_number}`, [original]);
       }
    }

    const payload: Partial<Style> = { ...isEditing };
    if (!payload.id || payload.id === "") delete payload.id;
    const { error } = await upsertStyle(payload);
    setIsUploading(false);
    if (!error) { 
      setIsEditing(null); 
      setEditTarget(null);
      loadData(); 
    } else { 
      alert(error); 
    }
  };

  const handleNewStyle = () => {
    setIsEditing({ 
      id: '', style_number: '', category: 'Casuals', packing_type: 'pouch', pcs_per_box: 0, 
      style_text: '', garment_type: 'T-shirt', demographic: 'Men', 
      available_colors: [''], available_sizes: ['S', 'M', 'L', 'XL', 'XXL', '3XL'], 
      size_type: 'letter', tech_pack: {} 
    });
    setEditTarget(null);
  };

  const handleCopyStyle = (sourceStyle: Style) => {
    const copy = JSON.parse(JSON.stringify(sourceStyle));
    copy.id = ''; 
    copy.style_number = `${sourceStyle.style_number} (Copy)`;
    setIsEditing(copy);
    setEditTarget(null);
  };

  const handleDelete = async (id: string) => { 
    if (confirm("Permanently delete this style?")) { await deleteStyle(id); loadData(); setViewingStyle(null); } 
  };

  const handleFileUpload = async (category: string, field: string, files: FileList | null, vIdx?: number, svIdx?: number) => {
    if (!files || !isEditing) return;
    setIsUploading(true);
    const updated = { ...isEditing };
    if (!updated.tech_pack[category]) updated.tech_pack[category] = {};
    if (!updated.tech_pack[category][field]) updated.tech_pack[category][field] = { text: '', attachments: [] };
    
    let target: Attachment[];
    if (vIdx !== undefined) {
      const variant = updated.tech_pack[category][field].variants![vIdx];
      if (svIdx !== undefined) target = variant.sizeVariants![svIdx].attachments;
      else target = variant.attachments;
    } else {
      target = updated.tech_pack[category][field].attachments;
    }

    const filesArr = Array.from(files) as File[];
    for (const file of filesArr) {
      const url = await uploadOrderAttachment(file);
      if (url) target.push({ name: file.name, url, type: file.type.startsWith('image/') ? 'image' : 'document' });
    }
    setIsEditing(updated);
    setIsUploading(false);
  };

  const handlePosterUpload = async (files: FileList | null) => {
    if (!files || !isEditing) return;
    setIsUploading(true);
    const updated: Style = { ...isEditing, tech_pack: { ...(isEditing.tech_pack || {}) } };
    const current: any = (updated.tech_pack as any)[POSTER_KEY] || { images: [], mainUrl: undefined };
    const imgs: Attachment[] = [...(current.images || [])];
    for (const file of Array.from(files) as File[]) {
      if (!file.type.startsWith('image/')) continue;
      const url = await uploadOrderAttachment(file);
      if (url) imgs.push({ name: file.name, url, type: 'image' });
    }
    (updated.tech_pack as any)[POSTER_KEY] = { images: imgs, mainUrl: current.mainUrl || imgs[0]?.url };
    setIsEditing(updated);
    setIsUploading(false);
  };

  const handleCSVImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      const splitCSV = (row: string) => {
          const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
          return row.split(regex).map(val => {
              let cleaned = val.trim();
              if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                  cleaned = cleaned.substring(1, cleaned.length - 1);
              }
              return cleaned;
          });
      };
      const headers = splitCSV(lines[0]).map(h => h.trim());
      const parsedData = lines.slice(1).map(line => {
        const values = splitCSV(line);
        if (values.length < headers.length) return null;
        const entry: any = {};
        headers.forEach((header, i) => entry[header] = values[i]);
        return entry;
      }).filter(Boolean);
      setBulkImportData(parsedData);
      setIsBulkImportModalOpen(true);
    };
    reader.readAsText(file);
    e.target.value = ''; 
  };

  const handleExecuteBulkImport = async () => {
    setIsUploading(true);
    try {
      for (const row of bulkImportData) {
        const styleNum = row['Style No.'] || row['Style No'] || row['StyleNo'];
        const gType = row['GarmentType'] || row['Garment Type'] || row['Garment'];
        const demo = row['Demographic'] || row['Demo'];
        const cat = row['Category'] || row['Cat'];
        const desc = row['Short description'] || row['Description'] || row['Short Description'];
        const cols = row['Available colours'] || row['Available colors'] || row['Colours'] || row['Colors'];
        const sizes = row['size variants'] || row['Size variants'] || row['Sizes'];
        const fabricValue = row['fabric'] || row['Fabric'];

        const newStyle: Partial<Style> = {
          style_number: styleNum || 'NEW-STYLE',
          garment_type: gType || 'T-shirt',
          demographic: demo || 'Men',
          category: cat || 'Casuals',
          style_text: desc || '',
          available_colors: (cols || '').split(',').map((s: string) => s.trim()).filter(Boolean),
          available_sizes: (sizes || '').split(',').map((s: string) => s.trim()).filter(Boolean),
          packing_type: 'pouch',
          pcs_per_box: 1,
          tech_pack: {},
          size_type: (sizes || '').match(/[a-zA-Z]/) ? 'letter' : 'number'
        };

        if (fabricValue) {
          const fabricNote = `Fabrication: ${fabricValue}`;
          newStyle.style_text = newStyle.style_text ? `${newStyle.style_text}\n${fabricNote}` : fabricNote;
        }
        await upsertStyle(newStyle);
      }
      alert(`Successfully created ${bulkImportData.length} new styles.`);
      setIsBulkImportModalOpen(false);
      setIsBulkMode(false);
      loadData();
    } catch (err) {
      alert("Import failed: " + err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedStyleIds.length === 0) return;
    setIsUploading(true);
    try {
      const selectedStyles = styles.filter(s => selectedStyleIds.includes(s.id));
      const enabledUpdates = (Object.entries(bulkFieldValues) as [string, typeof bulkFieldValues[string]][]).filter(([_, val]) => val.isEnabled);
      
      if (enabledUpdates.length === 0) {
        alert("Please select at least one field to update.");
        setIsUploading(false);
        return;
      }

      // RECORD HISTORY BEFORE BULK UPDATE
      const updatedFieldNames = enabledUpdates.map(([k]) => k.split('|')[1]).join(', ');
      await recordBulkEditHistory(`Bulk Update: ${updatedFieldNames} (${bulkUpdateMeta.strategy})`, selectedStyles);

      for (const style of selectedStyles) {
        const updatedStyle = JSON.parse(JSON.stringify(style));
        const { strategy } = bulkUpdateMeta;

        for (const [key, fieldData] of enabledUpdates) {
          const [category, field] = key.split('|');
          if (!updatedStyle.tech_pack[category]) updatedStyle.tech_pack[category] = {};
          
          const mergeText = (current: string, next: string) => strategy === 'overwrite' ? next : (current ? current + '\n' + next : next);
          const mergeAttachments = (current: Attachment[], next: Attachment[]) => strategy === 'overwrite' ? next : [...(current || []), ...next];

          const bulkItem = { ...fieldData };
          delete (bulkItem as any).isEnabled;

          const currentItem = updatedStyle.tech_pack[category][field] || { text: '', attachments: [] };

          if (!bulkItem.variants) {
            currentItem.text = mergeText(currentItem.text, bulkItem.text);
            currentItem.attachments = mergeAttachments(currentItem.attachments, bulkItem.attachments);
            if (bulkItem.consumption_type) currentItem.consumption_type = bulkItem.consumption_type;
            if (bulkItem.consumption_val !== undefined) currentItem.consumption_val = bulkItem.consumption_val;
            if (strategy === 'overwrite') delete (currentItem as any).variants;
          } else {
            if (strategy === 'overwrite') {
               currentItem.variants = [];
               delete (currentItem as any).text;
               delete (currentItem as any).attachments;
            } else if (!currentItem.variants) {
               currentItem.variants = [];
            }

            bulkItem.variants.forEach(bulkVar => {
              const validColors = bulkVar.colors.filter(c => updatedStyle.available_colors?.includes(c));
              if (validColors.length === 0) return;

              let targetVar = currentItem.variants!.find(v => JSON.stringify(v.colors.sort()) === JSON.stringify(validColors.sort()));
              if (!targetVar) {
                targetVar = { colors: validColors, text: '', attachments: [] };
                currentItem.variants!.push(targetVar);
              }

              if (!bulkVar.sizeVariants) {
                targetVar.text = mergeText(targetVar.text, bulkVar.text);
                targetVar.attachments = mergeAttachments(targetVar.attachments, bulkVar.attachments);
                if (bulkVar.consumption_type) targetVar.consumption_type = bulkVar.consumption_type;
                if (bulkVar.consumption_val !== undefined) targetVar.consumption_val = bulkVar.consumption_val;
                if (strategy === 'overwrite') delete (targetVar as any).sizeVariants;
              } else {
                if (strategy === 'overwrite') {
                  targetVar.sizeVariants = [];
                  delete (targetVar as any).text;
                  delete (targetVar as any).attachments;
                } else if (!targetVar.sizeVariants) {
                  targetVar.sizeVariants = [];
                }

                bulkVar.sizeVariants.forEach(bulkSizeVar => {
                  const validSizes = bulkSizeVar.sizes.filter(s => updatedStyle.available_sizes?.includes(s));
                  if (validSizes.length === 0) return;

                  let targetSizeVar = targetVar!.sizeVariants!.find(sv => JSON.stringify(sv.sizes.sort()) === JSON.stringify(validSizes.sort()));
                  if (!targetSizeVar) {
                    targetSizeVar = { sizes: validSizes, text: '', attachments: [] };
                    targetVar!.sizeVariants!.push(targetSizeVar);
                  }

                  targetSizeVar.text = mergeText(targetSizeVar.text, bulkSizeVar.text);
                  targetSizeVar.attachments = mergeAttachments(targetSizeVar.attachments, bulkSizeVar.attachments);
                  if (bulkSizeVar.consumption_type) targetSizeVar.consumption_type = bulkSizeVar.consumption_type;
                  if (bulkSizeVar.consumption_val !== undefined) targetSizeVar.consumption_val = bulkSizeVar.consumption_val;
                });
              }
            });
          }
          updatedStyle.tech_pack[category][field] = currentItem;
        }
        await upsertStyle(updatedStyle);
      }
      alert("Bulk update completed successfully.");
      setIsBulkUpdateModalOpen(false);
      setIsBulkMode(false);
      setSelectedStyleIds([]);
      loadData();
    } catch (err) {
      alert("Error during bulk update: " + err);
    } finally {
      setIsUploading(false);
    }
  };

  const toggleSelectStyle = (id: string) => {
    setSelectedStyleIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const applyBulkFilterSelection = (isSelecting: boolean) => {
    const matchingIds = styles.filter(s => {
      const matchesGarment = !bulkSelFilter.garment || s.garment_type === bulkSelFilter.garment;
      const matchesDemographic = !bulkSelFilter.demographic || s.demographic === bulkSelFilter.demographic;
      const matchesCategory = !bulkSelFilter.category || s.category === bulkSelFilter.category;
      return matchesGarment && matchesDemographic && matchesCategory;
    }).map(s => s.id);
    if (isSelecting) setSelectedStyleIds(prev => Array.from(new Set([...prev, ...matchingIds])));
    else setSelectedStyleIds(prev => prev.filter(id => !matchingIds.includes(id)));
  };

  const handleMatrixCellClick = (style: Style, catName: string, fieldName?: string) => {
    setIsEditing(style);
    setEditTarget({ category: catName, field: fieldName });
    setIsAuditViewOpen(false);
  };

  const checkCompleteness = (style: Style, cat: string, field: string) => {
    const item = style.tech_pack[cat]?.[field];
    if (!item) return false;
    return !!( (item.text && item.text.trim() !== '') || (item.attachments && item.attachments.length > 0) || (item.variants && item.variants.length > 0) );
  };

  const handlePrint = (style: Style) => {
    const win = window.open('', 'StylePrint', 'width=1000,height=800');
    if (!win || !template) return;

    const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const ratioLabel = (type?: string, val?: any) =>
      type ? `${val} ${type === 'items_per_pc' ? 'pcs/garment' : 'garments/pc'}` : '';

    // Compact attachments: small inline thumbnails + tiny doc tags.
    const renderAttachmentsHtml = (attachments: Attachment[]) => {
      if (!attachments || attachments.length === 0) return '';
      const images = attachments.filter(a => a.type === 'image');
      const docs = attachments.filter(a => a.type === 'document');
      let html = '';
      if (images.length) {
        html += '<div class="att-grid">';
        images.forEach(img => {
          html += `<figure class="att"><img src="${esc(img.url)}"/><figcaption>${esc(img.name)}</figcaption></figure>`;
        });
        html += '</div>';
      }
      if (docs.length) {
        html += '<div class="doc-row">';
        docs.forEach(doc => { html += `<span class="doc-chip">📎 ${esc(doc.name)}</span>`; });
        html += '</div>';
      }
      return html;
    };

    const categories = template.config.filter(c => c.name !== "General Info");

    // Each category becomes a dense table: Spec | Detail rows. Variants are
    // rendered as tight sub-rows so a full style fits on very few pages.
    const techPackHtml = categories.map((cat) => {
        const rows = cat.fields.map(f => {
            const item = style.tech_pack[cat.name]?.[f];
            if (!item || (!item.text && !(item.attachments || []).length && !(item.variants || []).length)) return '';
            let contentHtml = '';
            if (item.variants && item.variants.length) {
                contentHtml = item.variants.map(v => {
                    let sizeHtml = '';
                    if (v.sizeVariants && v.sizeVariants.length) {
                        sizeHtml = v.sizeVariants.map(sv => `
                            <div class="sv">
                                <span class="chips">${sv.sizes.map(sz => `<span class="chip chip-size">${esc(sz)}</span>`).join('')}${sv.consumption_type ? `<span class="chip chip-ratio">${esc(ratioLabel(sv.consumption_type, sv.consumption_val))}</span>` : ''}</span>
                                <span class="sv-text">${esc(sv.text) || '—'}</span>
                                ${renderAttachmentsHtml(sv.attachments)}
                            </div>`).join('');
                    }
                    return `
                      <div class="variant">
                        <div class="variant-head">
                          <span class="chips">${v.colors.map(c => `<span class="chip chip-color">${esc(c)}</span>`).join('')}${v.consumption_type ? `<span class="chip chip-ratio">${esc(ratioLabel(v.consumption_type, v.consumption_val))}</span>` : ''}</span>
                          <span class="variant-text">${esc(v.text) || '—'}</span>
                        </div>
                        ${renderAttachmentsHtml(v.attachments)}
                        ${sizeHtml}
                      </div>`;
                }).join('');
            } else {
              contentHtml = `<div class="cell-text">${esc(item.text) || '—'}${item.consumption_type ? ` <span class="chip chip-ratio">${esc(ratioLabel(item.consumption_type, item.consumption_val))}</span>` : ''}</div>${renderAttachmentsHtml(item.attachments)}`;
            }
            return `<tr><th class="spec">${esc(f)}</th><td class="detail">${contentHtml}</td></tr>`;
        }).filter(Boolean).join('');
        if (!rows) return '';
        return `
            <table class="spec-table">
              <thead><tr><th class="cat-head" colspan="2">${esc(cat.name)}</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>`;
    }).filter(Boolean).join('');

    // Per-style custom / extra items
    const customItems = getStyleCustomItems(style);
    const customNames = Object.keys(customItems);
    const customHtml = customNames.length ? `
        <table class="spec-table">
          <thead><tr><th class="cat-head" colspan="2">Additional Specifications</th></tr></thead>
          <tbody>
            ${customNames.map(name => {
              const item: any = customItems[name];
              const body = `<div class="cell-text">${esc(item.text) || '—'}</div>${renderAttachmentsHtml(item.attachments || [])}`;
              return `<tr><th class="spec">${esc(name)}</th><td class="detail">${body}</td></tr>`;
            }).join('')}
          </tbody>
        </table>` : '';

    const mainImg = getStyleMainImage(style);
    const heroHtml = mainImg ? `<div class="hero"><img src="${esc(mainImg)}"/></div>` : '';

    win.document.write(`
      <html>
        <head>
          <title>Tech Pack — ${esc(style.style_number)}</title>
          <style>
            * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            body { font-family: 'Segoe UI', system-ui, -apple-system, Arial, sans-serif; margin: 0; padding: 0; font-size: 9.5px; color: #111827; line-height: 1.35; background: #fff; }
            .page { max-width: 800px; margin: 0 auto; padding: 12px 16px 16px; }

            /* Masthead — one tight band */
            .masthead { display: flex; align-items: stretch; border: 1.5px solid #0f172a; border-radius: 4px; overflow: hidden; }
            .mh-brand { background: #0f172a; color: #fff; padding: 7px 12px; display: flex; flex-direction: column; justify-content: center; }
            .mh-brand b { font-size: 13px; font-weight: 900; letter-spacing: 1.5px; }
            .mh-brand small { font-size: 6.5px; font-weight: 700; letter-spacing: 2px; color: #94a3b8; margin-top: 1px; }
            .mh-style { flex: 1; display: flex; align-items: center; padding: 7px 14px; }
            .mh-style .num { font-size: 18px; font-weight: 900; color: #4338ca; letter-spacing: .5px; }
            .mh-style .sub { font-size: 8px; color: #475569; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; margin-left: 10px; }
            .mh-doc { text-align: right; padding: 7px 12px; border-left: 1px solid #e2e8f0; display: flex; flex-direction: column; justify-content: center; }
            .mh-doc small { font-size: 6.5px; font-weight: 700; letter-spacing: 1.5px; color: #94a3b8; text-transform: uppercase; }
            .mh-doc b { font-size: 9px; font-weight: 800; color: #0f172a; }

            /* Spec strip — many columns, very tight */
            .strip { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #cbd5e1; border-radius: 4px; overflow: hidden; margin-top: 8px; }
            .strip .c { padding: 4px 9px; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
            .strip .c:nth-child(4n) { border-right: none; }
            .strip .label { font-size: 6.5px; text-transform: uppercase; color: #94a3b8; font-weight: 800; letter-spacing: .6px; }
            .strip .value { font-size: 10px; font-weight: 800; color: #0f172a; margin-top: 1px; }

            /* Hero + palette row */
            .topgrid { display: grid; grid-template-columns: ${mainImg ? '180px 1fr' : '1fr'}; gap: 10px; margin-top: 8px; align-items: start; }
            .hero { border: 1px solid #e2e8f0; border-radius: 4px; background: #f8fafc; display: flex; align-items: center; justify-content: center; max-height: 180px; overflow: hidden; }
            .hero img { max-width: 100%; max-height: 180px; width: auto; height: auto; object-fit: contain; display: block; }
            .palette-box { display: grid; gap: 6px; }
            .pbox { border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 9px; background: #f8fafc; }
            .pbox .label { font-size: 6.5px; text-transform: uppercase; color: #94a3b8; font-weight: 800; letter-spacing: .6px; }
            .chips { display: inline-flex; flex-wrap: wrap; gap: 3px; align-items: center; }
            .pbox .chips { margin-top: 4px; }
            .chip { font-size: 8px; font-weight: 700; padding: 1.5px 7px; border-radius: 999px; letter-spacing: .2px; white-space: nowrap; }
            .chip-color { background: #fff; color: #334155; border: 1px solid #cbd5e1; text-transform: uppercase; }
            .chip-size { background: #4338ca; color: #fff; }
            .chip-ratio { background: #eef2ff; color: #4338ca; border: 1px solid #c7d2fe; }

            .summary { margin-top: 8px; padding: 6px 10px; border: 1px solid #e2e8f0; border-left: 3px solid #4338ca; border-radius: 4px; background: #f8fafc; font-size: 9px; color: #334155; white-space: pre-wrap; line-height: 1.4; }

            /* Dense spec tables */
            .spec-table { width: 100%; border-collapse: collapse; margin-top: 10px; border: 1px solid #cbd5e1; break-inside: auto; }
            .spec-table .cat-head { background: #0f172a; color: #fff; text-align: left; font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; padding: 4px 10px; }
            .spec-table th.spec { width: 110px; vertical-align: top; text-align: left; font-size: 8px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: .4px; padding: 5px 10px; background: #f1f5f9; border-top: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; }
            .spec-table td.detail { vertical-align: top; padding: 5px 10px; border-top: 1px solid #e5e7eb; }
            .spec-table tr { break-inside: avoid; }
            .cell-text { font-size: 9.5px; font-weight: 600; color: #0f172a; }

            .variant { border: 1px solid #e2e8f0; border-radius: 4px; background: #f8fafc; padding: 5px 8px; margin-top: 5px; break-inside: avoid; }
            .variant:first-child { margin-top: 0; }
            .variant-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
            .variant-text { font-size: 9.5px; font-weight: 600; color: #0f172a; }
            .sv { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; margin-top: 4px; padding-top: 4px; border-top: 1px dashed #d8dee9; }
            .sv-text { font-size: 9px; font-weight: 600; color: #1e293b; }

            .att-grid { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 5px; margin-top: 5px; }
            .att { margin: 0; border: 1px solid #e2e8f0; border-radius: 4px; overflow: hidden; background: #fff; break-inside: avoid; }
            .att img { display: block; max-width: 130px; max-height: 110px; width: auto; height: auto; }
            .att figcaption { padding: 2px 4px; font-size: 6px; font-weight: 600; color: #64748b; text-align: center; border-top: 1px solid #eef2f7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }
            .doc-row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
            .doc-chip { font-size: 7.5px; font-weight: 600; color: #4338ca; background: #eef2ff; border: 1px solid #c7d2fe; padding: 2px 6px; border-radius: 4px; }

            .footer { margin-top: 14px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
            .footer .org { font-size: 7px; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: .8px; }
            .footer .id { font-size: 6.5px; color: #cbd5e1; }

            @media print {
              .page { padding: 0; max-width: none; }
              @page { margin: 8mm; }
            }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="masthead">
              <div class="mh-brand"><b>TINTURA SST</b><small>FACTORY SPEC SHEET</small></div>
              <div class="mh-style"><span class="num">${esc(style.style_number)}</span><span class="sub">${esc(style.category)} · ${esc(style.garment_type || '—')} · ${esc(style.demographic || '—')}</span></div>
              <div class="mh-doc"><small>Issued</small><b>${new Date().toLocaleDateString()}</b></div>
            </div>

            <div class="strip">
              <div class="c"><div class="label">Style No</div><div class="value">${esc(style.style_number)}</div></div>
              <div class="c"><div class="label">Category</div><div class="value">${esc(style.category)}</div></div>
              <div class="c"><div class="label">Garment</div><div class="value">${esc(style.garment_type || 'N/A')}</div></div>
              <div class="c"><div class="label">Segment</div><div class="value">${esc(style.demographic || 'N/A')}</div></div>
              <div class="c"><div class="label">Packing</div><div class="value">${esc(style.packing_type)}</div></div>
              <div class="c"><div class="label">Pcs / Box</div><div class="value">${esc(style.pcs_per_box)}</div></div>
              <div class="c"><div class="label">Size Type</div><div class="value">${esc(style.size_type || '—')}</div></div>
              <div class="c"><div class="label">Colors / Sizes</div><div class="value">${(style.available_colors || []).filter(Boolean).length} / ${(style.available_sizes || []).length}</div></div>
            </div>

            <div class="topgrid">
              ${heroHtml}
              <div class="palette-box">
                <div class="pbox">
                  <span class="label">Approved Palette</span>
                  <div class="chips">${(style.available_colors || []).filter(c => c).map(c => `<span class="chip chip-color">${esc(c)}</span>`).join('') || '<span class="chip chip-color">—</span>'}</div>
                </div>
                <div class="pbox">
                  <span class="label">Size Grid (${esc(style.size_type)})</span>
                  <div class="chips">${(style.available_sizes || []).map(s => `<span class="chip chip-size">${esc(s)}</span>`).join('') || '<span class="chip chip-size">—</span>'}</div>
                </div>
              </div>
            </div>

            <div class="summary">${esc(style.style_text) || "Standard technical construction procedures apply. No specific summary provided."}</div>

            ${techPackHtml}
            ${customHtml}

            <div class="footer">
              <div class="org">Tintura SST · Factory Spec Sheet</div>
              <div class="id">ID ${esc(style.id)} · ${new Date().toLocaleString()}</div>
            </div>
          </div>
          <script>window.onload = () => { setTimeout(() => window.print(), 600); };</script>
        </body>
      </html>`);
    win.document.close();
  };

  const unionColors = Array.from(new Set(styles.flatMap(s => s.available_colors || []))).filter(Boolean).sort();
  const unionSizes = Array.from(new Set(styles.flatMap(s => s.available_sizes || []))).filter(Boolean).sort();

  if (viewingStyle) return <StyleFullView style={viewingStyle} template={template} onBack={() => setViewingStyle(null)} onEdit={() => { setIsEditing(viewingStyle); setViewingStyle(null); }} onPrint={() => handlePrint(viewingStyle)} onDelete={() => handleDelete(viewingStyle.id)} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row justify-between xl:items-center gap-4">
        <div><h2 className="text-3xl font-black text-slate-800 flex items-center gap-3"><div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg"><BookOpen size={28}/></div>Style Technical Database</h2><p className="text-slate-500 text-sm mt-1">Master Tech-Packs and Design Blueprint Management · <span className="font-bold text-slate-600">{styles.length} styles</span></p></div>
        <div className="flex items-center gap-3">
          <div className="bg-white p-1 rounded-xl border border-slate-200 shadow-sm flex">
            <button onClick={() => setViewMode('catalog')} className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'catalog' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><Grid size={18}/> Catalog</button>
            <button onClick={() => setViewMode('compare')} className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'compare' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}><ArrowLeftRight size={18}/> Compare</button>
          </div>

          <button onClick={() => { setIsBulkMode(!isBulkMode); setSelectedStyleIds([]); }} className={`p-3 rounded-xl border transition-all flex items-center gap-2 font-bold text-sm ${isBulkMode ? 'bg-orange-600 text-white border-orange-600 shadow-lg' : 'bg-white border-slate-200 text-slate-500 hover:border-orange-500 hover:text-orange-600'}`}><CheckSquare size={20}/> {isBulkMode ? 'Exit Bulk' : 'Bulk'}</button>

          {/* Tools dropdown — declutters the secondary utilities */}
          <div className="relative" ref={toolsRef}>
            <button onClick={() => setToolsOpen((v) => !v)} className={`p-3 rounded-xl border transition-all flex items-center gap-2 font-bold text-sm ${toolsOpen ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-500'}`}><Wrench size={18}/> Tools <ChevronDown size={15} className={`transition-transform ${toolsOpen ? 'rotate-180' : ''}`}/></button>
            {toolsOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 p-2 animate-fade-in">
                <button onClick={() => { setToolsOpen(false); handleGlobalSync(); }} disabled={isSyncing} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-all">{isSyncing ? <Loader2 size={18} className="animate-spin text-orange-500" /> : <Calculator size={18} className="text-orange-500"/>} Sync All Forecasts</button>
                <button onClick={() => { setToolsOpen(false); setIsAuditViewOpen(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all"><Table size={18} className="text-indigo-500"/> Matrix Audit</button>
                <button onClick={() => { setToolsOpen(false); setIsBulkAttributeUpdateOpen(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all"><FileSpreadsheet size={18} className="text-green-500"/> Sync Values (CSV)</button>
                <button onClick={() => { setToolsOpen(false); setIsHistoryOpen(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all"><History size={18} className="text-slate-400"/> History</button>
                <div className="h-px bg-slate-100 my-1.5" />
                <button onClick={() => { setToolsOpen(false); setIsConfigOpen(true); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all"><Settings size={18} className="text-slate-400"/> Template Settings</button>
              </div>
            )}
          </div>

          <button onClick={handleNewStyle} className="bg-indigo-600 text-white px-6 py-3 rounded-xl flex items-center gap-2 font-black hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all active:scale-95"><Plus size={20}/> New Style</button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1"><input type="text" placeholder="Search by Style Number, Category, or Garment Type..." className="w-full pl-12 pr-4 py-4 rounded-2xl border-2 border-slate-100 focus:border-indigo-500 outline-none transition-all font-bold shadow-sm bg-white text-black" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/><Search className="absolute left-4 top-4 text-slate-400" size={24}/></div>
        <div className="shrink-0 px-5 py-4 bg-white rounded-2xl border-2 border-slate-100 shadow-sm text-center min-w-[96px]">
          <div className="text-xl font-black text-indigo-600 leading-none">{filteredStyles.length}</div>
          <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-1">{searchTerm ? 'Matches' : 'Styles'}</div>
        </div>
      </div>

      {isBulkMode && (
        <div className="bg-slate-900/5 p-6 rounded-3xl border-2 border-dashed border-indigo-200 animate-fade-in">
           <div className="flex flex-col md:flex-row items-end gap-4">
              <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Garment Type Filter</label><select className="w-full border-2 border-slate-100 rounded-xl p-3 bg-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={bulkSelFilter.garment} onChange={e => setBulkSelFilter({...bulkSelFilter, garment: e.target.value})}><option value="">All Garment Types</option>{garmentTypeOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></div>
                 <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Demographic Filter</label><select className="w-full border-2 border-slate-100 rounded-xl p-3 bg-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={bulkSelFilter.demographic} onChange={e => setBulkSelFilter({...bulkSelFilter, demographic: e.target.value})}><option value="">All Demographics</option>{demographicOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}</select></div>
                 <div><label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Category Filter</label><select className="w-full border-2 border-slate-100 rounded-xl p-3 bg-white font-bold text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={bulkSelFilter.category} onChange={e => setBulkSelFilter({...bulkSelFilter, category: e.target.value})}><option value="">All Categories</option><option value="Casuals">Casuals</option><option value="Lite">Lite</option><option value="Sportz">Sportz</option></select></div>
              </div>
              <div className="flex gap-2 shrink-0"><button onClick={() => applyBulkFilterSelection(true)} className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all flex items-center gap-2"><CheckSquare size={16}/> Select All Matching</button><button onClick={() => applyBulkFilterSelection(false)} className="px-5 py-3 bg-white text-slate-500 border border-slate-200 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2"><Square size={16}/> Deselect All Matching</button></div>
           </div>
        </div>
      )}

      {viewMode === 'catalog' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 animate-fade-in relative pb-24">
          {filteredStyles.map(style => {
            const isSelected = selectedStyleIds.includes(style.id);
            const accent = style.category === 'Casuals' ? 'bg-indigo-500' : style.category === 'Lite' ? 'bg-teal-500' : style.category === 'Sportz' ? 'bg-orange-500' : 'bg-slate-300';
            const mainImg = getStyleMainImage(style);
            return (
              <div key={style.id} className={`bg-white rounded-2xl border shadow-sm hover:shadow-xl transition-all group overflow-hidden flex flex-col ${isBulkMode && isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200'}`}>
                <div className={`h-1.5 ${accent}`} />
                {mainImg && (
                  <div className="h-36 bg-slate-50 border-b border-slate-100 flex items-center justify-center overflow-hidden cursor-pointer" onClick={() => isBulkMode ? toggleSelectStyle(style.id) : setViewingStyle(style)}>
                    <img src={mainImg} alt={style.style_number} className="w-full h-full object-contain" />
                  </div>
                )}
                <div className="p-6 flex-1 cursor-pointer relative" onClick={() => isBulkMode ? toggleSelectStyle(style.id) : setViewingStyle(style)}>
                  {isBulkMode && <div className="absolute top-4 right-4 z-10">{isSelected ? <CheckSquare className="text-indigo-600"/> : <Square className="text-slate-300"/>}</div>}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex gap-2">
                      <div className="bg-slate-100 px-3 py-1 rounded-full text-[10px] font-black text-slate-500 uppercase tracking-widest">{style.garment_type}</div>
                      <div className="bg-indigo-50 px-3 py-1 rounded-full text-[10px] font-black text-indigo-500 uppercase tracking-widest">{style.demographic}</div>
                    </div>
                    {!isBulkMode && <div className="flex gap-2" onClick={e => e.stopPropagation()}><button onClick={() => handlePrint(style)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"><Printer size={16}/></button><button onClick={() => handleDelete(style.id)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"><Trash2 size={16}/></button></div>}
                  </div>
                  <div className="flex items-center justify-between group/title"><h3 className="text-2xl font-black text-slate-800 tracking-tight mb-2 group-hover/title:text-indigo-600 transition-colors">{style.style_number}</h3><ChevronRight size={20} className="text-slate-300 group-hover:text-indigo-600 transition-all transform group-hover:translate-x-1" /></div>
                  <p className="text-slate-500 text-xs font-medium line-clamp-2 leading-relaxed mb-4">{style.style_text || 'No description provided.'}</p>
                  {(() => {
                    const cols = (style.available_colors || []).filter(c => c && c.trim());
                    const sizes = (style.available_sizes || []).filter(s => s && s.trim());
                    const { filled, total } = countFilledFields(style);
                    const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
                    return (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          {cols.slice(0, 4).map((c, i) => (
                            <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded-md">{c}</span>
                          ))}
                          {cols.length > 4 && <span className="text-[10px] font-black text-slate-400">+{cols.length - 4}</span>}
                          {cols.length === 0 && <span className="text-[10px] text-slate-300 italic">No colours</span>}
                          <span className="ml-auto text-[10px] font-black text-indigo-500">{sizes.length} sizes</span>
                        </div>
                        {total > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} /></div>
                            <span className="text-[9px] font-black text-slate-400">{filled}/{total}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {!isBulkMode && (
                  <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-2">
                    <button onClick={() => { setIsEditing(style); setEditTarget(null); }} className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 hover:border-indigo-500 hover:text-indigo-600 transition-all flex items-center justify-center gap-2"><Edit3 size={14}/> Edit</button>
                    <button onClick={(() => handleCopyStyle(style))} className="p-2.5 bg-white text-slate-400 border border-slate-200 rounded-xl hover:text-indigo-600 hover:border-indigo-600 transition-all" title="Create Copy"><Copy size={16}/></button>
                    <button onClick={() => { if (compareList.find(s => s.id === style.id)) setCompareList(prev => prev.filter(s => s.id !== style.id)); else { setCompareList(prev => [...prev, style]); setViewMode('compare'); } }} className={`p-2.5 rounded-xl border transition-all ${compareList.find(s => s.id === style.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border border-slate-200 hover:border-indigo-500 hover:text-indigo-600'}`}><ArrowLeftRight size={18}/></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'catalog' && filteredStyles.length === 0 && (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 py-16 text-center animate-fade-in">
          <div className="inline-flex p-4 bg-slate-50 rounded-2xl mb-4"><BookOpen size={32} className="text-slate-300" /></div>
          <p className="font-black text-slate-600">{searchTerm ? 'No styles match your search.' : 'No styles yet.'}</p>
          <p className="text-sm text-slate-400 mt-1">{searchTerm ? 'Try a different style number or category.' : 'Click “New Style” to create your first blueprint.'}</p>
        </div>
      )}

      {isBulkMode && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
           <div className="bg-slate-900 text-white rounded-full px-8 py-4 shadow-2xl flex items-center gap-6 border border-white/10">
              <div className="flex flex-col"><span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Bulk Actions</span><span className="text-xl font-black">{selectedStyleIds.length} Selected</span></div>
              <div className="h-10 w-px bg-white/20"></div>
              <div className="flex items-center gap-3">
                {selectedStyleIds.length > 0 && <button onClick={() => setIsBulkUpdateModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-full font-black text-sm transition-all active:scale-95 shadow-lg flex items-center gap-2"><Edit3 size={18}/> Edit technical fields</button>}
                <button onClick={() => bulkFileRef.current?.click()} className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-2.5 rounded-full font-black text-sm transition-all active:scale-95 shadow-lg flex items-center gap-2"><FileUp size={18}/> Create Bulk (CSV)</button>
                <input type="file" ref={bulkFileRef} accept=".csv" className="hidden" onChange={handleCSVImport} />
              </div>
              <button onClick={() => { setSelectedStyleIds([]); setIsBulkMode(false); }} className="text-slate-400 hover:text-white transition-colors ml-2"><X/></button>
           </div>
        </div>
      )}

      {viewMode === 'compare' && (
        <CompareView
          compareList={compareList}
          template={template}
          onRemove={(id) => setCompareList(prev => prev.filter(s => s.id !== id))}
          onBackToCatalog={() => setViewMode('catalog')}
        />
      )}

      {isEditing && (
        <StyleEditor 
          isEditing={isEditing} styles={styles} template={template} 
          setIsEditing={setIsEditing} handleSaveStyle={handleSaveStyle} handleCopyStyle={handleCopyStyle} 
          handleFileUpload={handleFileUpload} handlePosterUpload={handlePosterUpload} editTarget={editTarget}
          garmentTypeOptions={garmentTypeOptions} setGarmentTypeOptions={setGarmentTypeOptions}
          demographicOptions={demographicOptions} setDemographicOptions={setDemographicOptions}
          isUploading={isUploading}
        />
      )}

      {isAuditViewOpen && (
        <AuditMatrixModal 
          styles={styles} template={template} onClose={() => setIsAuditViewOpen(false)} 
          onCellClick={handleMatrixCellClick} checkCompleteness={checkCompleteness} 
        />
      )}

      {isHistoryOpen && (
        <HistoryModal 
          onClose={() => setIsHistoryOpen(false)}
          onUndoSuccess={loadData}
        />
      )}

      {isBulkUpdateModalOpen && (
        <BulkUpdateModal 
          styles={styles} template={template} selectedStyleIds={selectedStyleIds} 
          bulkUpdateMeta={bulkUpdateMeta} setBulkUpdateMeta={setBulkUpdateMeta} 
          bulkFieldValues={bulkFieldValues} setBulkFieldValues={setBulkFieldValues}
          isUploading={isUploading} setIsUploading={setIsUploading}
          onClose={() => setIsBulkUpdateModalOpen(false)} onExecute={handleBulkUpdate}
          unionColors={unionColors}
          unionSizes={unionSizes}
          orders={orders}
        />
      )}

      {isBulkImportModalOpen && (
        <BulkImportModal 
          bulkImportData={bulkImportData} isUploading={isUploading} 
          onClose={() => setIsBulkImportModalOpen(false)} onExecute={handleExecuteBulkImport} 
        />
      )}

      {isBulkAttributeUpdateOpen && (
        <BulkAttributeUpdateModal 
          styles={styles} 
          template={template} 
          onClose={() => setIsBulkAttributeUpdateOpen(false)} 
          onRefresh={loadData}
        />
      )}
    </div>
  );
};
