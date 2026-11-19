import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BusinessSettings,
  InventoryMovement,
  Product,
  Sale,
  SaleEditRequest,
  Shop,
  StockTransfer,
} from '../types';
import { formatCurrency, formatDateTime } from './formatters';
import { formatSaleEditDetails, SaleEditsPrintMeta } from './saleEditsPrint';
import { MovementsPrintMeta } from './movementsPrint';
import { saveFileCrossPlatform } from './nativeDownload';

type RGB = [number, number, number];

const COLORS = {
  navy: [15, 23, 42] as RGB,
  blue: [37, 99, 235] as RGB,
  blueDark: [30, 58, 138] as RGB,
  violet: [109, 40, 217] as RGB,
  emerald: [5, 150, 105] as RGB,
  emeraldBg: [209, 250, 229] as RGB,
  rose: [225, 29, 72] as RGB,
  roseBg: [255, 228, 230] as RGB,
  amber: [217, 119, 6] as RGB,
  amberBg: [254, 243, 199] as RGB,
  slate900: [15, 23, 42] as RGB,
  slate700: [51, 65, 85] as RGB,
  slate500: [100, 116, 139] as RGB,
  slate200: [226, 232, 240] as RGB,
  slate100: [241, 245, 249] as RGB,
  slate50: [248, 250, 252] as RGB,
  white: [255, 255, 255] as RGB,
};

/**
 * Standard PDF Helvetica uses WinAnsi encoding; replace unsupported arrows/emojis
 * so every downloaded PDF renders crisp, readable text without garbled glyphs.
 */
export function pdfSafe(value: unknown): string {
  return String(value ?? '')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2022/g, '|')
    .replace(/\u00b7/g, '|')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFilename(name: string): string {
  const cleaned = pdfSafe(name)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return cleaned.endsWith('.pdf') ? cleaned : `${cleaned || 'document'}.pdf`;
}

export async function triggerPdfDownload(doc: jsPDF, rawFilename: string): Promise<boolean> {
  const filename = sanitizeFilename(rawFilename);
  try {
    const base64Data = doc.output('datauristring');
    const blob = doc.output('blob');
    const res = await saveFileCrossPlatform({
      fileName: filename,
      mimeType: 'application/pdf',
      blob,
      base64Data,
      openAfterSave: true,
    });
    return res.ok;
  } catch (err) {
    console.error('[pdfExport] PDF download failed:', err);
    return false;
  }
}

function getLastTableY(doc: jsPDF, fallbackY: number): number {
  const y = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
  return typeof y === 'number' ? y : fallbackY;
}

