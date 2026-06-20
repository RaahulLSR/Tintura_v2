// =====================================================================
// Generic document email — emails a generated PDF (PO / completion report) to
// every user of a target role, so documents arrive in BOTH the Tintura SST
// inbox and the recipients' mailboxes. The PDF is fetched from `pdfUrl` and
// attached; a link is also included as a fallback.
// =====================================================================
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { brandHeaderHtml, brandSealHtml } from '../services/brandAssets.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    const { targetRole, subject, heading, intro, pdfUrl, pdfLabel } = body;
    if (!targetRole || !pdfUrl || !subject) {
      return res.status(400).json({ message: 'targetRole, subject and pdfUrl are required.' });
    }
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Missing server environment configuration.');
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const { data: users } = await supabase
      .from('app_users')
      .select('email, full_name')
      .eq('role', targetRole);
    const recipients = (users || [])
      .map((u: any) => u.email)
      .filter((e: any) => e && String(e).includes('@'));
    if (recipients.length === 0) {
      return res.status(200).json({ success: true, sent: 0, message: 'No recipients with an email on file.' });
    }

    // Fetch the PDF so we can attach it (link still provided as a fallback).
    let attachments: any[] = [];
    try {
      const r = await fetch(pdfUrl);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        const fname = (subject.replace(/[^A-Za-z0-9._-]+/g, '_') || 'document') + '.pdf';
        attachments = [{ filename: fname, content: buf, contentType: 'application/pdf' }];
      }
    } catch { /* attachment optional; link still works */ }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });

    const html = `
      <div style="font-family:'Segoe UI',Tahoma,sans-serif;color:#1e293b;max-width:720px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="padding:24px 28px 8px;">${brandHeaderHtml('Document Delivery')}</div>
        <div style="background:#0b0b0c;padding:22px 28px;color:#fff;">
          <h1 style="margin:0;font-size:20px;letter-spacing:.5px;">${heading || subject}</h1>
        </div>
        <div style="padding:26px 28px;">
          <p style="font-size:15px;">${intro || 'A new document is available.'}</p>
          <p style="margin:24px 0;">
            <a href="${pdfUrl}" target="_blank"
               style="display:inline-block;background:#f5a623;color:#0b0b0c;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px;">
              ${pdfLabel || 'Open document'}
            </a>
          </p>
          <p style="font-size:13px;color:#64748b;">The document is also attached to this email as a PDF.</p>
          <hr style="border:0;border-top:1px solid #e2e8f0;margin:26px 0;" />
          <div style="margin-bottom:12px;">${brandSealHtml()}</div>
          <div style="font-size:12px;color:#94a3b8;">Automated delivery from the Tintura SST system · ${new Date().toLocaleString()}</div>
        </div>
      </div>`;

    await transporter.sendMail({
      from: `"Tintura SST" <${process.env.GMAIL_USER}>`,
      to: recipients.join(', '),
      subject,
      html,
      attachments,
    });

    return res.status(200).json({ success: true, sent: recipients.length });
  } catch (error: any) {
    console.error('send-doc-email error', error);
    return res.status(500).json({ success: false, message: error?.message || 'Email failed' });
  }
}
