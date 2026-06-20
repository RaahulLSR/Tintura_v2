import { supabase } from './supabase.js';
import { logActivity } from './activityLog.js';

/**
 * App Settings (key/value store)
 * ------------------------------
 * Small, editable configuration the Tech Manager can change at runtime without
 * a redeploy — most importantly the AI assistant's system prompt. Mirrors the
 * feature-toggle pattern: an in-memory cache + a synchronous getter so the AI
 * agent can read the current prompt without an async hop.
 */

export const SETTINGS = {
  AI_SYSTEM_PROMPT: 'ai_system_prompt',
  DAILY_PULSE_TIME: 'daily_pulse_time',
} as const;

let cache: Record<string, string> | null = null;

/** Load all settings into the cache. */
export const loadSettings = async (): Promise<Record<string, string>> => {
  const { data, error } = await supabase.from('app_settings').select('*');
  if (error || !data) {
    cache = {};
    return cache;
  }
  cache = {};
  (data as any[]).forEach((s) => {
    cache![s.key] = s.value ?? '';
  });
  return cache;
};

/** Synchronous read from cache (empty string if unknown). */
export const getSetting = (key: string): string => {
  if (!cache) return '';
  return cache[key] ?? '';
};

/** Async read that guarantees the cache is populated. */
export const fetchSetting = async (key: string): Promise<string> => {
  if (!cache) await loadSettings();
  return getSetting(key);
};

/** Fetch all settings rows (for the control panel). */
export const fetchSettings = async (): Promise<{ key: string; value: string; updated_by?: string; updated_at?: string }[]> => {
  const { data, error } = await supabase.from('app_settings').select('*').order('key');
  if (error || !data) return [];
  return data as any[];
};

/** Update a setting. High-risk: Tech Manager only. */
export const setSetting = async (
  key: string,
  value: string,
  actor = 'Tech Manager'
): Promise<{ success: boolean; error?: string }> => {
  const { data: existing } = await supabase
    .from('app_settings')
    .select('*')
    .eq('key', key)
    .maybeSingle();

  const { error } = await supabase.from('app_settings').upsert([
    { key, value, updated_at: new Date().toISOString(), updated_by: actor },
  ]);
  if (error) return { success: false, error: error.message };

  if (cache) cache[key] = value;

  await logActivity({
    actor,
    action: 'app_setting.set',
    entity_table: 'app_settings',
    entity_id: key,
    summary: `Setting '${key}' updated`,
    risk: 'high',
    before: existing ?? null,
    after: { key, value },
  });

  return { success: true };
};