function drawBanner(
  doc: jsPDF,
  title: string,
  subtitle: string,
  rightLines: string[],
  bannerColor: RGB = COLORS.blueDark
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;
  const boxW = pageW - margin * 2;
  const boxH = 24;

  doc.setFillColor(...bannerColor);
  doc.roundedRect(margin, margin, boxW, boxH, 3, 3, 'F');

  doc.setTextColor(...COLORS.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(pdfSafe(title), margin + 5, margin + 9.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(219, 234, 254);
  doc.text(pdfSafe(subtitle), margin + 5, margin + 15.5);

  doc.setFontSize(7.5);
  doc.setTextColor(226, 232, 240);
  rightLines.slice(0, 3).forEach((line, idx) => {
    doc.text(pdfSafe(line), pageW - margin - 5, margin + 8 + idx * 5, { align: 'right' });
  });

  return margin + boxH + 5;
}

function drawKpiRow(
  doc: jsPDF,
  y: number,
  cards: { label: string; value: string; color: RGB }[]
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;
  const gap = 3.5;
  const cardW = (pageW - margin * 2 - gap * (cards.length - 1)) / cards.length;
  const cardH = 16;

  cards.forEach((card, i) => {
    const x = margin + i * (cardW + gap);
    doc.setFillColor(...card.color);
    doc.roundedRect(x, y, cardW, cardH, 2.5, 2.5, 'F');

    doc.setTextColor(241, 245, 249);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(pdfSafe(card.label).toUpperCase(), x + 3.5, y + 5.5);

    doc.setTextColor(...COLORS.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text(pdfSafe(card.value), x + 3.5, y + 12.2);
  });

  return y + cardH + 5;
}

function drawMetaStrip(
  doc: jsPDF,
  y: number,
  items: { label: string; value: string }[]
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 12;
  const gap = 3.5;
  const boxW = (pageW - margin * 2 - gap * (items.length - 1)) / items.length;
  const boxH = 13;

  items.forEach((item, i) => {
    const x = margin + i * (boxW + gap);
    doc.setFillColor(...COLORS.slate50);
    doc.setDrawColor(...COLORS.slate200);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, boxW, boxH, 2, 2, 'FD');

    doc.setTextColor(...COLORS.slate500);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.text(pdfSafe(item.label).toUpperCase(), x + 3, y + 4.8);

    doc.setTextColor(...COLORS.slate900);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(pdfSafe(item.value), x + 3, y + 10.2, { maxWidth: boxW - 6 });
  });

  return y + boxH + 4.5;
}

function applyPageFooters(doc: jsPDF, leftText: string) {
  const pageCount = doc.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setDrawColor(...COLORS.slate200);
    doc.setLineWidth(0.25);
    doc.line(12, pageH - 10, pageW - 12, pageH - 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.slate500);
    doc.text(pdfSafe(leftText), 12, pageH - 5.8);
    doc.text(`Page ${i} of ${pageCount}`, pageW - 12, pageH - 5.8, { align: 'right' });
  }
}

// =====================================================================
// 1. SALES REPORT PDF (AdminSales.tsx)
// =====================================================================
export function buildSalesReportPdfDoc(
  sales: Sale[],
  settings: BusinessSettings,
  meta: {
    shopLabel: string;
    startDate?: string;
    endDate?: string;
    totalRevenue: number;
    totalProfit: number;
  }
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Sales Control';

  let y = drawBanner(
    doc,
    'Sales & Transactions Report',
    `${biz}${settings?.tagline ? ` | ${settings.tagline}` : ''}`,
    [
      `Generated: ${new Date().toLocaleString()}`,
      settings?.phone ? `Phone: ${settings.phone}` : '',
      settings?.address || '',
    ].filter(Boolean),
    COLORS.blueDark
  );

  y = drawMetaStrip(doc, y, [
    { label: 'Scope', value: meta.shopLabel },
    {
      label: 'Period',
      value: `${meta.startDate || 'Beginning'} to ${meta.endDate || 'Present'}`,
    },
    { label: 'Transactions', value: `${sales.length} record(s)` },
  ]);

  y = drawKpiRow(doc, y, [
    {
      label: 'Completed Revenue',
      value: formatCurrency(meta.totalRevenue, symbol),
      color: COLORS.blue,
    },
    {
      label: 'Gross Profit',
      value: formatCurrency(meta.totalProfit, symbol),
      color: COLORS.emerald,
    },
    {
      label: 'Transactions',
      value: String(sales.length),
      color: COLORS.navy,
    },
  ]);

  const rows =
    sales.length === 0
      ? [['-', '-', '-', '-', 'No sales found for selected filter', '-', '-', '-', '-']]
      : sales.map(sale => [
          pdfSafe(sale.receiptNumber),
          pdfSafe(formatDateTime(sale.createdAt)),
          pdfSafe(sale.shopName || 'N/A'),
          pdfSafe(sale.sellerName),
          pdfSafe(
            (sale.items || []).map(i => `${i.quantity}x ${i.productName}`).join(', ')
          ),
          pdfSafe(sale.paymentMethod),
          pdfSafe(sale.status),
          pdfSafe(formatCurrency(sale.total, symbol)),
          pdfSafe(
            sale.status === 'COMPLETED'
              ? formatCurrency(sale.grossProfit, symbol)
              : formatCurrency(0, symbol)
          ),
        ]);

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    head: [
      ['Receipt #', 'Date & Time', 'Shop', 'Seller', 'Products Sold', 'Payment', 'Status', 'Total', 'Profit'],
    ],
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 2, textColor: COLORS.slate900, overflow: 'linebreak' },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      4: { cellWidth: 68 },
      6: { halign: 'center' },
      7: { halign: 'right', fontStyle: 'bold' },
      8: { halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
    },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 6) {
        const val = String(data.cell.raw || '');
        if (val === 'VOIDED') {
          data.cell.styles.textColor = COLORS.rose;
          data.cell.styles.fontStyle = 'bold';
        } else if (val === 'COMPLETED') {
          data.cell.styles.textColor = COLORS.emerald;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  applyPageFooters(doc, `${biz} - Sales Report (${meta.shopLabel})`);
  return doc;
}

export async function downloadSalesReportPdf(
  sales: Sale[],
  settings: BusinessSettings,
  meta: {
    shopLabel: string;
    startDate?: string;
    endDate?: string;
    totalRevenue: number;
    totalProfit: number;
  }
): Promise<boolean> {
  const doc = buildSalesReportPdfDoc(sales, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `sales_report_${meta.shopLabel}_${stamp}.pdf`);
}

// =====================================================================
// 2. SALE EDITS HISTORY PDF (AdminSales.tsx Edit List)
// =====================================================================
export function buildSaleEditsPdfDoc(
  requests: SaleEditRequest[],
  salesById: Map<string, Sale>,
  settings: BusinessSettings,
  meta: SaleEditsPrintMeta
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Sales Control';

  const approvedCount = requests.filter(r => r.status === 'APPROVED').length;
  const rejectedCount = requests.filter(r => r.status === 'REJECTED').length;

  let y = drawBanner(
    doc,
    'Sale Edits History (Approved & Rejected)',
    biz,
    [
      `Generated: ${new Date().toLocaleString()}`,
      settings?.phone ? `Phone: ${settings.phone}` : '',
    ].filter(Boolean),
    COLORS.violet
  );

  y = drawMetaStrip(doc, y, [
    { label: 'Period', value: meta.periodLabel },
    { label: 'Status Filter', value: meta.statusLabel },
    { label: 'Shop Scope', value: meta.shopLabel },
  ]);

  y = drawKpiRow(doc, y, [
    { label: 'Total Handled Edits', value: String(requests.length), color: COLORS.violet },
    { label: 'Approved', value: String(approvedCount), color: COLORS.emerald },
    { label: 'Rejected', value: String(rejectedCount), color: COLORS.rose },
  ]);

  const rows =
    requests.length === 0
      ? [['-', '-', 'No approved or rejected sale edits found.', '-', '-', '-', '-']]
      : requests.map((req, idx) => {
          const sale = salesById.get(req.saleId);
          const details = formatSaleEditDetails(req, sale, symbol);
          const dateStr = formatDateTime(req.reviewedAt || req.createdAt);
          const changesStr = details.changes.map(c => `${c.label}: ${c.detail}`).join('\n');
          const reasonStr = [
            req.reason || 'No reason provided',
            req.reviewNote ? `Admin Note: ${req.reviewNote}` : '',
          ]
            .filter(Boolean)
            .join('\n');

          return [
            String(idx + 1),
            pdfSafe(`#${details.receiptNumber}\n${dateStr}\n${details.shopName}`),
            pdfSafe(details.productNames.join(', ') || '-'),
            pdfSafe(
              `${details.sellerName}${req.reviewedByName ? `\nBy: ${req.reviewedByName}` : ''}`
            ),
            pdfSafe(req.status),
            pdfSafe(changesStr),
            pdfSafe(reasonStr),
          ];
        });

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    head: [['#', 'Receipt & Date', 'Product Name(s)', 'Seller Name', 'Status', 'Changes', 'Reason']],
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 2.2, textColor: COLORS.slate900, overflow: 'linebreak' },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 38 },
      2: { cellWidth: 44 },
      3: { cellWidth: 34 },
      4: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
      5: { cellWidth: 72 },
    },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 4) {
        const val = String(data.cell.raw || '');
        if (val === 'APPROVED') {
          data.cell.styles.textColor = COLORS.emerald;
          data.cell.styles.fillColor = COLORS.emeraldBg;
        } else if (val === 'REJECTED') {
          data.cell.styles.textColor = COLORS.rose;
          data.cell.styles.fillColor = COLORS.roseBg;
        }
      }
    },
  });

  applyPageFooters(doc, `${biz} - Sale Edits Audit Log`);
  return doc;
}

