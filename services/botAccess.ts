// =====================================================================
// Telegram bot access control (isomorphic: Control Center UI + webhook).
// Maps app-user ROLES to the set of bot menu actions they may use, so the
// Telegram bot enforces the same access levels as the web app.
// =====================================================================

/** A bot menu action: `key` matches the Telegram callback_data (e.g. 'act:files'). */
export interface BotAction {
  key: string;
  label: string;
}

/** Catalogue of every top-level Telegram menu action. */
export const BOT_ACTIONS: BotAction[] = [
  { key: 'act:files', label: 'Tech Pack files' },
  { key: 'act:measure', label: 'Measurement chart' },
  { key: 'act:summary', label: 'Style summary' },
  { key: 'act:upload', label: 'Add files to a style' },
  { key: 'act:reqadd', label: 'Add quantity / requirement' },
  { key: 'act:order', label: 'Order status & actions' },
  { key: 'act:orders', label: 'Active orders' },
  { key: 'act:matorder', label: 'Order materials' },
  { key: 'act:matpend', label: 'Materials to action' },
  { key: 'act:newmat', label: 'New material request' },
  { key: 'act:newpo', label: 'Raise PO (new sale)' },
  { key: 'act:popdf', label: 'Send a PO PDF' },
  { key: 'act:completionpdf', label: 'Order completion report' },
  { key: 'act:commit', label: 'Commit stock to inventory' },
  { key: 'act:stock', label: 'Inventory lookup' },
  { key: 'act:daily', label: 'Daily summary' },
  { key: 'act:voice', label: 'Voice / text update' },
  { key: 'act:ai', label: 'Ask AI a question' },
];

const ALL = BOT_ACTIONS.map((a) => a.key);

/**
 * Which bot actions each role may use. `'*'` means every action.
 * Role strings match the UserRole enum values.
 */
export const ROLE_BOT_ACCESS: Record<string, string[]> = {
  ADMIN: ['*'],
  TECH_MANAGER: ['*'],
  MANAGER: [
    'act:files', 'act:measure', 'act:summary',
    'act:upload', 'act:reqadd',
    'act:order', 'act:orders',
    'act:matorder', 'act:matpend', 'act:newmat',
    'act:newpo', 'act:popdf', 'act:completionpdf',
    'act:commit', 'act:stock',
    'act:daily', 'act:voice', 'act:ai',
  ],
  ACCESSORIES_MANAGER: [
    'act:files', 'act:measure', 'act:summary',
    'act:matorder', 'act:matpend', 'act:newmat',
    'act:daily', 'act:voice', 'act:ai',
  ],
  ACCOUNTS_INVENTORY: [
    'act:order', 'act:orders',
    'act:newpo', 'act:popdf',
    'act:completionpdf',
    'act:commit', 'act:stock',
    'act:daily', 'act:ai',
  ],
};

/** The set of action keys a role may use (expands `'*'`). */
export const allowedBotActions = (role?: string | null): string[] => {
  const list = ROLE_BOT_ACCESS[(role || '').toUpperCase()] || [];
  return list.includes('*') ? [...ALL] : list;
};

/** Whether a role may use a specific action key. */
export const canUseBotAction = (role: string | null | undefined, key: string): boolean => {
  const allowed = allowedBotActions(role);
  return allowed.includes(key);
};

/** Short human-readable summary of a role's bot access (for the Control Center table). */
export const accessSummary = (role?: string | null): string => {
  const list = ROLE_BOT_ACCESS[(role || '').toUpperCase()];
  if (!list) return 'No bot access';
  if (list.includes('*')) return 'Full access (all actions)';
  return list
    .map((k) => BOT_ACTIONS.find((a) => a.key === k)?.label || k)
    .join(', ');
};
