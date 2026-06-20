// One-time Storage migration: copy attachment files from the OLD Supabase
// project bucket into the NEW (cloned) project bucket.
//
// Why: cloning a Supabase project copies the Postgres database (so the
// attachment URLs already point at the new ref) but does NOT copy the actual
// files in Storage. Pre-clone images therefore 400 ("Object not found") on the
// new project. This script back-fills only the missing files.
//
// Run:
//   $env:SUPABASE_SERVICE_ROLE_KEY="<new project service_role key>"
//   node scripts/migrate-storage.mjs
//
// The service_role key is found in: Supabase Dashboard -> Project Settings ->
// API -> service_role (secret). Type it directly into the terminal; do not
// commit it. The OLD bucket is public, so no old-project key is needed.

import { createClient } from '@supabase/supabase-js';

const OLD_REF = 'hvrtjbdofmjdbncthnqq';
const NEW_URL = 'https://bapseixqlydizpdafegj.supabase.co';
// Anon key (read-only via open RLS) — only used to read attachment URLs.
const NEW_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhcHNlaXhxbHlkaXpwZGFmZWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjc2OTMsImV4cCI6MjA5NzIwMzY5M30.pHWO-lEuEv_WoHQ8_F5ZWKRFRrrxEdhEi-q9ujWamzw';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'order-attachments';
const PREFIX = `/storage/v1/object/public/${BUCKET}/`;

if (!SERVICE_ROLE) {
  console.error('ERROR: set SUPABASE_SERVICE_ROLE_KEY before running.');
  console.error('  PowerShell: $env:SUPABASE_SERVICE_ROLE_KEY="<service_role key>"');
  process.exit(1);
}

const dbClient = createClient(NEW_URL, NEW_ANON);
const adminClient = createClient(NEW_URL, SERVICE_ROLE);

// Recursively pull every storage object path out of an arbitrary JSON value.
function collectPaths(value, set) {
  if (value == null) return;
  if (typeof value === 'string') {
    const i = value.indexOf(PREFIX);
    if (i !== -1) {
      const raw = value.substring(i + PREFIX.length).split('?')[0];
      set.add(decodeURIComponent(raw));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, set);
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) collectPaths(value[key], set);
  }
}

const sources = [
  ['orders', 'attachments'],
  ['styles', 'tech_pack'],
  ['material_requests', 'attachments'],
];

const paths = new Set();
for (const [table, col] of sources) {
  const { data, error } = await dbClient.from(table).select(col);
  if (error) {
    console.warn(`skip ${table}.${col}: ${error.message}`);
    continue;
  }
  for (const row of data) collectPaths(row[col], paths);
}

console.log(`Found ${paths.size} unique storage paths referenced in the new DB.`);

let copied = 0;
let skipped = 0;
let missingInOld = 0;
let failed = 0;

for (const path of paths) {
  const encoded = path.split('/').map(encodeURIComponent).join('/');

  // Already present in the new bucket?
  const head = await fetch(`${NEW_URL}${PREFIX}${encoded}`, { method: 'HEAD' });
  if (head.ok) {
    skipped++;
    continue;
  }

  // Pull from the old (public) bucket.
  const oldRes = await fetch(`https://${OLD_REF}.supabase.co${PREFIX}${encoded}`);
  if (!oldRes.ok) {
    console.warn(`MISSING in old project (${oldRes.status}): ${path}`);
    missingInOld++;
    continue;
  }

  const buffer = Buffer.from(await oldRes.arrayBuffer());
  const contentType = oldRes.headers.get('content-type') || 'application/octet-stream';

  const { error: upErr } = await adminClient.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });

  if (upErr) {
    console.error(`UPLOAD FAILED: ${path} -> ${upErr.message}`);
    failed++;
    continue;
  }

  copied++;
  console.log(`copied: ${path}`);
}

console.log('\nDone.');
console.log({ copied, skipped, missingInOld, failed, total: paths.size });