export async function downloadSaleEditsPdf(
  requests: SaleEditRequest[],
  salesById: Map<string, Sale>,
  settings: BusinessSettings,
  meta: SaleEditsPrintMeta
): Promise<boolean> {
  const doc = buildSaleEditsPdfDoc(requests, salesById, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `sale_edits_history_${stamp}.pdf`);
}

// =====================================================================
// 3. STOCK TRANSFER VOUCHER PDF (AdminStores.tsx)
// =====================================================================
export function buildTransferVoucherPdfDoc(
  transfer: StockTransfer,
  settings: BusinessSettings
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Stock Transfer';

  const items = transfer.items || [];
  const itemsSubtotal = items.reduce(
    (s, i) => s + Number(i.subtotal ?? i.quantity * i.unitPrice),
    0
  );
  const shippingCharges = Math.max(0, Number(transfer.shippingCharges) || 0);
  const grandTotal =
    typeof transfer.totalAmount === 'number' && transfer.totalAmount > 0
      ? transfer.totalAmount
      : itemsSubtotal + shippingCharges;
  const totalQty =
    typeof transfer.totalUnits === 'number' && transfer.totalUnits > 0
      ? transfer.totalUnits
      : items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const isCompleted = transfer.status === 'COMPLETED';
  const transferDateStr = transfer.transferDate || transfer.createdAt.slice(0, 10);

  const sourceLoc =
    transfer.sourceLocation || transfer.sourceShopName || (transfer.sourceType === 'STORE' ? 'Store' : 'Shop');
  const destLoc =
    transfer.destLocation || transfer.destShopName || (transfer.destType === 'STORE' ? 'Store' : 'Shop');

  let y = drawBanner(
    doc,
    'STOCK TRANSFER VOUCHER',
    `${biz}${settings?.address ? ` | ${settings.address}` : ''}`,
    [
      `Ref: ${transfer.transferNumber}`,
      `Date: ${transferDateStr}`,
      `Status: ${isCompleted ? 'COMPLETED' : 'NOT COMPLETE'}`,
    ],
    isCompleted ? COLORS.blueDark : COLORS.amber
  );

  y = drawMetaStrip(doc, y, [
    {
      label: `Location From (${transfer.sourceType})`,
      value: `${transfer.sourceName}${sourceLoc && sourceLoc !== transfer.sourceName ? ` - ${sourceLoc}` : ''}`,
    },
    {
      label: `Location To (${transfer.destType})`,
      value: `${transfer.destName}${destLoc && destLoc !== transfer.destName ? ` - ${destLoc}` : ''}`,
    },
    {
      label: 'Prepared By',
      value: transfer.createdByName || 'Admin',
    },
  ]);

  y = drawKpiRow(doc, y, [
    { label: 'Line Items', value: `${items.length} product(s)`, color: COLORS.navy },
    { label: 'Total Quantity', value: `${totalQty.toLocaleString()} units`, color: COLORS.blue },
    {
      label: 'Shipping Charges',
      value: formatCurrency(shippingCharges, symbol),
      color: COLORS.violet,
    },
    {
      label: 'Grand Total',
      value: formatCurrency(grandTotal, symbol),
      color: isCompleted ? COLORS.emerald : COLORS.amber,
    },
  ]);

  const rows =
    items.length === 0
      ? [['-', 'No products recorded', '-', '-', '-']]
      : items.map((item, idx) => {
          const lineSub = Number(item.subtotal ?? item.quantity * item.unitPrice);
          const nameLabel = `${item.productName}${item.variation ? ` (${item.variation})` : ''}${item.sku ? ` [${item.sku}]` : ''}`;
          return [
            String(idx + 1),
            pdfSafe(nameLabel),
            pdfSafe(`${item.quantity} ${item.unit || 'pcs'}`),
            pdfSafe(formatCurrency(item.unitPrice || 0, symbol)),
            pdfSafe(formatCurrency(lineSub, symbol)),
          ];
        });

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 20 },
    head: [['#', 'Product Name & SKU', 'Quantity', 'Unit Price', 'Subtotal']],
    body: rows,
    styles: { fontSize: 8.5, cellPadding: 2.5, textColor: COLORS.slate900 },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      2: { cellWidth: 28, halign: 'center', fontStyle: 'bold' },
      3: { cellWidth: 34, halign: 'right' },
      4: { cellWidth: 36, halign: 'right', fontStyle: 'bold' },
    },
  });

  let afterY = getLastTableY(doc, y + 30) + 6;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  if (afterY > pageH - 55) {
    doc.addPage();
    afterY = 18;
  }

  // Notice + Summary Box
  if (transfer.notice) {
    doc.setFillColor(...COLORS.amberBg);
    doc.setDrawColor(...COLORS.amber);
    doc.roundedRect(12, afterY, 102, 22, 2, 2, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.amber);
    doc.text('NOTICE / REMARKS', 15, afterY + 5.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.slate900);
    doc.text(pdfSafe(transfer.notice), 15, afterY + 11, { maxWidth: 96 });
  }

  const sumX = pageW - 12 - 76;
  doc.setFillColor(...COLORS.slate50);
  doc.setDrawColor(...COLORS.slate200);
  doc.roundedRect(sumX, afterY, 76, 26, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.slate700);
  doc.text('Products Subtotal:', sumX + 4, afterY + 6.5);
  doc.text(pdfSafe(formatCurrency(itemsSubtotal, symbol)), sumX + 72, afterY + 6.5, {
    align: 'right',
  });

  doc.text('Shipping Charges:', sumX + 4, afterY + 13);
  doc.text(pdfSafe(formatCurrency(shippingCharges, symbol)), sumX + 72, afterY + 13, {
    align: 'right',
  });

  doc.setFillColor(...COLORS.navy);
  doc.roundedRect(sumX + 2, afterY + 16.5, 72, 8, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.white);
  doc.text('TOTAL:', sumX + 5, afterY + 21.8);
  doc.text(pdfSafe(formatCurrency(grandTotal, symbol)), sumX + 71, afterY + 21.8, {
    align: 'right',
  });

  // Signature lines
  const sigY = afterY + 42;
  doc.setDrawColor(...COLORS.slate500);
  doc.setLineWidth(0.3);
  doc.line(12, sigY, 92, sigY);
  doc.line(pageW - 92, sigY, pageW - 12, sigY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.slate500);
  doc.text(pdfSafe(`Dispatched By (${transfer.createdByName || 'Admin'})`), 12, sigY + 4.5);
  doc.text('Received & Checked By (Signature & Date)', pageW - 92, sigY + 4.5);

  applyPageFooters(doc, `${biz} - Stock Transfer Voucher (${transfer.transferNumber})`);
  return doc;
}

