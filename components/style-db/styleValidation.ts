import { Style } from '../../types';

export interface StyleIssue {
  level: 'error' | 'warn';
  message: string;
}

/**
 * Validate a style for data quality before saving.
 * Errors block a clean save; warnings are advisory (data still saves).
 * This does NOT change any forecast math — it only inspects the existing
 * tech_pack shape to surface gaps that would silently break forecasts.
 */
export const validateStyle = (style: Style): StyleIssue[] => {
  const issues: StyleIssue[] = [];

  if (!style.style_number || !style.style_number.trim()) {
    issues.push({ level: 'error', message: 'Style number is required.' });
  }

  const colors = (style.available_colors || []).map(c => c.trim()).filter(Boolean);
  const sizes = (style.available_sizes || []).map(s => s.trim()).filter(Boolean);

  if (colors.length === 0) {
    issues.push({ level: 'warn', message: 'No colours defined — colour-split tech instructions cannot match an order.' });
  }
  if (sizes.length === 0) {
    issues.push({ level: 'warn', message: 'No sizes defined — size-split instructions and forecasts may not match.' });
  }

  const tp = style.tech_pack || {};
  for (const catName of Object.keys(tp)) {
    const cat = tp[catName] || {};
    for (const fieldName of Object.keys(cat)) {
      const item = cat[fieldName];
      if (!item) continue;
      const where = `${catName} › ${fieldName}`;

      if (!item.variants) {
        if (item.consumption_type && !item.consumption_val) {
          issues.push({ level: 'warn', message: `${where}: ratio is set but the value is 0 — this material will forecast as 0.` });
        }
      } else {
        item.variants.forEach(v => {
          const unknown = v.colors.filter(c => colors.length > 0 && !colors.includes(c));
          if (unknown.length > 0) {
            issues.push({ level: 'warn', message: `${where}: variant references colour(s) not in the palette: ${unknown.join(', ')}.` });
          }
          if (v.colors.length === 0) {
            issues.push({ level: 'warn', message: `${where}: a colour variant has no colours selected — it will never match an order.` });
          }
          if (!v.sizeVariants) {
            if (v.consumption_type && !v.consumption_val) {
              issues.push({ level: 'warn', message: `${where} (${v.colors.join('/') || 'variant'}): ratio set but value is 0.` });
            }
          } else {
            v.sizeVariants.forEach(sv => {
              const unknownSizes = sv.sizes.filter(s => sizes.length > 0 && !sizes.includes(s));
              if (unknownSizes.length > 0) {
                issues.push({ level: 'warn', message: `${where}: size group references size(s) not defined: ${unknownSizes.join(', ')}.` });
              }
              if (sv.sizes.length === 0) {
                issues.push({ level: 'warn', message: `${where}: a size group has no sizes selected — it will never match.` });
              }
              const t = sv.consumption_type || v.consumption_type || item.consumption_type;
              const val = sv.consumption_val !== undefined ? sv.consumption_val : (v.consumption_val !== undefined ? v.consumption_val : item.consumption_val);
              if (t && !val) {
                issues.push({ level: 'warn', message: `${where} (${sv.sizes.join('/') || 'sizes'}): ratio resolves to 0.` });
              }
            });
          }
        });
      }
    }
  }

  return issues;
};

/** Count how many template fields have any content (text / attachments / variants). */
export const countFilledFields = (style: Style): { filled: number; total: number } => {
  const tp = style.tech_pack || {};
  let filled = 0;
  let total = 0;
  for (const catName of Object.keys(tp)) {
    for (const fieldName of Object.keys(tp[catName] || {})) {
      total++;
      const item = tp[catName][fieldName];
      if (item && ((item.text && item.text.trim()) || (item.attachments && item.attachments.length > 0) || (item.variants && item.variants.length > 0))) {
        filled++;
      }
    }
  }
  return { filled, total };
};
