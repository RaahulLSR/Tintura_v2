import { supabase } from './supabase.js';
import { ActivityRecord, RiskLevel, UserRole } from '../types.js';

/**
 * Activity Registry
 * -----------------
 * Append-only audit log of every state-changing action (human or AI).
 * Each record keeps a `before` and `after` snapshot so any change can be undone.
 * This is the backbone of the "all actions recorded + undoable" governance rule.
 */

export interface LogParams {
  actor?: string;
  actor_role?: UserRole | string;
  source?: 'human' | 'ai';
  action: string;
  entity_table: string;
  entity_id?: string | null;
  summary: string;
  risk?: RiskLevel;
  before?: any | null;
  after?: any | null;
}

/** Record a single activity. Never throws — logging must not break the caller. */
export const logActivity = async (params: LogParams): Promise<void> => {
  const row = {
    actor: params.actor || 'System',
    actor_role: params.actor_role || 'SYSTEM',
    source: params.source || 'human',
    action: params.action,
    entity_table: params.entity_table,
    entity_id: params.entity_id ?? null,
    summary: params.summary,
    risk: params.risk || 'low',
    before: params.before ?? null,
    after: params.after ?? null,
    undone: false,
  };
  const { error } = await supabase.from('activity_log').insert([row]);
  if (error) console.error('activity_log insert failed:', error.message);
};

/** Fetch the most recent activity records (newest first). */
export const fetchActivity = async (limit = 100): Promise<ActivityRecord[]> => {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as ActivityRecord[];
};

/** Fetch activity for one specific entity row. */
export const fetchActivityForEntity = async (table: string, id: string): Promise<ActivityRecord[]> => {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('entity_table', table)
    .eq('entity_id', id)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data as ActivityRecord[];
};

/**
 * Revert a logged action using its snapshots.
 * - update (before + after present): upsert the `before` snapshot back.
 * - create (before null): the row was added, so remove it again.
 * - delete (after null): the row was removed, so restore the `before` snapshot.
 */
export const undoActivity = async (
  recordId: string
): Promise<{ success: boolean; error?: string }> => {
  const { data: rec, error: fetchErr } = await supabase
    .from('activity_log')
    .select('*')
    .eq('id', recordId)
    .single();
  if (fetchErr || !rec) return { success: false, error: 'Activity record not found' };

  const record = rec as ActivityRecord;
  if (record.undone) return { success: false, error: 'Action already undone' };

  try {
    if (record.before === null && record.after !== null) {
      // It was a creation -> delete the created row.
      if (!record.entity_id) throw new Error('Cannot undo bulk creation without an entity id');
      await supabase.from(record.entity_table).delete().eq('id', record.entity_id);
    } else if (record.before !== null) {
      // It was an update or delete -> restore the previous snapshot.
      const snapshot = Array.isArray(record.before) ? record.before : [record.before];
      const { error: upsertErr } = await supabase.from(record.entity_table).upsert(snapshot);
      if (upsertErr) throw upsertErr;
    } else {
      throw new Error('Nothing to undo for this record');
    }

    await supabase.from('activity_log').update({ undone: true }).eq('id', recordId);

    // Record the undo itself as a new activity entry for a complete trail.
    await logActivity({
      actor: 'System',
      action: 'undo',
      entity_table: record.entity_table,
      entity_id: record.entity_id,
      summary: `Reverted: ${record.summary}`,
      risk: 'high',
      before: record.after,
      after: record.before,
    });

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
};