export async function downloadTransferVoucherPdf(
  transfer: StockTransfer,
  settings: BusinessSettings
): Promise<boolean> {
  const doc = buildTransferVoucherPdfDoc(transfer, settings);
  return triggerPdfDownload(doc, `stock_transfer_${transfer.transferNumber}.pdf`);
}

// =====================================================================
// 4. STOCK MOVEMENTS REPORT PDF (AdminInventory.tsx)
// =====================================================================
export function buildMovementsPdfDoc(
  movements: InventoryMovement[],
  settings: BusinessSettings,
  meta: MovementsPrintMeta
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Inventory Control';

  let totalAdded = 0;
  let totalDeducted = 0;
  let totalCostImpact = 0;
  for (const m of movements) {
    if (m.changeQty > 0) totalAdded += m.changeQty;
    else if (m.changeQty < 0) totalDeducted += Math.abs(m.changeQty);
    totalCostImpact += Number(m.costValue || 0);
  }

  let y = drawBanner(
    doc,
    'Stock Movements Report',
    `${biz} (Transfers Excluded)`,
    [
      `Generated: ${new Date().toLocaleString()}`,
      settings?.phone ? `Phone: ${settings.phone}` : '',
    ].filter(Boolean),
    COLORS.blueDark
  );

  y = drawMetaStrip(doc, y, [
    { label: 'Period', value: meta.periodLabel },
    { label: 'Movement Type', value: meta.typeLabel },
    { label: 'Shop Scope', value: meta.shopLabel },
  ]);

  y = drawKpiRow(doc, y, [
    { label: 'Movements', value: movements.length.toLocaleString(), color: COLORS.blue },
    { label: 'Stock Added', value: `+${totalAdded.toLocaleString()}`, color: COLORS.emerald },
    { label: 'Stock Deducted', value: `-${totalDeducted.toLocaleString()}`, color: COLORS.rose },
    { label: 'Cost Impact', value: formatCurrency(totalCostImpact, symbol), color: COLORS.violet },
  ]);

  const rows =
    movements.length === 0
      ? [['-', '-', 'No stock movements found for this filter.', '-', '-', '-', '-', '-', '-']]
      : movements.map((m, idx) => [
          String(idx + 1),
          pdfSafe(formatDateTime(m.createdAt)),
          pdfSafe(`${m.productName}${m.reason ? `\n${m.reason}` : ''}`),
          pdfSafe(m.shopName || 'Shop'),
          pdfSafe(m.type),
          pdfSafe(m.changeQty > 0 ? `+${m.changeQty}` : String(m.changeQty)),
          pdfSafe(`${m.previousQty} -> ${m.newQty}`),
          pdfSafe(formatCurrency(m.costValue || 0, symbol)),
          pdfSafe(m.userName),
        ]);

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    head: [['#', 'Date & Time', 'Product & Reason', 'Shop', 'Type', 'Qty', 'Balance', 'Cost Value', 'Recorded By']],
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 2, textColor: COLORS.slate900, overflow: 'linebreak' },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      4: { halign: 'center', fontStyle: 'bold' },
      5: { halign: 'right', fontStyle: 'bold' },
      6: { halign: 'center' },
      7: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 5) {
        const txt = String(data.cell.raw || '');
        data.cell.styles.textColor = txt.startsWith('+') ? COLORS.emerald : COLORS.rose;
      }
    },
  });

  applyPageFooters(doc, `${biz} - Stock Movements Report`);
  return doc;
}

