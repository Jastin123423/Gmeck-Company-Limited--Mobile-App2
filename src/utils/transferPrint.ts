import { BusinessSettings, StockTransfer } from '../types';
import { formatCurrency } from './formatters';
import { downloadTransferVoucherPdf } from './pdfExport';

const escapeHtml = (raw: string | number | undefined | null): string => {
  const s = String(raw ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

export const buildTransferPrintHtml = (
  transfer: StockTransfer,
  settings: BusinessSettings
): string => {
  const currency = settings.currencySymbol || 'TSh';
  const items = transfer.items || [];
  const productsTotal = items.reduce(
    (sum, item) => sum + Number(item.subtotal ?? item.quantity * item.unitPrice),
    0
  );
  const shipping = Math.max(0, Number(transfer.shippingCharges || 0));
  const grandTotal = productsTotal + shipping;
  const isCompleted = transfer.status === 'COMPLETED';

  const sourceLocText =
    transfer.sourceLocation ||
    transfer.sourceShopName ||
    (transfer.sourceType === 'STORE' ? 'Warehouse Store Location' : 'Shop Floor Location');
  const destLocText =
    transfer.destLocation ||
    transfer.destShopName ||
    (transfer.destType === 'STORE' ? 'Warehouse Store Location' : 'Shop Floor Location');

  const rowsHtml = items
    .map((item, idx) => {
      const subtotal = Number(item.subtotal ?? item.quantity * item.unitPrice);
      const rowBg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      return `
        <tr style="background:${rowBg};">
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:600;text-align:center;">${idx + 1}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;">
            <div style="font-weight:700;color:#0f172a;font-size:12.5px;">${escapeHtml(item.productName)}${item.variation ? ` <span style="color:#4f46e5;font-weight:600;font-size:11px;">(${escapeHtml(item.variation)})</span>` : ''}</div>
            <div style="font-size:10px;color:#64748b;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:2px;">SKU: ${escapeHtml(item.sku)} · Price: ${escapeHtml(formatCurrency(item.unitPrice, currency))} / ${escapeHtml(item.unit || 'pcs')}</div>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;color:#1e293b;font-size:12.5px;">
            ${Number(item.quantity || 0).toLocaleString()} <span style="font-weight:500;font-size:10.5px;color:#64748b;">${escapeHtml(item.unit || 'pcs')}</span>
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;color:#334155;font-size:12px;">
            ${escapeHtml(formatCurrency(item.unitPrice, currency))}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;color:#0f172a;font-size:12.5px;">
            ${escapeHtml(formatCurrency(subtotal, currency))}
          </td>
        </tr>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Stock Transfer ${escapeHtml(transfer.transferNumber)}</title>
  <style>
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    @page { size: A4; margin: 14mm; }
    body {
      margin: 0;
      padding: 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
    }
    .doc-wrap {
      max-width: 820px;
      margin: 0 auto;
      border: 1px solid #cbd5e1;
      border-radius: 14px;
      overflow: hidden;
    }
    .banner {
      background: linear-gradient(135deg, #0f172a 0%, #1d4ed8 60%, #4338ca 100%);
      color: #ffffff;
      padding: 22px 26px;
      border-bottom: 4px solid #38bdf8;
    }
    .banner-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
    }
    .biz-name {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin: 0;
    }
    .biz-sub {
      font-size: 11px;
      color: #bae6fd;
      margin-top: 3px;
    }
    .biz-contact {
      font-size: 10.5px;
      color: #e2e8f0;
      margin-top: 6px;
    }
    .voucher-badge {
      text-align: right;
    }
    .voucher-title {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #7dd3fc;
    }
    .voucher-num {
      font-size: 18px;
      font-weight: 800;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      margin-top: 2px;
    }
    .status-pill {
      display: inline-block;
      margin-top: 8px;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: ${isCompleted ? '#10b981' : '#f59e0b'};
      color: #ffffff;
    }
    .meta-strip {
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      background: #f1f5f9;
      padding: 10px 26px;
      border-bottom: 1px solid #cbd5e1;
      font-size: 11.5px;
      color: #334155;
    }
    .content { padding: 22px 26px; }
    .loc-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 18px;
    }
    .loc-card-from {
      background: #eff6ff;
      border: 1.5px solid #93c5fd;
      border-left: 5px solid #2563eb;
      border-radius: 10px;
      padding: 12px 14px;
    }
    .loc-card-to {
      background: #ecfdf5;
      border: 1.5px solid #6ee7b7;
      border-left: 5px solid #059669;
      border-radius: 10px;
      padding: 12px 14px;
    }
    .loc-kicker {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 4px;
    }
    .loc-name {
      font-size: 14.5px;
      font-weight: 800;
      color: #0f172a;
    }
    .loc-addr {
      font-size: 11.5px;
      color: #334155;
      margin-top: 3px;
    }
    .loc-shop {
      font-size: 10.5px;
      color: #64748b;
      margin-top: 2px;
    }
    .notice-box {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      border-left: 4px solid #d97706;
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 16px;
      font-size: 11.5px;
      color: #78350f;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
    }
    thead tr {
      background: #1e293b;
      color: #ffffff;
    }
    th {
      padding: 10px 12px;
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      text-align: left;
    }
    .totals-wrap {
      margin-top: 18px;
      display: flex;
      justify-content: flex-end;
    }
    .totals-box {
      width: 320px;
      border: 1.5px solid #cbd5e1;
      border-radius: 10px;
      overflow: hidden;
      background: #f8fafc;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 9px 14px;
      font-size: 12px;
      color: #334155;
      border-bottom: 1px solid #e2e8f0;
    }
    .totals-grand {
      display: flex;
      justify-content: space-between;
      padding: 12px 14px;
      background: linear-gradient(135deg, #1d4ed8 0%, #4338ca 100%);
      color: #ffffff;
      font-size: 14px;
      font-weight: 800;
    }
    .signatures {
      margin-top: 32px;
      padding-top: 18px;
      border-top: 1px dashed #cbd5e1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 28px;
      font-size: 11px;
      color: #475569;
    }
    .sig-line {
      margin-top: 28px;
      border-top: 1px solid #64748b;
      padding-top: 5px;
      font-weight: 600;
    }
    .footer-note {
      background: #f1f5f9;
      padding: 10px 26px;
      border-top: 1px solid #cbd5e1;
      text-align: center;
      font-size: 10px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="doc-wrap">
    <div class="banner">
      <div class="banner-top">
        <div>
          <h1 class="biz-name">${escapeHtml(settings.businessName || 'Inventory Management')}</h1>
          ${settings.tagline ? `<div class="biz-sub">${escapeHtml(settings.tagline)}</div>` : ''}
          <div class="biz-contact">
            ${[settings.address, settings.phone, settings.email].filter(Boolean).map(escapeHtml).join(' · ')}
          </div>
        </div>
        <div class="voucher-badge">
          <div class="voucher-title">Stock Transfer Document</div>
          <div class="voucher-num">${escapeHtml(transfer.transferNumber)}</div>
          <span class="status-pill">${isCompleted ? 'Completed' : 'Not Complete'}</span>
        </div>
      </div>
    </div>

    <div class="meta-strip">
      <div><strong>Transfer Date:</strong> ${escapeHtml(transfer.transferDate)}</div>
      <div><strong>Items:</strong> ${items.length.toLocaleString()} product(s) · <strong>${Number(transfer.totalUnits || 0).toLocaleString()}</strong> total units</div>
      <div><strong>Prepared By:</strong> ${escapeHtml(transfer.createdByName || 'Admin')}</div>
    </div>

    <div class="content">
      <div class="loc-grid">
        <div class="loc-card-from">
          <div class="loc-kicker" style="color:#1d4ed8;">Location From (${transfer.sourceType === 'STORE' ? 'Store Warehouse' : 'Shop Floor'})</div>
          <div class="loc-name">${escapeHtml(transfer.sourceName)}</div>
          <div class="loc-addr"><strong>Location:</strong> ${escapeHtml(sourceLocText)}</div>
          ${transfer.sourceShopName ? `<div class="loc-shop">Shop: ${escapeHtml(transfer.sourceShopName)}</div>` : ''}
        </div>
        <div class="loc-card-to">
          <div class="loc-kicker" style="color:#047857;">Location To (${transfer.destType === 'STORE' ? 'Store Warehouse' : 'Shop Floor'})</div>
          <div class="loc-name">${escapeHtml(transfer.destName)}</div>
          <div class="loc-addr"><strong>Location:</strong> ${escapeHtml(destLocText)}</div>
          ${transfer.destShopName ? `<div class="loc-shop">Shop: ${escapeHtml(transfer.destShopName)}</div>` : ''}
        </div>
      </div>

      ${transfer.notice ? `
        <div class="notice-box">
          <strong>Notice:</strong> ${escapeHtml(transfer.notice)}
        </div>
      ` : ''}

      <table>
        <thead>
          <tr>
            <th style="width:42px;text-align:center;">#</th>
            <th>Product Name</th>
            <th style="text-align:right;">Quantity</th>
            <th style="text-align:right;">Price</th>
            <th style="text-align:right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>

      <div class="totals-wrap">
        <div class="totals-box">
          <div class="totals-row">
            <span>Products Total (${Number(transfer.totalUnits || 0).toLocaleString()} units)</span>
            <strong style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(formatCurrency(productsTotal, currency))}</strong>
          </div>
          <div class="totals-row">
            <span>Shipping Charges</span>
            <strong style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(formatCurrency(shipping, currency))}</strong>
          </div>
          <div class="totals-grand">
            <span>Total</span>
            <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(formatCurrency(grandTotal, currency))}</span>
          </div>
        </div>
      </div>

      <div class="signatures">
        <div>
          <div class="sig-line">Dispatched / Prepared By (${escapeHtml(transfer.createdByName || 'Admin')})</div>
        </div>
        <div>
          <div class="sig-line">Received &amp; Checked By (Signature &amp; Date)</div>
        </div>
      </div>
    </div>

    <div class="footer-note">
      Printed on ${escapeHtml(new Date().toLocaleString())} · Reference: ${escapeHtml(transfer.transferNumber)}
    </div>
  </div>
</body>
</html>`;
};

export const printStockTransferVoucher = (
  transfer: StockTransfer,
  settings: BusinessSettings
): Promise<boolean> => {
  return downloadTransferVoucherPdf(transfer, settings);
};

