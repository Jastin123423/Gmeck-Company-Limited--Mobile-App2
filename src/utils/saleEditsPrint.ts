import { BusinessSettings, Sale, SaleEditRequest, SaleItem } from '../types';
import { formatCurrency, formatDateTime } from './formatters';
import { downloadSaleEditsPdf } from './pdfExport';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SaleEditChangeLine {
  label: string;
  detail: string;
  kind: 'added' | 'removed' | 'modified' | 'total';
}

export interface FormattedSaleEdit {
  productNames: string[];
  sellerName: string;
  receiptNumber: string;
  shopName: string;
  changes: SaleEditChangeLine[];
}

interface NormalizedLine {
  key: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

function aggregateItems(items: SaleItem[] = []): Map<string, NormalizedLine> {
  const map = new Map<string, NormalizedLine>();
  for (const item of items) {
    const key = item.productId || item.productName;
    const existing = map.get(key);
    if (existing) {
      const nextQty = existing.quantity + (Number(item.quantity) || 0);
      const nextDiscount = existing.discount + (Number(item.discount) || 0);
      const nextTotal = existing.total + (Number(item.total) || 0);
      map.set(key, {
        ...existing,
        quantity: nextQty,
        unitPrice: Number(item.unitPrice) || existing.unitPrice,
        discount: nextDiscount,
        total: nextTotal,
      });
    } else {
      map.set(key, {
        key,
        productName: item.productName || 'Unknown Product',
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        discount: Number(item.discount) || 0,
        total: Number(item.total) || 0,
      });
    }
  }
  return map;
}

export function formatSaleEditDetails(
  request: SaleEditRequest,
  sale: Sale | undefined,
  currencySymbol: string
): FormattedSaleEdit {
  const origItems = request.originalValues?.items || [];
  const newItems = request.newValues?.items || [];

  const productNamesSet = new Set<string>();
  for (const item of origItems) {
    if (item.productName) productNamesSet.add(item.productName);
  }
  for (const item of newItems) {
    if (item.productName) productNamesSet.add(item.productName);
  }
  const productNames = Array.from(productNamesSet);

  const origMap = aggregateItems(origItems);
  const newMap = aggregateItems(newItems);
  const allKeys = Array.from(new Set([...origMap.keys(), ...newMap.keys()]));

  const changes: SaleEditChangeLine[] = [];

  for (const key of allKeys) {
    const origLine = origMap.get(key);
    const newLine = newMap.get(key);

    if ((!origLine || origLine.quantity <= 0) && newLine && newLine.quantity > 0) {
      changes.push({
        label: newLine.productName,
        detail: `Added ${newLine.quantity}x @ ${formatCurrency(newLine.unitPrice, currencySymbol)}`,
        kind: 'added',
      });
      continue;
    }

    if (origLine && origLine.quantity > 0 && (!newLine || newLine.quantity <= 0)) {
      changes.push({
        label: origLine.productName,
        detail: `Removed (${origLine.quantity}x @ ${formatCurrency(origLine.unitPrice, currencySymbol)})`,
        kind: 'removed',
      });
      continue;
    }

    if (origLine && newLine) {
      const parts: string[] = [];
      if (origLine.quantity !== newLine.quantity) {
        parts.push(`Qty: ${origLine.quantity} → ${newLine.quantity}`);
      }
      if (Math.abs(origLine.unitPrice - newLine.unitPrice) > 0.001) {
        parts.push(
          `Price: ${formatCurrency(origLine.unitPrice, currencySymbol)} → ${formatCurrency(newLine.unitPrice, currencySymbol)}`
        );
      }
      if (Math.abs(origLine.discount - newLine.discount) > 0.001) {
        parts.push(
          `Discount: ${formatCurrency(origLine.discount, currencySymbol)} → ${formatCurrency(newLine.discount, currencySymbol)}`
        );
      }
      if (parts.length > 0) {
        changes.push({
          label: newLine.productName || origLine.productName,
          detail: parts.join(' • '),
          kind: 'modified',
        });
      }
    }
  }

  const origTotal = Number(request.originalValues?.total || 0);
  const newTotal = Number(request.newValues?.total || 0);
  changes.push({
    label: 'Sale Total',
    detail: `${formatCurrency(origTotal, currencySymbol)} → ${formatCurrency(newTotal, currencySymbol)}`,
    kind: 'total',
  });

  const sellerName =
    sale?.sellerName && request.requestedByName && sale.sellerName !== request.requestedByName
      ? `${sale.sellerName} (Req: ${request.requestedByName})`
      : sale?.sellerName || request.requestedByName || 'Unknown Seller';

  const receiptNumber = sale?.receiptNumber || request.saleId.slice(0, 8);
  const shopName = sale?.shopName || 'Shop';

  return {
    productNames,
    sellerName,
    receiptNumber,
    shopName,
    changes,
  };
}

export interface SaleEditsPrintMeta {
  periodLabel: string;
  statusLabel: string;
  shopLabel: string;
}

export function buildSaleEditsPrintHtml(
  requests: SaleEditRequest[],
  salesById: Map<string, Sale>,
  settings: BusinessSettings,
  meta: SaleEditsPrintMeta
): string {
  const symbol = settings?.currencySymbol || 'TSh';
  const businessName = settings?.businessName || 'Sales Control';
  const businessPhone = settings?.phone || '';
  const businessAddress = settings?.address || '';

  const approvedCount = requests.filter(r => r.status === 'APPROVED').length;
  const rejectedCount = requests.filter(r => r.status === 'REJECTED').length;

  const rowsHtml =
    requests.length === 0
      ? `<tr><td colspan="7" style="text-align:center; padding:24px; color:#64748b;">No approved or rejected sale edits found for this filter.</td></tr>`
      : requests
          .map((req, idx) => {
            const sale = salesById.get(req.saleId);
            const details = formatSaleEditDetails(req, sale, symbol);
            const isApproved = req.status === 'APPROVED';
            const badgeBg = isApproved ? '#d1fae5' : '#ffe4e6';
            const badgeText = isApproved ? '#047857' : '#be123c';
            const dateStr = formatDateTime(req.reviewedAt || req.createdAt);

            const productsHtml =
              details.productNames.length > 0
                ? details.productNames
                    .map(
                      name =>
                        `<span style="display:inline-block; background:#eff6ff; color:#1e40af; border:1px solid #bfdbfe; border-radius:4px; padding:1px 6px; margin:1px 2px 1px 0; font-size:10px; font-weight:600;">${escapeHtml(name)}</span>`
                    )
                    .join('')
                : `<span style="color:#64748b;">-</span>`;

            const changesHtml = details.changes
              .map(c => {
                const color =
                  c.kind === 'added'
                    ? '#047857'
                    : c.kind === 'removed'
                      ? '#be123c'
                      : c.kind === 'total'
                        ? '#1e3a8a'
                        : '#0f172a';
                const weight = c.kind === 'total' ? '800' : '600';
                return `<div style="margin-bottom:2px; font-size:10px; color:${color}; font-weight:${weight};">
                  <span>${escapeHtml(c.label)}:</span> ${escapeHtml(c.detail)}
                </div>`;
              })
              .join('');

            return `
              <tr>
                <td style="text-align:center; color:#64748b; font-family:'Courier New',monospace;">${idx + 1}</td>
                <td style="white-space:nowrap; font-size:10px; color:#334155;">
                  <div>${escapeHtml(dateStr)}</div>
                  <div style="color:#64748b; font-family:'Courier New',monospace; margin-top:2px;">#${escapeHtml(details.receiptNumber)}</div>
                  <div style="color:#1d4ed8; font-weight:600; margin-top:1px;">${escapeHtml(details.shopName)}</div>
                </td>
                <td>${productsHtml}</td>
                <td style="font-weight:600; color:#0f172a;">
                  ${escapeHtml(details.sellerName)}
                  ${req.reviewedByName ? `<div style="font-size:9.5px; color:#64748b; font-weight:400; margin-top:2px;">Reviewed: ${escapeHtml(req.reviewedByName)}</div>` : ''}
                </td>
                <td style="text-align:center;">
                  <span style="display:inline-block; padding:2px 8px; border-radius:999px; font-size:9.5px; font-weight:800; background:${badgeBg}; color:${badgeText};">
                    ${escapeHtml(req.status)}
                  </span>
                </td>
                <td>${changesHtml}</td>
                <td style="color:#334155;">
                  <div>${escapeHtml(req.reason || 'No reason provided')}</div>
                  ${req.reviewNote ? `<div style="font-size:9.5px; color:#64748b; margin-top:2px;">Note: ${escapeHtml(req.reviewNote)}</div>` : ''}
                </td>
              </tr>
            `;
          })
          .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sale Edits History Report - ${escapeHtml(businessName)}</title>
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
      background: linear-gradient(135deg, #0f172a 0%, #4c1d95 55%, #2563eb 100%);
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
    .banner .sub { font-size: 11px; color: #e9d5ff; margin-top: 3px; }
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
      grid-template-columns: repeat(3, 1fr);
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
    .kpi.c1 { background: linear-gradient(135deg, #6d28d9, #4c1d95); }
    .kpi.c2 { background: linear-gradient(135deg, #059669, #047857); }
    .kpi.c3 { background: linear-gradient(135deg, #e11d48, #be123c); }
    .kpi .k-lbl { font-size: 9px; text-transform: uppercase; opacity: 0.9; font-weight: 700; }
    .kpi .k-val { font-size: 16px; font-weight: 800; font-family: 'Courier New', monospace; margin-top: 4px; }
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
      <h1>Sale Edits History (Approved &amp; Rejected)</h1>
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
      <div class="lbl">Status Filter</div>
      <div class="val">${escapeHtml(meta.statusLabel)}</div>
    </div>
    <div class="meta-box">
      <div class="lbl">Shop Scope</div>
      <div class="val">${escapeHtml(meta.shopLabel)}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi c1">
      <div class="k-lbl">Total Handled Edits</div>
      <div class="k-val">${requests.length.toLocaleString()}</div>
    </div>
    <div class="kpi c2">
      <div class="k-lbl">Approved</div>
      <div class="k-val">${approvedCount.toLocaleString()}</div>
    </div>
    <div class="kpi c3">
      <div class="k-lbl">Rejected</div>
      <div class="k-val">${rejectedCount.toLocaleString()}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:28px; text-align:center;">#</th>
        <th>Date &amp; Receipt</th>
        <th>Product Name(s)</th>
        <th>Seller Name</th>
        <th style="text-align:center;">Status</th>
        <th>Changes</th>
        <th>Reason</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer">
    <span>${escapeHtml(businessName)} — Sale Edits Audit Log</span>
    <span>Total Entries: ${requests.length.toLocaleString()}</span>
  </div>
</body>
</html>`;
}

export function printHtmlViaIframe(html: string): boolean {
  if (typeof document === 'undefined') return false;

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.visibility = 'hidden';
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    }, 1000);
  };

  try {
    const win = iframe.contentWindow;
    const doc = win?.document || iframe.contentDocument;
    if (!doc || !win) {
      cleanup();
      return false;
    }
    doc.open();
    doc.write(html);
    doc.close();

    win.addEventListener('afterprint', cleanup, { once: true });
    window.setTimeout(() => {
      try {
        win.focus();
        win.print();
      } finally {
        window.setTimeout(cleanup, 1500);
      }
    }, 120);
    return true;
  } catch {
    cleanup();
    return false;
  }
}

export function printSaleEditsReportPdf(
  requests: SaleEditRequest[],
  salesById: Map<string, Sale>,
  settings: BusinessSettings,
  meta: SaleEditsPrintMeta
): boolean {
  return downloadSaleEditsPdf(requests, salesById, settings, meta);
}