export async function downloadMovementsReportPdf(
  movements: InventoryMovement[],
  settings: BusinessSettings,
  meta: MovementsPrintMeta
): Promise<boolean> {
  const doc = buildMovementsPdfDoc(movements, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `stock_movements_${stamp}.pdf`);
}

// =====================================================================
// 5. LOW STOCK REPORT PDF (AdminInventory.tsx)
// =====================================================================
export async function downloadLowStockReportPdf(
  lowStockProducts: Product[],
  shops: Shop[],
  settings: BusinessSettings,
  scopeLabel: string
): Promise<boolean> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Inventory Control';

  const totalUnitsNeeded = lowStockProducts.reduce(
    (sum, p) => sum + Math.max(0, p.minStock - p.currentStock),
    0
  );
  const estimatedRestockCost = lowStockProducts.reduce(
    (sum, p) => sum + Math.max(0, p.minStock - p.currentStock) * p.purchasePrice,
    0
  );

  let y = drawBanner(
    doc,
    'Low Stock & Restock Report',
    `${biz} | ${scopeLabel}`,
    [`Generated: ${new Date().toLocaleString()}`],
    COLORS.amber
  );

  y = drawKpiRow(doc, y, [
    { label: 'Low Stock Items', value: String(lowStockProducts.length), color: COLORS.amber },
    { label: 'Units To Restock', value: totalUnitsNeeded.toLocaleString(), color: COLORS.violet },
    {
      label: 'Est. Restock Cost',
      value: formatCurrency(estimatedRestockCost, symbol),
      color: COLORS.rose,
    },
  ]);

  const shopNameMap = new Map(shops.map(s => [s.id, s.name]));
  const rows =
    lowStockProducts.length === 0
      ? [['-', 'All stock levels are healthy.', '-', '-', '-', '-', '-', '-']]
      : lowStockProducts.map(p => {
          const needed = Math.max(0, p.minStock - p.currentStock);
          const restockCost = needed * p.purchasePrice;
          return [
            pdfSafe(shopNameMap.get(p.shopId || '') || 'Shop'),
            pdfSafe(`${p.name}\n${p.sku || ''}`),
            pdfSafe(`${p.currentStock} ${p.unit || ''}`),
            pdfSafe(`${p.minStock} ${p.unit || ''}`),
            String(needed),
            pdfSafe(formatCurrency(p.purchasePrice, symbol)),
            pdfSafe(formatCurrency(restockCost, symbol)),
            p.currentStock <= 0 ? 'OUT' : 'LOW',
          ];
        });

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    head: [['Shop', 'Product & SKU', 'Stock', 'Min', 'Needed', 'Cost/Unit', 'Restock Cost', 'Status']],
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 2, textColor: COLORS.slate900 },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      2: { halign: 'center', textColor: COLORS.rose, fontStyle: 'bold' },
      3: { halign: 'center' },
      4: { halign: 'center', fontStyle: 'bold', textColor: COLORS.amber },
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold', textColor: COLORS.rose },
      7: { halign: 'center', fontStyle: 'bold' },
    },
  });

  applyPageFooters(doc, `${biz} - Low Stock Report`);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `low_stock_report_${stamp}.pdf`);
}

// =====================================================================
// 6. STOCK LOSS REPORT PDF (AdminInventory.tsx)
// =====================================================================
export async function downloadLossReportPdf(
  losses: InventoryMovement[],
  settings: BusinessSettings,
  meta: { periodLabel: string; totalLossValue: number; totalLossUnits: number }
): Promise<boolean> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Inventory Control';

  let y = drawBanner(
    doc,
    'Stock Loss & Shrinkage Report',
    `${biz} | Period: ${meta.periodLabel}`,
    [`Generated: ${new Date().toLocaleString()}`],
    COLORS.rose
  );

  y = drawKpiRow(doc, y, [
    {
      label: 'Total Loss Value',
      value: formatCurrency(meta.totalLossValue, symbol),
      color: COLORS.rose,
    },
    { label: 'Total Units Lost', value: meta.totalLossUnits.toLocaleString(), color: COLORS.amber },
    { label: 'Loss Records', value: String(losses.length), color: COLORS.violet },
  ]);

  const rows =
    losses.length === 0
      ? [['-', 'No loss records found.', '-', '-', '-', '-', '-']]
      : losses.map(m => [
          pdfSafe(formatDateTime(m.createdAt)),
          pdfSafe(m.productName),
          pdfSafe(m.type),
          String(Math.abs(m.changeQty)),
          pdfSafe(formatCurrency(m.costValue || 0, symbol)),
          pdfSafe(m.reason),
          pdfSafe(m.userName),
        ]);

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    head: [['Date', 'Product', 'Type', 'Qty Lost', 'Loss Value', 'Reason', 'Recorded By']],
    body: rows,
    styles: { fontSize: 8, cellPadding: 2.2, textColor: COLORS.slate900 },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [254, 242, 242] },
    columnStyles: {
      2: { halign: 'center', textColor: COLORS.rose, fontStyle: 'bold' },
      3: { halign: 'right', fontStyle: 'bold' },
      4: { halign: 'right', fontStyle: 'bold', textColor: COLORS.rose },
    },
  });

  applyPageFooters(doc, `${biz} - Stock Loss Report`);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `stock_loss_report_${stamp}.pdf`);
}

