import { BusinessSettings, InventoryMovement } from '../types';
import { formatCurrency, formatDateTime } from './formatters';
import { downloadMovementsReportPdf } from './pdfExport';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface MovementsPrintMeta {
  periodLabel: string;
  typeLabel: string;
  shopLabel: string;
}

export function buildMovementsPrintHtml(
  movements: InventoryMovement[],
  settings: BusinessSettings,
  meta: MovementsPrintMeta
): string {
  const symbol = settings?.currencySymbol || 'TSh';
  const businessName = settings?.businessName || 'Inventory Control';
  const businessPhone = settings?.phone || '';
  const businessAddress = settings?.address || '';

  let totalAdded = 0;
  let totalDeducted = 0;
  let totalCostImpact = 0;

  for (const m of movements) {
    if (m.changeQty > 0) totalAdded += m.changeQty;
    else if (m.changeQty < 0) totalDeducted += Math.abs(m.changeQty);
    totalCostImpact += Number(m.costValue || 0);
  }

  const rowsHtml =
    movements.length === 0
      ? `<tr><td colspan="9" style="text-align:center; padding:24px; color:#64748b;">No stock movements found for this filter.</td></tr>`
      : movements
          .map((m, idx) => {
            const isPositive = m.changeQty > 0;
            const isLoss = ['DAMAGED', 'BROKEN', 'EXPIRED', 'LOST'].includes(m.type);
            const qtyText = isPositive ? `+${m.changeQty}` : String(m.changeQty);
            const qtyColor = isPositive ? '#047857' : '#be123c';
            const badgeBg = isLoss ? '#ffe4e6' : isPositive ? '#d1fae5' : '#e0e7ff';
            const badgeText = isLoss ? '#be123c' : isPositive ? '#047857' : '#3730a3';

            return `
              <tr>
                <td style="text-align:center; color:#64748b; font-family:'Courier New',monospace;">${idx + 1}</td>
                <td style="white-space:nowrap; font-size:10px; color:#334155;">${escapeHtml(formatDateTime(m.createdAt))}</td>
                <td>
                  <div style="font-weight:700; color:#0f172a;">${escapeHtml(m.productName)}</div>
                  ${m.reason ? `<div style="font-size:10px; color:#64748b; margin-top:2px;">${escapeHtml(m.reason)}</div>` : ''}
                </td>
                <td style="color:#334155;">${escapeHtml(m.shopName || 'Shop')}</td>
                <td style="text-align:center;">
                  <span style="display:inline-block; padding:2px 7px; border-radius:999px; font-size:9px; font-weight:800; background:${badgeBg}; color:${badgeText};">
                    ${escapeHtml(m.type)}
                  </span>
                </td>
                <td style="text-align:right; font-family:'Courier New',monospace; font-weight:800; color:${qtyColor};">
                  ${escapeHtml(qtyText)}
                </td>
                <td style="text-align:center; font-family:'Courier New',monospace; color:#475569; font-size:10px;">
                  ${m.previousQty} → ${m.newQty}
                </td>
                <td style="text-align:right; font-family:'Courier New',monospace; font-weight:700; color:${isLoss ? '#be123c' : '#0f172a'};">
                  ${escapeHtml(formatCurrency(m.costValue || 0, symbol))}
                </td>
                <td style="color:#475569; font-size:10px;">${escapeHtml(m.userName)}</td>
              </tr>
            `;
          })
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stock Movements Report - ${escapeHtml(businessName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      padding: 22px;
      font-size: 11px;
      line-height: 1.4;
    }
    .banner {
      background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #2563eb 100%);
      color: #ffffff;
      border-radius: 12px;
      padding: 18px 20px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .banner h1 { font-size: 19px; font-weight: 800; letter-spacing: 0.2px; }
    .banner .sub { font-size: 11px; color: #dbeafe; margin-top: 3px; }
    .banner .right { text-align: right; font-size: 10px; color: #e2e8f0; }
    .meta-strip {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .meta-box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .meta-box .lbl {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
    }
    .meta-box .val { font-size: 11px; font-weight: 700; color: #0f172a; margin-top: 2px; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .kpi {
      border-radius: 10px;
      padding: 10px 12px;
      color: #ffffff;
    }
    .kpi.c1 { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
    .kpi.c2 { background: linear-gradient(135deg, #059669, #047857); }
    .kpi.c3 { background: linear-gradient(135deg, #e11d48, #be123c); }
    .kpi.c4 { background: linear-gradient(135deg, #7c3aed, #5b21b6); }
    .kpi .k-lbl { font-size: 9px; text-transform: uppercase; opacity: 0.9; font-weight: 700; }
    .kpi .k-val { font-size: 15px; font-weight: 800; font-family: 'Courier New', monospace; margin-top: 4px; }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
    }
    thead th {
      background: #0f172a;
      color: #ffffff;
      padding: 8px 7px;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      text-align: left;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    tbody td {
      padding: 7px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: top;
    }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .footer {
      margin-top: 16px;
      padding-top: 10px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #64748b;
    }
    @media print {
      body { padding: 8px; }
      @page { margin: 10mm; size: A4 landscape; }
      tr { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="banner">
    <div>
      <h1>Stock Movements Report</h1>
      <div class="sub">${escapeHtml(businessName)}</div>
      ${businessAddress ? `<div class="sub">${escapeHtml(businessAddress)}</div>` : ''}
    </div>
    <div class="right">
      <div><strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString())}</div>
      ${businessPhone ? `<div><strong>Phone:</strong> ${escapeHtml(businessPhone)}</div>` : ''}
    </div>
  </div>

  <div class="meta-strip">
    <div class="meta-box">
      <div class="lbl">Period</div>
      <div class="val">${escapeHtml(meta.periodLabel)}</div>
    </div>
    <div class="meta-box">
      <div class="lbl">Movement Type</div>
      <div class="val">${escapeHtml(meta.typeLabel)}</div>
    </div>
    <div class="meta-box">
      <div class="lbl">Shop Scope</div>
      <div class="val">${escapeHtml(meta.shopLabel)}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi c1">
      <div class="k-lbl">Movements</div>
      <div class="k-val">${movements.length.toLocaleString()}</div>
    </div>
    <div class="kpi c2">
      <div class="k-lbl">Stock Added</div>
      <div class="k-val">+${totalAdded.toLocaleString()}</div>
    </div>
    <div class="kpi c3">
      <div class="k-lbl">Stock Deducted</div>
      <div class="k-val">-${totalDeducted.toLocaleString()}</div>
    </div>
    <div class="kpi c4">
      <div class="k-lbl">Cost Impact</div>
      <div class="k-val">${escapeHtml(formatCurrency(totalCostImpact, symbol))}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:30px; text-align:center;">#</th>
        <th>Date &amp; Time</th>
        <th>Product &amp; Reason</th>
        <th>Shop</th>
        <th style="text-align:center;">Type</th>
        <th style="text-align:right;">Qty</th>
        <th style="text-align:center;">Balance</th>
        <th style="text-align:right;">Cost Value</th>
        <th>Recorded By</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer">
    <span>${escapeHtml(businessName)} — Inventory Stock Movements (Transfers excluded)</span>
    <span>Total Rows: ${movements.length.toLocaleString()}</span>
  </div>
</body>
</html>`;
}

export function printMovementsReportPdf(
  movements: InventoryMovement[],
  settings: BusinessSettings,
  meta: MovementsPrintMeta
): Promise<boolean> {
  return downloadMovementsReportPdf(movements, settings, meta);
}

