import { createClient } from '@supabase/supabase-js';

// Parsed from your connection string
const PROJECT_URL = 'https://bapseixqlydizpdafegj.supabase.co';

// ⚠️ IMPORTANT: You must replace this with your actual Anon Key from Supabase Dashboard -> Project Settings -> API
const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhcHNlaXhxbHlkaXpwZGFmZWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2Mjc2OTMsImV4cCI6MjA5NzIwMzY5M30.pHWO-lEuEv_WoHQ8_F5ZWKRFRrrxEdhEi-q9ujWamzw'; 

// Safe environment variable access for Vercel/Vite/Node/Browser
const getEnv = (key: string) => {
  // 1. Check Vite/Vercel standard (import.meta.env)
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    // @ts-ignore
    return import.meta.env[key];
  }
  
  // 2. Check Node/Electron standard (process.env)
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
  } catch (e) {
    // process is not defined, ignore
  }
  return undefined;
};

// Check for VITE_ prefixed keys first (Standard for Vite apps on Vercel)
const SUPABASE_URL = getEnv('VITE_SUPABASE_URL') || getEnv('REACT_APP_SUPABASE_URL') || PROJECT_URL;
const SUPABASE_KEY = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('REACT_APP_SUPABASE_ANON_KEY') || DEFAULT_KEY;

if (SUPABASE_KEY === 'INSERT_YOUR_SUPABASE_ANON_KEY_HERE') {
  console.warn("⚠️ Supabase Anon Key is missing! The app is running in Mock Mode. Please update services/supabase.ts");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);