// =====================================================================
// 7. FINANCIAL REPORT PDF (AdminReports.tsx)
// =====================================================================
export async function downloadFinancialReportPdf(
  incomeSummary: any,
  settings: BusinessSettings,
  meta: { shopLabel: string; from?: string; to?: string }
): Promise<boolean> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Financial Report';
  const s = incomeSummary || {};

  let y = drawBanner(
    doc,
    'Financial Performance Report',
    `${biz} | ${meta.shopLabel}`,
    [
      `Period: ${meta.from || 'Beginning'} to ${meta.to || 'Present'}`,
      `Generated: ${new Date().toLocaleString()}`,
    ],
    COLORS.blueDark
  );

  y = drawKpiRow(doc, y, [
    { label: 'Gross Revenue', value: formatCurrency(s.totalGrossSales || 0, symbol), color: COLORS.blue },
    { label: 'Gross Profit', value: formatCurrency(s.totalGrossProfit || 0, symbol), color: COLORS.emerald },
    { label: 'Expenses', value: formatCurrency(s.totalExpenses || 0, symbol), color: COLORS.rose },
    {
      label: 'Net Profit',
      value: formatCurrency(s.netProfit || 0, symbol),
      color: (s.netProfit || 0) >= 0 ? COLORS.emerald : COLORS.rose,
    },
  ]);

  // Income Statement
  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    head: [['Income Statement Line', 'Amount']],
    body: [
      ['Gross Revenue', pdfSafe(formatCurrency(s.totalGrossSales || 0, symbol))],
      ['Less: Cost of Goods Sold (COGS)', pdfSafe(`-${formatCurrency(s.totalCostOfGoods || 0, symbol)}`)],
      [
        `Gross Profit (${s.profitMarginPercent || 0}%)`,
        pdfSafe(formatCurrency(s.totalGrossProfit || 0, symbol)),
      ],
      ['Less: Operating Expenses', pdfSafe(`-${formatCurrency(s.totalExpenses || 0, symbol)}`)],
      [
        `NET PROFIT (${s.netMarginPercent || 0}%)`,
        pdfSafe(formatCurrency(s.netProfit || 0, symbol)),
      ],
    ],
    styles: { fontSize: 8.5, cellPadding: 2.4 },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
  });

  // Shop Performance
  const shopRows = (s.shopSalesBreakdown || []).map((sh: any) => [
    pdfSafe(sh.name),
    String(sh.salesCount || 0),
    pdfSafe(formatCurrency(sh.totalSales || 0, symbol)),
    pdfSafe(formatCurrency(sh.grossProfit || 0, symbol)),
  ]);
  if (shopRows.length > 0) {
    autoTable(doc, {
      startY: getLastTableY(doc, y + 40) + 6,
      margin: { left: 12, right: 12, bottom: 15 },
      head: [['Shop Performance', 'Sales', 'Revenue', 'Gross Profit']],
      body: shopRows,
      styles: { fontSize: 8, cellPadding: 2.2 },
      headStyles: { fillColor: COLORS.blueDark, textColor: COLORS.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right', fontStyle: 'bold' },
        3: { halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
      },
    });
  }

  // Product Profitability
  const prodRows = (s.topProducts || []).map((p: any) => [
    pdfSafe(p.name),
    pdfSafe(p.sku),
    String(p.unitsSold || 0),
    pdfSafe(formatCurrency(p.revenue || 0, symbol)),
    pdfSafe(formatCurrency(p.profit || 0, symbol)),
  ]);
  if (prodRows.length > 0) {
    autoTable(doc, {
      startY: getLastTableY(doc, y + 70) + 6,
      margin: { left: 12, right: 12, bottom: 15 },
      head: [['Top Products', 'SKU', 'Units', 'Revenue', 'Profit']],
      body: prodRows,
      styles: { fontSize: 8, cellPadding: 2.2 },
      headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right', fontStyle: 'bold' },
        4: { halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
      },
    });
  }

  // Seller Performance
  const sellerRows = (s.sellerSales || []).map((se: any) => [
    pdfSafe(se.name),
    String(se.count || 0),
    pdfSafe(formatCurrency(se.total || 0, symbol)),
    pdfSafe(formatCurrency(se.profit || 0, symbol)),
  ]);
  if (sellerRows.length > 0) {
    autoTable(doc, {
      startY: getLastTableY(doc, y + 100) + 6,
      margin: { left: 12, right: 12, bottom: 15 },
      head: [['Seller Performance', 'Orders', 'Revenue', 'Profit']],
      body: sellerRows,
      styles: { fontSize: 8, cellPadding: 2.2 },
      headStyles: { fillColor: COLORS.violet, textColor: COLORS.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right', fontStyle: 'bold' },
        3: { halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
      },
    });
  }

  applyPageFooters(doc, `${biz} - Financial Report (${meta.shopLabel})`);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `financial_report_${meta.shopLabel}_${stamp}.pdf`);
}

