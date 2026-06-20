
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { brandHeaderHtml } from '../services/brandAssets.js';

const formatOrderNo = (order: any) => {
    if (!order.order_no) return 'ORD-NEW';
    const match = order.order_no.match(/ORD-(\d+)/);
    const serial = match ? match[1] : order.order_no;
    const stylePart = order.style_number ? order.style_number.split('-')[0].trim() : 'STYLE';
    return `ORD-${stylePart}-${serial}`;
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const { order_id } = req.body;

  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error("Missing server environment configuration.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // 1. Fetch Order and Material Requests
    const { data: order } = await supabase.from('orders').select('*').eq('id', order_id).single();
    const { data: requests } = await supabase.from('material_requests').select('*').eq('order_id', order_id);

    if (!order || !requests || requests.length === 0) {
        return res.status(404).json({ message: 'No material requests found for this order.' });
    }

    const formattedOrderNo = formatOrderNo(order);

    // 2. Fetch Materials Team Email from Database
    const { data: materialUser } = await supabase.from('app_users').select('email, full_name').eq('role', 'MATERIALS').limit(1).single();
    const recipientEmail = materialUser?.email || 'raahullsr@gmail.com';
    const recipientName = materialUser?.full_name || 'Materials Department';

    // 3. Generate Receipt HTML (Accessories Requirement Receipt)
    const receiptHtml = `
      <html>
        <head>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #333; }
            .header { text-align: center; border-bottom: 3px solid #000; margin-bottom: 20px; padding-bottom: 10px; }
            .brand { font-size: 24px; font-weight: 900; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ccc; padding: 12px; text-align: left; }
            th { background: #f4f4f4; text-transform: uppercase; font-size: 12px; }
            .footer { margin-top: 30px; text-align: center; font-size: 11px; color: #666; }
          </style>
        </head>
        <body>
            <div class="header">
                ${brandHeaderHtml('Accessories Requirement Receipt')}
                <p style="margin-top:10px;">Order: ${formattedOrderNo} | Style: ${order.style_number}</p>
            </div>
            <table>
                <thead>
                    <tr><th>Item Description</th><th>Required Qty</th><th>Unit</th><th>Status</th></tr>
                </thead>
                <tbody>
                    ${requests.map(r => `<tr><td>${r.material_content}</td><td>${r.quantity_requested}</td><td>${r.unit || 'Nos'}</td><td>${r.status}</td></tr>`).join('')}
                </tbody>
            </table>
            <div class="footer">Generated via Tintura SST MES on ${new Date().toLocaleString()}</div>
        </body>
      </html>
    `;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    });

    await transporter.sendMail({
      from: `"Tintura Sub-Unit" <${process.env.GMAIL_USER}>`,
      to: recipientEmail,
      subject: `[MATERIAL REQ] Order #${formattedOrderNo} - Accessories Required`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
            <div style="background: #4f46e5; color: white; padding: 20px; text-align: center;">
                <h2 style="margin: 0;">Material Requisition Alert</h2>
            </div>
            <div style="padding: 20px; line-height: 1.5; color: #1e293b;">
                <p>Hello <strong>${recipientName}</strong>,</p>
                <p>The sub-unit has submitted a requisition for accessories needed to process <strong>Order #${formattedOrderNo}</strong> (Style: ${order.style_number}).</p>
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 15px; margin: 20px 0;">
                    <p style="margin: 0 0 10px 0;"><strong>Summary of Items:</strong></p>
                    <ul style="margin: 0; padding-left: 20px;">
                        ${requests.map(r => `<li>${r.material_content}: ${r.quantity_requested} ${r.unit || 'Nos'}</li>`).join('')}
                    </ul>
                </div>
                <p>Please find the official <strong>ACCESSORIES REQUIREMENT RECEIPT</strong> attached. You can approve these quantities in the MES portal.</p>
            </div>
        </div>
      `,
      attachments: [{ filename: `ACCESSORIES_RECEIPT_${formattedOrderNo}.html`, content: receiptHtml, contentType: 'text/html' }],
    });

    return res.status(200).json({ success: true, message: `Requisition alert sent to ${recipientEmail}` });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
