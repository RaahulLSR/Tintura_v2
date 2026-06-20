import { supabase } from './supabase.js';
import { FeatureToggle } from '../types.js';
import { logActivity } from './activityLog.js';

/**
 * Feature Toggles
 * ---------------
 * Every new capability ships behind a flag that defaults to OFF. A row only
 * exists in `feature_toggles` once a flag has been touched; a missing row is
 * treated as disabled. The Tech Manager flips these without a redeploy.
 */

// Canonical flag keys used across the app. Add new capabilities here.
export const FLAGS = {
  AI_CHAT: 'ai_chat',
  AI_WRITES: 'ai_writes',
  AI_VOICE: 'ai_voice',
  TECH_MANAGER_AI: 'tech_manager_ai',
  TELEGRAM_BOT: 'telegram_bot',
  WHATSAPP_BOT: 'whatsapp_bot',
} as const;

let cache: Record<string, boolean> | null = null;

/** Load all toggles into the in-memory cache. */
export const loadToggles = async (): Promise<Record<string, boolean>> => {
  const { data, error } = await supabase.from('feature_toggles').select('*');
  if (error || !data) {
    cache = {};
    return cache;
  }
  cache = {};
  (data as FeatureToggle[]).forEach((t) => {
    cache![t.key] = !!t.enabled;
  });
  return cache;
};

/** Synchronous check against the cache. Returns false (OFF) if unknown. */
export const isEnabled = (key: string): boolean => {
  if (!cache) return false;
  return cache[key] === true;
};

/** Async check that ensures the cache is populated first. */
export const checkEnabled = async (key: string): Promise<boolean> => {
  if (!cache) await loadToggles();
  return isEnabled(key);
};

/** Fetch every toggle for the Tech Manager control panel. */
export const fetchToggles = async (): Promise<FeatureToggle[]> => {
  const { data, error } = await supabase.from('feature_toggles').select('*').order('key');
  if (error || !data) return [];
  return data as FeatureToggle[];
};

/** Enable or disable a flag. High-risk: intended for the Tech Manager role. */
export const setToggle = async (
  key: string,
  enabled: boolean,
  actor = 'Tech Manager'
): Promise<{ success: boolean; error?: string }> => {
  const { data: existing } = await supabase
    .from('feature_toggles')
    .select('*')
    .eq('key', key)
    .maybeSingle();

  const { error } = await supabase.from('feature_toggles').upsert([
    { key, enabled, updated_at: new Date().toISOString(), updated_by: actor },
  ]);
  if (error) return { success: false, error: error.message };

  if (cache) cache[key] = enabled;

  await logActivity({
    actor,
    action: 'feature_toggle.set',
    entity_table: 'feature_toggles',
    entity_id: key,
    summary: `Feature '${key}' turned ${enabled ? 'ON' : 'OFF'}`,
    risk: 'high',
    before: existing ?? null,
    after: { key, enabled },
  });

  return { success: true };
};