// =====================================================================
// 8. SHOP PROFIT & LOSS PDF (AdminReports.tsx)
// =====================================================================
export async function downloadShopProfitLossPdf(
  rows: any[],
  totals: any,
  generalCompanyExpenses: number,
  settings: BusinessSettings,
  meta: { from?: string; to?: string; periodLabel: string }
): Promise<boolean> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Business';

  let y = drawBanner(
    doc,
    'Shop Profit & Loss Statement',
    `${biz} | Period: ${meta.from || 'Beginning'} to ${meta.to || 'Present'}`,
    [`Generated: ${new Date().toLocaleString()}`],
    COLORS.blueDark
  );

  y = drawKpiRow(doc, y, [
    {
      label: 'Product Total Capital',
      value: formatCurrency(totals.totalCapital || 0, symbol),
      color: COLORS.violet,
    },
    {
      label: 'Gross Revenue',
      value: formatCurrency(totals.revenue || 0, symbol),
      color: COLORS.blue,
    },
    {
      label: 'Expenses & Stock Loss',
      value: `-${formatCurrency(totals.totalLossAndExpenses || 0, symbol)}`,
      color: COLORS.rose,
    },
    {
      label: 'Net Profit / (Loss)',
      value: formatCurrency(totals.netProfit || 0, symbol),
      color: (totals.netProfit || 0) >= 0 ? COLORS.emerald : COLORS.rose,
    },
  ]);

  const body = rows.map(r => [
    pdfSafe(`${r.shopName}\n${r.skuCount} SKUs | ${Number(r.totalUnits || 0).toLocaleString()} units`),
    pdfSafe(formatCurrency(r.totalCapital || 0, symbol)),
    pdfSafe(formatCurrency(r.revenue || 0, symbol)),
    pdfSafe(formatCurrency(r.grossProfit || 0, symbol)),
    pdfSafe(`-${formatCurrency(r.expenses || 0, symbol)}`),
    pdfSafe(`-${formatCurrency(r.stockLossValue || 0, symbol)}`),
    pdfSafe(`${(r.netProfit || 0) >= 0 ? '+' : ''}${formatCurrency(r.netProfit || 0, symbol)}`),
  ]);

  const foot = [
    [
      `TOTAL (${rows.length} shops)`,
      pdfSafe(formatCurrency(totals.totalCapital || 0, symbol)),
      pdfSafe(formatCurrency(totals.revenue || 0, symbol)),
      pdfSafe(formatCurrency(totals.grossProfit || 0, symbol)),
      pdfSafe(`-${formatCurrency(totals.expenses || 0, symbol)}`),
      pdfSafe(`-${formatCurrency(totals.stockLossValue || 0, symbol)}`),
      pdfSafe(`${(totals.netProfit || 0) >= 0 ? '+' : ''}${formatCurrency(totals.netProfit || 0, symbol)}`),
    ],
  ];

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 18 },
    head: [['Shop', 'Product Capital', 'Revenue', 'Gross Profit', 'Expenses', 'Stock Loss', 'Net Profit / Loss']],
    body,
    foot,
    styles: { fontSize: 8, cellPadding: 2.3, textColor: COLORS.slate900 },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    footStyles: { fillColor: [239, 246, 255], textColor: COLORS.blueDark, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right', textColor: COLORS.emerald, fontStyle: 'bold' },
      4: { halign: 'right', textColor: COLORS.rose },
      5: { halign: 'right', textColor: COLORS.rose },
      6: { halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 6) {
        const txt = String(data.cell.raw || '');
        data.cell.styles.textColor = txt.startsWith('+') ? COLORS.emerald : COLORS.rose;
      }
    },
  });

  if (generalCompanyExpenses > 0) {
    const afterY = getLastTableY(doc, y + 40) + 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.amber);
    doc.text(
      pdfSafe(
        `Unallocated Company Expenses: -${formatCurrency(generalCompanyExpenses, symbol)} | Net After Company Expenses: ${formatCurrency(totals.netAfterCompanyExpenses || 0, symbol)}`
      ),
      12,
      afterY
    );
  }

  applyPageFooters(doc, `${biz} - Shop Profit & Loss Statement`);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `shop_profit_loss_${meta.periodLabel}_${stamp}.pdf`);
}

// =====================================================================
// 9. PRICE DEVIATIONS AUDIT PDF (AdminReports.tsx)
// =====================================================================
export async function downloadPriceDeviationsPdf(
  deviations: any[],
  stats: { belowCount: number; belowCostCount: number; aboveCount: number },
  settings: BusinessSettings,
  meta: { shopLabel: string; from?: string; to?: string; direction: string }
): Promise<boolean> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Price Audit';

  let y = drawBanner(
    doc,
    'Price Deviation Audit Report',
    `${biz} | ${meta.shopLabel} | Direction: ${meta.direction}`,
    [
      `Period: ${meta.from || 'Beginning'} to ${meta.to || 'Present'}`,
      `Generated: ${new Date().toLocaleString()}`,
    ],
    COLORS.rose
  );

  y = drawKpiRow(doc, y, [
    { label: 'Below Reference', value: String(stats.belowCount), color: COLORS.rose },
    { label: 'Below Cost (Loss)', value: String(stats.belowCostCount), color: COLORS.amber },
    { label: 'Above Reference', value: String(stats.aboveCount), color: COLORS.emerald },
  ]);

  const rows = deviations.map(d => [
    pdfSafe(formatDateTime(d.createdAt)),
    pdfSafe(d.receiptNumber),
    pdfSafe(d.shopName),
    pdfSafe(d.sellerDisplayName || d.sellerName),
    pdfSafe(`${d.productName}${d.belowCost ? ' [LOSS]' : ''}`),
    pdfSafe(d.referencePrice > 0 ? formatCurrency(d.referencePrice, symbol) : '-'),
    pdfSafe(formatCurrency(d.soldPrice, symbol)),
    pdfSafe(
      d.referencePrice > 0 ? `${d.diff > 0 ? '+' : ''}${formatCurrency(d.diff, symbol)}` : '-'
    ),
    String(d.quantity),
    pdfSafe(
      d.referencePrice > 0
        ? `${d.totalImpact > 0 ? '+' : ''}${formatCurrency(d.totalImpact, symbol)}`
        : '-'
    ),
  ]);

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    head: [
      ['Date', 'Receipt', 'Shop', 'Seller', 'Product', 'Ref Price', 'Sold At', 'Diff', 'Qty', 'Impact'],
    ],
    body: rows,
    styles: { fontSize: 7.2, cellPadding: 2, textColor: COLORS.slate900 },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      5: { halign: 'right' },
      6: { halign: 'right', fontStyle: 'bold' },
      7: { halign: 'right', fontStyle: 'bold' },
      8: { halign: 'right' },
      9: { halign: 'right', fontStyle: 'bold' },
    },
  });

  applyPageFooters(doc, `${biz} - Price Deviation Audit`);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `price_deviations_${meta.shopLabel}_${stamp}.pdf`);
}

