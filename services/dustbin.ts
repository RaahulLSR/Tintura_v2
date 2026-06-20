import { supabase } from './supabase.js';
import { DustbinRecord } from '../types.js';
import { logActivity } from './activityLog.js';

/**
 * Dustbin (Recycle Bin)
 * ---------------------
 * Central soft-delete mechanism. Nothing in Tintura is ever hard-deleted.
 *
 * Two strategies are supported transparently:
 *  - FLAG tables (e.g. `orders`) already have a boolean `deleted` column. For
 *    these we simply set the flag so existing queries keep working, and we mirror
 *    a snapshot into `dustbin` for a unified recycle-bin UI.
 *  - Other tables have no flag column, so we snapshot the row into `dustbin` and
 *    remove it from the source table. The data lives safely in the snapshot and
 *    can be fully restored.
 */

// Tables that own a `deleted` boolean column (soft-delete in place).
const FLAG_TABLES = new Set<string>(['orders']);

/** Move a row to the dustbin. Returns the created dustbin record id. */
export const moveToDustbin = async (
  table: string,
  id: string,
  actor = 'System'
): Promise<{ success: boolean; error?: string; dustbinId?: string }> => {
  const { data: row, error: fetchErr } = await supabase.from(table).select('*').eq('id', id).single();
  if (fetchErr || !row) return { success: false, error: 'Record not found' };

  const { data: bin, error: binErr } = await supabase
    .from('dustbin')
    .insert([{ entity_table: table, entity_id: id, snapshot: row, deleted_by: actor, restored: false }])
    .select()
    .single();
  if (binErr) return { success: false, error: binErr.message };

  if (FLAG_TABLES.has(table)) {
    const { error } = await supabase.from(table).update({ deleted: true }).eq('id', id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) return { success: false, error: error.message };
  }

  await logActivity({
    actor,
    action: `${table}.delete`,
    entity_table: table,
    entity_id: id,
    summary: `Moved ${table} record to Dustbin`,
    risk: 'high',
    before: row,
    after: null,
  });

  return { success: true, dustbinId: (bin as DustbinRecord).id };
};

/** Restore a dustbin record back to its source table. */
export const restoreFromDustbin = async (
  dustbinId: string,
  actor = 'System'
): Promise<{ success: boolean; error?: string }> => {
  const { data: rec, error: fetchErr } = await supabase
    .from('dustbin')
    .select('*')
    .eq('id', dustbinId)
    .single();
  if (fetchErr || !rec) return { success: false, error: 'Dustbin record not found' };

  const record = rec as DustbinRecord;
  if (record.restored) return { success: false, error: 'Already restored' };

  try {
    if (FLAG_TABLES.has(record.entity_table)) {
      const { error } = await supabase
        .from(record.entity_table)
        .update({ deleted: false })
        .eq('id', record.entity_id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from(record.entity_table).upsert([record.snapshot]);
      if (error) throw error;
    }

    await supabase.from('dustbin').update({ restored: true }).eq('id', dustbinId);

    await logActivity({
      actor,
      action: `${record.entity_table}.restore`,
      entity_table: record.entity_table,
      entity_id: record.entity_id,
      summary: `Restored ${record.entity_table} record from Dustbin`,
      risk: 'high',
      before: null,
      after: record.snapshot,
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};

/** List items currently in the dustbin (not yet restored), newest first. */
export const fetchDustbin = async (limit = 200): Promise<DustbinRecord[]> => {
  const { data, error } = await supabase
    .from('dustbin')
    .select('*')
    .eq('restored', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as DustbinRecord[];
};
