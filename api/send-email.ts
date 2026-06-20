
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';
import { brandHeaderDualLogoHtml, brandSealHtml } from '../services/brandAssets.js';

// Helper function to replicate formatOrderNumber logic on server-side
const formatOrderNo = (order: any) => {
    if (!order.order_no) return 'ORD-NEW';
    const match = order.order_no.match(/ORD-(\d+)/);
    const serial = match ? match[1] : order.order_no;
    const stylePart = order.style_number ? order.style_number.split('-')[0].trim() : 'STYLE';
    return `ORD-${stylePart}-${serial}`;
};

// Initialize Supabase
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const { order_id } = req.body;

  try {
    if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error("Missing server environment configuration.");
    }

    if (!order_id) return res.status(400).json({ message: 'Order ID is required' });

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // 1. Fetch Order Details
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .single();

    if (fetchError || !order) throw new Error(`Order not found: ${fetchError?.message}`);

    const formattedOrderNo = formatOrderNo(order);

    // 2. Fetch Recipient Email from app_users (Role: SUB_UNIT)
    const { data: subUnitUser, error: userError } = await supabase
      .from('app_users')
      .select('email, full_name')
      .eq('role', 'SUB_UNIT')
      .limit(1)
      .single();

    const recipientEmail = subUnitUser?.email || 'raahullsr@gmail.com'; // Fallback to your backup
    const recipientName = subUnitUser?.full_name || 'Sub-Unit Team';

    // 3. Prepare Size Matrix for Email and Attachment
    const headers = order.size_format === 'numeric' ? ['65', '70', '75', '80', '85', '90'] : ['S', 'M', 'L', 'XL', 'XXL', '3XL'];
    const keys = ['s', 'm', 'l', 'xl', 'xxl', 'xxxl'];
    
    const matrixRowsHtml = (order.size_breakdown || []).map((row: any) => {
        const total = keys.reduce((acc, k) => acc + (row[k] || 0), 0);
        return `
            <tr>
                <td style="border:1px solid #ddd; padding:8px; font-weight:bold;">${row.color}</td>
                ${keys.map(k => `<td style="border:1px solid #ddd; padding:8px; text-align:center;">${row[k] || 0}</td>`).join('')}
                <td style="border:1px solid #ddd; padding:8px; text-align:center; font-weight:bold; background:#f9f9f9;">${total}</td>
            </tr>
        `;
    }).join('');

    const matrixHeaderHtml = `
        <thead>
            <tr style="background:#eee;">
                <th style="border:1px solid #ddd; padding:8px; text-align:left;">Color</th>
                ${headers.map(h => `<th style="border:1px solid #ddd; padding:8px;">${h}</th>`).join('')}
                <th style="border:1px solid #ddd; padding:8px;">Total</th>
            </tr>
        </thead>
    `;

    // 4. Generate the "Print Sheet" HTML (Enhanced for Attachment)
    const productionSheetHtml = `
      <html>
        <head>
          <style>
            body { font-family: 'Helvetica', 'Arial', sans-serif; margin: 40px; color: #333; line-height: 1.6; }
            .header { text-align: center; border-bottom: 5px solid #1e293b; padding-bottom: 20px; margin-bottom: 30px; }
            .brand { font-size: 36px; font-weight: 900; color: #1e293b; margin: 0; }
            .title { font-size: 20px; text-transform: uppercase; color: #64748b; margin-top: 5px; letter-spacing: 2px; }
            .grid { display: table; width: 100%; border-spacing: 15px; margin-bottom: 30px; }
            .box { display: table-cell; padding: 15px; border: 2px solid #333; border-radius: 8px; background: #fff; width: 50%; }
            .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold; display: block; margin-bottom: 5px; }
            .value { font-size: 20px; font-weight: bold; color: #000; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #333; padding: 12px; text-align: center; font-size: 14px; }
            th { background: #f1f5f9; font-weight: bold; }
            .section-title { font-size: 18px; font-weight: bold; border-bottom: 2px solid #333; padding-bottom: 5px; margin-top: 40px; margin-bottom: 15px; text-transform: uppercase; }
            .notes-box { padding: 20px; border: 2px solid #333; background: #f8fafc; border-radius: 8px; min-height: 100px; font-size: 16px; }
            .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px; }
            .img-gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
            .img-item { border: 1px solid #ddd; padding: 10px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            ${brandHeaderDualLogoHtml('Manufacturing Job Sheet')}
          </div>

          <div class="grid">
            <div class="box">
                <span class="label">Order Number</span>
                <div class="value">${formattedOrderNo}</div>
            </div>
            <div class="box">
                <span class="label">Style Reference</span>
                <div class="value">${order.style_number}</div>
            </div>
          </div>
          <div class="grid">
            <div class="box">
                <span class="label">Target Quantity</span>
                <div class="value">${order.quantity} PCS</div>
            </div>
            <div class="box">
                <span class="label">Delivery Date</span>
                <div class="value">${order.target_delivery_date}</div>
            </div>
          </div>

          <div class="section-title">Size Breakdown Matrix</div>
          <table>
            ${matrixHeaderHtml}
            <tbody>${matrixRowsHtml}</tbody>
          </table>

          <div class="section-title">Production Instructions</div>
          <div class="notes-box">
            ${order.description || "No specific manufacturing instructions provided."}
          </div>

          ${(order.attachments || []).filter((a: any) => a.type === 'image').length > 0 ? `
            <div class="section-title">Visual References</div>
            <div class="img-gallery">
                ${order.attachments.filter((a: any) => a.type === 'image').map((img: any) => `
                    <div class="img-item">
                        <img src="${img.url}" style="max-width:100%; max-height:400px; border-radius:4px;" />
                        <div style="font-size:11px; margin-top:5px;">${img.name}</div>
                    </div>
                `).join('')}
            </div>
          ` : ''}

          <div class="footer">
            <div style="margin-bottom:14px;">${brandSealHtml()}</div>
            Generated on ${new Date().toLocaleString()} by Tintura SST Automated System.<br/>
            This is a production-ready document. Please verify all details before cutting.
          </div>
        </body>
      </html>
    `;

    // 5. Configure Nodemailer
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    // 6. Send Email
    const mailOptions = {
      from: `"Tintura SST Manufacturing" <${process.env.GMAIL_USER}>`,
      to: recipientEmail,
      subject: `[PRODUCTION ALERT] New Order ${formattedOrderNo} - Style: ${order.style_number}`,
      html: `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <div style="background: #1e293b; padding: 30px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 24px; letter-spacing: 1px;">NEW PRODUCTION ORDER</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.8;">Order No: ${formattedOrderNo} assigned to your unit.</p>
          </div>
          
          <div style="padding: 30px;">
            <p style="font-size: 16px;">Hello <strong>${recipientName}</strong>,</p>
            <p>A new manufacturing order has been successfully launched from the main HQ. Please find the production details below:</p>
            
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0; margin: 20px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px; font-weight: bold;">STYLE:</td><td style="text-align: right; font-weight: bold; color: #1e293b;">${order.style_number}</td></tr>
                    <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px; font-weight: bold;">TOTAL QTY:</td><td style="text-align: right; font-weight: bold; color: #4f46e5;">${order.quantity} Units</td></tr>
                    <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px; font-weight: bold;">DUE DATE:</td><td style="text-align: right; font-weight: bold; color: #ef4444;">${order.target_delivery_date}</td></tr>
                    <tr><td style="padding: 8px 0; color: #64748b; font-size: 13px; font-weight: bold;">FABRIC:</td><td style="text-align: right; font-weight: bold; color: #1e293b;">${order.fabric_details || 'As per Technical Pack'}</td></tr>
                </table>
            </div>

            <h3 style="color: #1e293b; border-left: 4px solid #4f46e5; padding-left: 12px; margin: 30px 0 15px 0;">Order Size Matrix</h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                ${matrixHeaderHtml.replace(/style="[^"]*"/g, 'style="border:1px solid #e2e8f0; padding:10px; background:#f1f5f9; text-align:center;"')}
                <tbody>${matrixRowsHtml.replace(/style="[^"]*"/g, 'style="border:1px solid #e2e8f0; padding:10px; text-align:center;"')}</tbody>
            </table>

            <h3 style="color: #1e293b; border-left: 4px solid #4f46e5; padding-left: 12px; margin: 30px 0 10px 0;">Manufacturing Instructions</h3>
            <div style="background: #fff; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px; font-style: italic; color: #475569;">
                ${order.description || 'No special instructions provided.'}
            </div>

            <p style="margin-top: 30px; font-size: 14px;"><strong>Action Required:</strong> Please print the attached <strong>Job Sheet</strong> for your floor managers and update the status in the Tintura SST portal once cutting begins.</p>
            
            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
            <div style="text-align: center; font-size: 12px; color: #94a3b8;">
                <p>This is an automated dispatch from the Tintura SST ERP System.</p>
                <p>&copy; ${new Date().getFullYear()} Tintura SST Hub</p>
            </div>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `JOB_SHEET_${formattedOrderNo}.html`,
          content: productionSheetHtml,
          contentType: 'text/html'
        }
      ],
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({ 
      success: true, 
      message: `Production sheet for ${formattedOrderNo} successfully sent to ${recipientEmail} (${recipientName})` 
    });

  } catch (error: any) {
    console.error('Email API Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || 'The email server encountered an error.' 
    });
  }
}