// =====================================================================
// 10. POS COMMERCIAL RECEIPT PDF (ReceiptModal.tsx)
// =====================================================================
export async function downloadReceiptPdf(
  sale: Sale,
  settings: BusinessSettings
): Promise<boolean> {
  const itemCount = (sale.items || []).length;
  const estimatedHeight = Math.max(150, 105 + itemCount * 9);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [88, estimatedHeight] });
  const symbol = settings?.currencySymbol || 'TSh';
  const pageW = doc.internal.pageSize.getWidth();
  const center = pageW / 2;

  let y = 9;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.navy);
  doc.text(pdfSafe(settings?.businessName || 'POS RECEIPT').toUpperCase(), center, y, {
    align: 'center',
    maxWidth: 78,
  });
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.slate700);
  if (settings?.tagline) {
    doc.text(pdfSafe(settings.tagline), center, y, { align: 'center', maxWidth: 78 });
    y += 3.8;
  }
  if (settings?.address) {
    doc.text(pdfSafe(settings.address), center, y, { align: 'center', maxWidth: 78 });
    y += 3.8;
  }
  if (settings?.phone) {
    doc.text(pdfSafe(`Tel: ${settings.phone}`), center, y, { align: 'center' });
    y += 4.2;
  }

  doc.setDrawColor(...COLORS.slate200);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(5, y, pageW - 5, y);
  doc.setLineDashPattern([], 0);
  y += 4.5;

  const metaLines: [string, string][] = [
    ['Receipt #:', sale.receiptNumber],
    ['Date:', formatDateTime(sale.createdAt)],
    ['Shop:', sale.shopName || 'Shop'],
    ['Seller:', sale.sellerName],
    ['Status:', sale.status],
  ];
  doc.setFontSize(7.5);
  for (const [lbl, val] of metaLines) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.slate500);
    doc.text(lbl, 6, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(
      ...(lbl === 'Status:' && sale.status === 'VOIDED' ? COLORS.rose : COLORS.slate900)
    );
    doc.text(pdfSafe(val), pageW - 6, y, { align: 'right' });
    y += 4;
  }

  autoTable(doc, {
    startY: y + 1,
    margin: { left: 5, right: 5, bottom: 10 },
    head: [['Item', 'Qty', 'Price', 'Total']],
    body: (sale.items || []).map(item => [
      pdfSafe(item.productName),
      String(item.quantity),
      pdfSafe(formatCurrency(item.unitPrice, symbol)),
      pdfSafe(formatCurrency(item.total, symbol)),
    ]),
    styles: { fontSize: 7, cellPadding: 1.3, textColor: COLORS.slate900 },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    columnStyles: {
      1: { halign: 'center', cellWidth: 10 },
      2: { halign: 'right', cellWidth: 18 },
      3: { halign: 'right', cellWidth: 20, fontStyle: 'bold' },
    },
  });

  let afterY = getLastTableY(doc, y + 25) + 5;
  const totalsLines: [string, string, boolean][] = [
    ['Subtotal', formatCurrency(sale.subtotal, symbol), false],
    ...(sale.discount > 0
      ? ([['Discount', `-${formatCurrency(sale.discount, symbol)}`, false]] as [
          string,
          string,
          boolean,
        ][])
      : []),
    ['TOTAL DUE', formatCurrency(sale.total, symbol), true],
    ['Payment', sale.paymentMethod, false],
    ['Tendered', formatCurrency(sale.amountReceived, symbol), false],
    ['Change', formatCurrency(sale.change, symbol), false],
  ];

  for (const [lbl, val, bold] of totalsLines) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(bold ? 9 : 7.5);
    doc.setTextColor(...(bold ? COLORS.navy : COLORS.slate700));
    doc.text(lbl, 6, afterY);
    doc.text(pdfSafe(val), pageW - 6, afterY, { align: 'right' });
    afterY += bold ? 5.2 : 4;
  }

  afterY += 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.slate500);
  if (settings?.receiptHeaderNote) {
    doc.text(pdfSafe(settings.receiptHeaderNote), center, afterY, { align: 'center', maxWidth: 76 });
    afterY += 4;
  }
  if (settings?.receiptFooterNote) {
    doc.text(pdfSafe(settings.receiptFooterNote), center, afterY, { align: 'center', maxWidth: 76 });
    afterY += 4;
  }
  doc.setFont('helvetica', 'bold');
  doc.text('*** THANK YOU FOR YOUR BUSINESS ***', center, afterY + 1, { align: 'center' });

  return triggerPdfDownload(doc, `receipt_${sale.receiptNumber}.pdf`);
}
