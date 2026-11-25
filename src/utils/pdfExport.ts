import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  BusinessSettings,
  InventoryMovement,
  Product,
  Purchase,
  Sale,
  SaleEditRequest,
  Shop,
  StockTransfer,
} from '../types';
import { formatCurrency, formatDateTime } from './formatters';
import { formatSaleEditDetails, SaleEditsPrintMeta } from './saleEditsPrint';
import { MovementsPrintMeta } from './movementsPrint';
import { saveFileCrossPlatform } from './nativeDownload';
import {
  printPdfCrossPlatform,
  PrintOrientation,
  PrintPaperSize,
  PrintPdfResult,
} from './nativePrint';

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

function pdfSafeMultiline(lines: unknown[]): string {
  return lines
    .map(line => pdfSafe(line))
    .filter(Boolean)
    .join('\n');
}

function formatQtyCompact(qty: number): string {
  if (!Number.isFinite(qty)) return '0';
  return Number.isInteger(qty) ? String(qty) : Number(qty.toFixed(3)).toString();
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

export async function triggerPdfPrint(
  doc: jsPDF,
  jobName: string,
  rawFilename: string,
  options?: {
    orientation?: PrintOrientation;
    paperSize?: PrintPaperSize;
  }
): Promise<PrintPdfResult> {
  const filename = sanitizeFilename(rawFilename);
  try {
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const inferredOrientation: PrintOrientation =
      options?.orientation || (pageW > pageH ? 'landscape' : 'portrait');
    const paperSize: PrintPaperSize = options?.paperSize || 'a4';

    const base64Data = doc.output('datauristring');
    const blob = doc.output('blob');
    return await printPdfCrossPlatform({
      jobName: pdfSafe(jobName) || 'Document',
      fileName: filename,
      blob,
      base64Data,
      orientation: inferredOrientation,
      paperSize,
    });
  } catch (err: any) {
    console.error('[pdfExport] PDF print failed:', err);
    return {
      ok: false,
      mode: 'failed',
      jobName,
      error: err?.message || 'Unable to print PDF document.',
    };
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
export interface SalesReportPdfMeta {
  shopLabel: string;
  startDate?: string;
  endDate?: string;
  periodKey?: 'day' | 'week' | 'month' | 'year' | 'custom' | string;
  periodTitle?: string;
  periodLabel?: string;
  dateRangeText?: string;
  sellerLabel?: string;
  paymentLabel?: string;
  statusLabel?: string;
  searchQuery?: string;
  totalRevenue: number;
  totalProfit: number;
}

function resolveSalesPeriodMeta(meta: SalesReportPdfMeta) {
  const key = (meta.periodKey || '').toLowerCase();
  const defaultTitle =
    key === 'day' || key === 'today'
      ? 'Daily Sales Report'
      : key === 'week'
        ? 'Weekly Sales Report'
        : key === 'month'
          ? 'Monthly Sales Report'
          : key === 'year'
            ? 'Yearly Sales Report'
            : key === 'custom'
              ? 'Custom Period Sales Report'
              : 'Sales & Transactions Report';

  const defaultLabel =
    key === 'day' || key === 'today'
      ? 'Day (Today)'
      : key === 'week'
        ? 'Week (Last 7 Days)'
        : key === 'month'
          ? 'Month (This Month)'
          : key === 'year'
            ? 'Year (This Year)'
            : key === 'custom'
              ? 'Custom Range'
              : 'Selected Period';

  const rangeText =
    meta.dateRangeText ||
    (meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate} to ${meta.endDate}`
      : `${meta.startDate || 'Beginning'} to ${meta.endDate || 'Present'}`);

  return {
    key: key || 'report',
    title: meta.periodTitle || defaultTitle,
    label: meta.periodLabel || defaultLabel,
    rangeText,
  };
}

export function buildSalesReportPdfDoc(
  sales: Sale[],
  settings: BusinessSettings,
  meta: SalesReportPdfMeta
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Sales Control';
  const period = resolveSalesPeriodMeta(meta);

  const completedSales = sales.filter(s => s.status === 'COMPLETED');
  const voidedCount = sales.length - completedSales.length;

  // Aggregate product performance strictly from completed sales in the selected period
  const productAggMap = new Map<
    string,
    {
      name: string;
      sku: string;
      orders: number;
      qtySold: number;
      revenue: number;
      cost: number;
      profit: number;
    }
  >();

  let totalUnitsSold = 0;

  for (const sale of completedSales) {
    const seenInSale = new Set<string>();
    for (const item of sale.items || []) {
      const qty = Number(item.quantity) || 0;
      const unitPrice = Number(item.unitPrice) || 0;
      const purchasePrice = Number(item.purchasePrice) || 0;
      const lineTotal =
        item.total !== undefined && item.total !== null
          ? Number(item.total)
          : Math.max(0, qty * unitPrice - (Number(item.discount) || 0));
      const lineCost = qty * purchasePrice;
      const lineProfit = lineTotal - lineCost;

      totalUnitsSold += qty;

      const prodKey = item.productId || `${item.productName}::${item.sku || ''}`;
      const existing = productAggMap.get(prodKey);
      if (existing) {
        existing.qtySold += qty;
        existing.revenue += lineTotal;
        existing.cost += lineCost;
        existing.profit += lineProfit;
        if (!seenInSale.has(prodKey)) {
          existing.orders += 1;
          seenInSale.add(prodKey);
        }
      } else {
        productAggMap.set(prodKey, {
          name: item.productName || 'Unnamed Product',
          sku: item.sku || '-',
          orders: 1,
          qtySold: qty,
          revenue: lineTotal,
          cost: lineCost,
          profit: lineProfit,
        });
        seenInSale.add(prodKey);
      }
    }
  }

  const aggregatedProducts = Array.from(productAggMap.values()).sort(
    (a, b) => b.revenue - a.revenue || b.qtySold - a.qtySold
  );

  const marginPct =
    meta.totalRevenue > 0
      ? `${((meta.totalProfit / meta.totalRevenue) * 100).toFixed(1)}% margin`
      : '0.0% margin';

  const activeFiltersList: string[] = [];
  if (meta.sellerLabel && meta.sellerLabel !== 'All Sellers') {
    activeFiltersList.push(`Seller: ${meta.sellerLabel}`);
  }
  if (meta.paymentLabel && meta.paymentLabel !== 'All Payment Methods') {
    activeFiltersList.push(`Pay: ${meta.paymentLabel}`);
  }
  if (meta.statusLabel && meta.statusLabel !== 'All Statuses') {
    activeFiltersList.push(`Status: ${meta.statusLabel}`);
  }
  if (meta.searchQuery?.trim()) {
    activeFiltersList.push(`Search: "${meta.searchQuery.trim()}"`);
  }
  const filtersSummary =
    activeFiltersList.length > 0 ? activeFiltersList.join(' | ') : 'All Sellers, Payments & Statuses';

  let y = drawBanner(
    doc,
    period.title,
    `${biz}${settings?.tagline ? ` | ${settings.tagline}` : ''}`,
    [
      `Period: ${period.label} (${period.rangeText})`,
      `Generated: ${new Date().toLocaleString()}`,
      settings?.phone ? `Phone: ${settings.phone}` : settings?.address || '',
    ].filter(Boolean),
    COLORS.blueDark
  );

  y = drawMetaStrip(doc, y, [
    { label: 'Scope / Shop', value: meta.shopLabel },
    { label: 'Selected Period', value: `${period.label} - ${period.rangeText}` },
    { label: 'Active Filters', value: filtersSummary },
    {
      label: 'Records',
      value:
        voidedCount > 0
          ? `${completedSales.length} completed, ${voidedCount} voided`
          : `${completedSales.length} completed sale(s)`,
    },
  ]);

  y = drawKpiRow(doc, y, [
    {
      label: 'Completed Revenue',
      value: formatCurrency(meta.totalRevenue, symbol),
      color: COLORS.blue,
    },
    {
      label: `Gross Profit (${marginPct})`,
      value: formatCurrency(meta.totalProfit, symbol),
      color: COLORS.emerald,
    },
    {
      label: 'Products Sold',
      value: `${formatQtyCompact(totalUnitsSold)} units (${aggregatedProducts.length} items)`,
      color: COLORS.violet,
    },
    {
      label: 'Transactions',
      value: `${sales.length} total`,
      color: COLORS.navy,
    },
  ]);

  // Section 1 Heading: Transactions Detail
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.slate900);
  doc.text(
    pdfSafe(`1. Sales Transactions (${period.label} | ${period.rangeText})`),
    12,
    y + 2.5
  );
  y += 5;

  const txRows =
    sales.length === 0
      ? [
          [
            '-',
            '-',
            `No sales transactions found for ${period.label} (${period.rangeText})`,
            '-',
            '-',
            '-',
            '-',
          ],
        ]
      : sales.map(sale => {
          const items = sale.items || [];
          const productLines =
            items.length === 0
              ? ['-']
              : items.map((item, idx) => {
                  const qtyStr = formatQtyCompact(Number(item.quantity) || 0);
                  const unitStr = formatCurrency(Number(item.unitPrice) || 0, symbol);
                  const lineTotal =
                    item.total !== undefined && item.total !== null
                      ? Number(item.total)
                      : Math.max(0, (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0) - (Number(item.discount) || 0));
                  const lineTotalStr = formatCurrency(lineTotal, symbol);
                  const prefix = items.length > 1 ? `${idx + 1}. ` : '';
                  return `${prefix}${item.productName}   |   ${qtyStr} x ${unitStr}  =  ${lineTotalStr}`;
                });

          const receiptAndDate = pdfSafeMultiline([
            `#${sale.receiptNumber}`,
            formatDateTime(sale.createdAt),
          ]);

          const shopAndSeller = pdfSafeMultiline([
            sale.shopName || 'N/A',
            `Seller: ${sale.sellerName || 'N/A'}`,
            sale.assistantName ? `Asst: ${sale.assistantName}` : '',
          ]);

          return [
            receiptAndDate,
            shopAndSeller,
            pdfSafeMultiline(productLines),
            pdfSafe((sale.paymentMethod || '').replace(/_/g, ' ')),
            pdfSafe(sale.status),
            pdfSafe(formatCurrency(sale.total, symbol)),
            pdfSafe(
              sale.status === 'COMPLETED'
                ? formatCurrency(sale.grossProfit, symbol)
                : formatCurrency(0, symbol)
            ),
          ];
        });

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    rowPageBreak: 'avoid',
    head: [
      [
        'Receipt & Date',
        'Shop & Seller',
        'Products Sold (Item | Qty x Price = Subtotal)',
        'Payment',
        'Status',
        'Total',
        'Profit',
      ],
    ],
    body: txRows,
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 2.8, right: 2.5, bottom: 2.8, left: 2.5 },
      textColor: COLORS.slate900,
      overflow: 'linebreak',
      valign: 'top',
      lineColor: COLORS.slate200,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: COLORS.navy,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      valign: 'middle',
      cellPadding: { top: 3, right: 2.5, bottom: 3, left: 2.5 },
    },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: 38 },
      2: { cellWidth: 102, fontSize: 7.3 },
      3: { cellWidth: 22, halign: 'center' },
      4: { cellWidth: 21, halign: 'center' },
      5: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: 26, halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
    },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 0) {
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.column.index === 4) {
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

  // Section 2: Professionally Organized Products Sold Breakdown for the Selected Period
  if (aggregatedProducts.length > 0) {
    let nextY = getLastTableY(doc, y + 30) + 9;
    const pageH = doc.internal.pageSize.getHeight();
    if (nextY > pageH - 38) {
      doc.addPage();
      nextY = 16;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.slate900);
    doc.text(
      pdfSafe(
        `2. Products Sold Breakdown - ${period.label} (${aggregatedProducts.length} product(s) | ${formatQtyCompact(totalUnitsSold)} total units)`
      ),
      12,
      nextY
    );

    const productSummaryRows = aggregatedProducts.map((p, idx) => {
      const avgUnitPrice = p.qtySold > 0 ? p.revenue / p.qtySold : 0;
      const itemMargin = p.revenue > 0 ? `${((p.profit / p.revenue) * 100).toFixed(1)}%` : '0.0%';
      return [
        String(idx + 1),
        pdfSafe(p.name),
        pdfSafe(p.sku),
        String(p.orders),
        formatQtyCompact(p.qtySold),
        pdfSafe(formatCurrency(avgUnitPrice, symbol)),
        pdfSafe(formatCurrency(p.revenue, symbol)),
        pdfSafe(`${formatCurrency(p.profit, symbol)} (${itemMargin})`),
      ];
    });

    const totalProductRev = aggregatedProducts.reduce((s, p) => s + p.revenue, 0);
    const totalProductProfit = aggregatedProducts.reduce((s, p) => s + p.profit, 0);

    autoTable(doc, {
      startY: nextY + 3.5,
      margin: { left: 12, right: 12, bottom: 15 },
      rowPageBreak: 'avoid',
      head: [
        ['#', 'Product Name', 'SKU', 'Sales', 'Qty Sold', 'Avg Price', 'Total Revenue', 'Gross Profit'],
      ],
      body: productSummaryRows,
      foot: [
        [
          '',
          `PERIOD TOTAL (${aggregatedProducts.length} PRODUCTS)`,
          '',
          String(completedSales.length),
          formatQtyCompact(totalUnitsSold),
          '',
          pdfSafe(formatCurrency(totalProductRev, symbol)),
          pdfSafe(formatCurrency(totalProductProfit, symbol)),
        ],
      ],
      styles: {
        fontSize: 7.8,
        cellPadding: { top: 2.6, right: 2.5, bottom: 2.6, left: 2.5 },
        textColor: COLORS.slate900,
        overflow: 'linebreak',
        valign: 'middle',
        lineColor: COLORS.slate200,
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: COLORS.blueDark,
        textColor: COLORS.white,
        fontStyle: 'bold',
        fontSize: 7.8,
      },
      footStyles: {
        fillColor: COLORS.slate100,
        textColor: COLORS.slate900,
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        0: { cellWidth: 11, halign: 'center', textColor: COLORS.slate500 },
        1: { cellWidth: 80, fontStyle: 'bold' },
        2: { cellWidth: 32, textColor: COLORS.slate700 },
        3: { cellWidth: 18, halign: 'right' },
        4: { cellWidth: 24, halign: 'right', fontStyle: 'bold', textColor: COLORS.blueDark },
        5: { cellWidth: 32, halign: 'right' },
        6: { cellWidth: 36, halign: 'right', fontStyle: 'bold' },
        7: { cellWidth: 40, halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
      },
    });
  }

  applyPageFooters(
    doc,
    `${biz} - ${period.title} (${meta.shopLabel} | ${period.rangeText})`
  );
  return doc;
}

export async function downloadSalesReportPdf(
  sales: Sale[],
  settings: BusinessSettings,
  meta: SalesReportPdfMeta
): Promise<boolean> {
  const doc = buildSalesReportPdfDoc(sales, settings, meta);
  const period = resolveSalesPeriodMeta(meta);
  const dateTag =
    meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate}_to_${meta.endDate}`
      : new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(
    doc,
    `sales_report_${period.key}_${meta.shopLabel}_${dateTag}.pdf`
  );
}

export async function printSalesReportPdf(
  sales: Sale[],
  settings: BusinessSettings,
  meta: SalesReportPdfMeta
): Promise<PrintPdfResult> {
  const doc = buildSalesReportPdfDoc(sales, settings, meta);
  const period = resolveSalesPeriodMeta(meta);
  const dateTag =
    meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate}_to_${meta.endDate}`
      : new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `${period.title} - ${meta.shopLabel} (${dateTag})`,
    `sales_report_${period.key}_${meta.shopLabel}_${dateTag}.pdf`,
    { orientation: 'landscape', paperSize: 'a4' }
  );
}

// =====================================================================
// 1B. SOLD PRODUCTS SUMMARY PDF (AdminSales.tsx — Separate Compact Report)
// Shows ONLY unique shop products sold in the selected period with:
// Product Name | Total Remained (Shop Qty) — extended full-width right side for pen notes
// =====================================================================
export interface SoldProductSummaryRow {
  productName: string;
  totalRemained: number;
  totalSold?: number;
  unit?: string;
}

export interface SoldProductsSummaryPdfMeta {
  shopLabel: string;
  startDate?: string;
  endDate?: string;
  periodKey?: 'day' | 'week' | 'month' | 'year' | 'custom' | 'search' | string;
  periodLabel?: string;
  dateRangeText?: string;
  sellerLabel?: string;
  paymentLabel?: string;
  searchQuery?: string;
}

function resolveSoldProductsPeriodMeta(meta: SoldProductsSummaryPdfMeta) {
  const key = (meta.periodKey || '').toLowerCase();
  const title =
    key === 'day' || key === 'today'
      ? 'Daily Sold Products Summary'
      : key === 'week'
        ? 'Weekly Sold Products Summary'
        : key === 'month'
          ? 'Monthly Sold Products Summary'
          : key === 'year'
            ? 'Yearly Sold Products Summary'
            : key === 'custom'
              ? 'Custom Period Sold Products Summary'
              : key === 'search'
                ? 'Sold Products Summary (Search)'
                : 'Sold Products Summary';

  const label =
    meta.periodLabel ||
    (key === 'day' || key === 'today'
      ? 'Day (Today)'
      : key === 'week'
        ? 'Week (Last 7 Days)'
        : key === 'month'
          ? 'Month (This Month)'
          : key === 'year'
            ? 'Year (This Year)'
            : key === 'custom'
              ? 'Custom Range'
              : 'Selected Period');

  const rangeText =
    meta.dateRangeText ||
    (meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate} to ${meta.endDate}`
      : `${meta.startDate || 'Beginning'} to ${meta.endDate || 'Present'}`);

  return {
    key: key || 'period',
    title,
    label,
    rangeText,
  };
}

export function buildSoldProductsSummaryPdfDoc(
  rows: SoldProductSummaryRow[],
  settings: BusinessSettings,
  meta: SoldProductsSummaryPdfMeta
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const biz = settings?.businessName || 'Sales Control';
  const period = resolveSoldProductsPeriodMeta(meta);

  const totalRemainedUnits = rows.reduce((sum, r) => sum + (Number(r.totalRemained) || 0), 0);

  const activeFilters: string[] = [];
  if (meta.sellerLabel && meta.sellerLabel !== 'All Sellers') {
    activeFilters.push(`Seller: ${meta.sellerLabel}`);
  }
  if (meta.paymentLabel && meta.paymentLabel !== 'All Payment Methods') {
    activeFilters.push(`Pay: ${meta.paymentLabel}`);
  }
  if (meta.searchQuery?.trim()) {
    activeFilters.push(`Search: "${meta.searchQuery.trim()}"`);
  }

  let y = drawBanner(
    doc,
    period.title,
    `${biz}${settings?.tagline ? ` | ${settings.tagline}` : ''}`,
    [
      `Period: ${period.label}`,
      `Date: ${period.rangeText}`,
      `Generated: ${new Date().toLocaleString()}`,
    ],
    COLORS.emerald
  );

  y = drawMetaStrip(doc, y, [
    { label: 'Scope / Shop', value: meta.shopLabel },
    { label: 'Selected Period', value: `${period.label} (${period.rangeText})` },
    {
      label: 'Filter Scope',
      value:
        activeFilters.length > 0
          ? `${activeFilters.join(' | ')} | Shop Products Only`
          : 'Shop Products Only (Excl. Stores)',
    },
  ]);

  y = drawKpiRow(doc, y, [
    {
      label: 'Unique Sold Products (Shop)',
      value: String(rows.length),
      color: COLORS.navy,
    },
    {
      label: 'Total Remained (Shop Qty)',
      value: formatQtyCompact(totalRemainedUnits),
      color: COLORS.blue,
    },
  ]);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.slate900);
  doc.text(
    pdfSafe(`Sold Products - Shop Remaining Stock (${period.label} | ${period.rangeText})`),
    12,
    y + 2.5
  );
  y += 5;

  const bodyRows =
    rows.length === 0
      ? [
          [
            '-',
            `No shop products were sold during ${period.label} (${period.rangeText})`,
            '0',
          ],
        ]
      : rows.map((row, idx) => [
          String(idx + 1),
          pdfSafe(row.productName),
          formatQtyCompact(row.totalRemained),
        ]);

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    tableWidth: 186,
    theme: 'grid',
    rowPageBreak: 'avoid',
    head: [['#', 'Product Name', 'Total Remained (Qty)']],
    body: bodyRows,
    foot:
      rows.length > 0
        ? [
            [
              '',
              `TOTAL (${rows.length} SOLD PRODUCT${rows.length === 1 ? '' : 'S'})`,
              formatQtyCompact(totalRemainedUnits),
            ],
          ]
        : undefined,
    styles: {
      fontSize: 9,
      cellPadding: { top: 3.8, right: 3.5, bottom: 3.8, left: 4 },
      textColor: COLORS.slate900,
      overflow: 'linebreak',
      valign: 'middle',
      lineColor: COLORS.slate200,
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: COLORS.navy,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 9,
      halign: 'left',
      cellPadding: { top: 3.8, right: 3.5, bottom: 3.8, left: 4 },
    },
    footStyles: {
      fillColor: COLORS.slate100,
      textColor: COLORS.slate900,
      fontStyle: 'bold',
      fontSize: 9.2,
      halign: 'left',
    },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      0: { cellWidth: 13, halign: 'center', textColor: COLORS.slate500 },
      1: { cellWidth: 93, halign: 'left', fontStyle: 'bold' },
      2: { cellWidth: 80, halign: 'left', fontStyle: 'bold', textColor: COLORS.blueDark },
    },
    didParseCell: data => {
      if (data.section === 'head' && data.column.index === 0) {
        data.cell.styles.halign = 'center';
      }
      if (data.section === 'body' && data.column.index === 2 && rows.length > 0) {
        const val = Number(data.cell.raw);
        if (Number.isFinite(val) && val <= 0) {
          data.cell.styles.textColor = COLORS.rose;
        }
      }
    },
  });

  applyPageFooters(
    doc,
    `${biz} - ${period.title} (${meta.shopLabel} | ${period.rangeText})`
  );
  return doc;
}

export async function downloadSoldProductsSummaryPdf(
  rows: SoldProductSummaryRow[],
  settings: BusinessSettings,
  meta: SoldProductsSummaryPdfMeta
): Promise<boolean> {
  const doc = buildSoldProductsSummaryPdfDoc(rows, settings, meta);
  const period = resolveSoldProductsPeriodMeta(meta);
  const dateTag =
    meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate}_to_${meta.endDate}`
      : new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(
    doc,
    `sold_products_summary_${period.key}_${meta.shopLabel}_${dateTag}.pdf`
  );
}

export async function printSoldProductsSummaryPdf(
  rows: SoldProductSummaryRow[],
  settings: BusinessSettings,
  meta: SoldProductsSummaryPdfMeta
): Promise<PrintPdfResult> {
  const doc = buildSoldProductsSummaryPdfDoc(rows, settings, meta);
  const period = resolveSoldProductsPeriodMeta(meta);
  const dateTag =
    meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate}_to_${meta.endDate}`
      : new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `${period.title} - ${meta.shopLabel} (${dateTag})`,
    `sold_products_summary_${period.key}_${meta.shopLabel}_${dateTag}.pdf`,
    { orientation: 'portrait', paperSize: 'a4' }
  );
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

export async function printSaleEditsPdf(
  requests: SaleEditRequest[],
  salesById: Map<string, Sale>,
  settings: BusinessSettings,
  meta: SaleEditsPrintMeta
): Promise<PrintPdfResult> {
  const doc = buildSaleEditsPdfDoc(requests, salesById, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `Sale Edits History - ${meta.shopLabel} (${stamp})`,
    `sale_edits_history_${stamp}.pdf`,
    { orientation: 'landscape', paperSize: 'a4' }
  );
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

export async function printTransferVoucherPdf(
  transfer: StockTransfer,
  settings: BusinessSettings
): Promise<PrintPdfResult> {
  const doc = buildTransferVoucherPdfDoc(transfer, settings);
  return triggerPdfPrint(
    doc,
    `Stock Transfer ${transfer.transferNumber}`,
    `stock_transfer_${transfer.transferNumber}.pdf`,
    { orientation: 'portrait', paperSize: 'a4' }
  );
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

export async function printMovementsReportPdfDirect(
  movements: InventoryMovement[],
  settings: BusinessSettings,
  meta: MovementsPrintMeta
): Promise<PrintPdfResult> {
  const doc = buildMovementsPdfDoc(movements, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `Stock Movements Report (${meta.periodLabel || stamp})`,
    `stock_movements_${stamp}.pdf`,
    { orientation: 'landscape', paperSize: 'a4' }
  );
}

// =====================================================================
// 5. LOW STOCK REPORT PDF (AdminInventory.tsx)
// =====================================================================
export function buildLowStockReportPdfDoc(
  lowStockProducts: Product[],
  shops: Shop[],
  settings: BusinessSettings,
  scopeLabel: string
): jsPDF {
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
  return doc;
}

export async function downloadLowStockReportPdf(
  lowStockProducts: Product[],
  shops: Shop[],
  settings: BusinessSettings,
  scopeLabel: string
): Promise<boolean> {
  const doc = buildLowStockReportPdfDoc(lowStockProducts, shops, settings, scopeLabel);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `low_stock_report_${stamp}.pdf`);
}

export async function printLowStockReportPdf(
  lowStockProducts: Product[],
  shops: Shop[],
  settings: BusinessSettings,
  scopeLabel: string
): Promise<PrintPdfResult> {
  const doc = buildLowStockReportPdfDoc(lowStockProducts, shops, settings, scopeLabel);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `Low Stock Report - ${scopeLabel} (${stamp})`,
    `low_stock_report_${stamp}.pdf`,
    { orientation: 'portrait', paperSize: 'a4' }
  );
}

// =====================================================================
// 6. STOCK LOSS REPORT PDF (AdminInventory.tsx)
// =====================================================================
export function buildLossReportPdfDoc(
  losses: InventoryMovement[],
  settings: BusinessSettings,
  meta: { periodLabel: string; totalLossValue: number; totalLossUnits: number }
): jsPDF {
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
  return doc;
}

export async function downloadLossReportPdf(
  losses: InventoryMovement[],
  settings: BusinessSettings,
  meta: { periodLabel: string; totalLossValue: number; totalLossUnits: number }
): Promise<boolean> {
  const doc = buildLossReportPdfDoc(losses, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `stock_loss_report_${stamp}.pdf`);
}

export async function printLossReportPdf(
  losses: InventoryMovement[],
  settings: BusinessSettings,
  meta: { periodLabel: string; totalLossValue: number; totalLossUnits: number }
): Promise<PrintPdfResult> {
  const doc = buildLossReportPdfDoc(losses, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `Stock Loss Report (${meta.periodLabel})`,
    `stock_loss_report_${stamp}.pdf`,
    { orientation: 'landscape', paperSize: 'a4' }
  );
}

// =====================================================================
// 7. FINANCIAL REPORT PDF (AdminReports.tsx)
// =====================================================================
export function buildFinancialReportPdfDoc(
  incomeSummary: any,
  settings: BusinessSettings,
  meta: { shopLabel: string; from?: string; to?: string; periodKey?: string; periodLabel?: string }
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Financial Report';
  const s = incomeSummary || {};
  const periodLabel = meta.periodLabel || 'Selected Period';
  const periodKey = meta.periodKey || 'period';
  const rangeStr =
    meta.from && meta.to
      ? meta.from === meta.to
        ? meta.from
        : `${meta.from} to ${meta.to}`
      : `${meta.from || 'Beginning'} to ${meta.to || 'Present'}`;

  let y = drawBanner(
    doc,
    `Financial Report (${periodLabel})`,
    `${biz} | ${meta.shopLabel}`,
    [
      `Period: ${periodLabel} (${rangeStr})`,
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
    styles: { fontSize: 8.5, cellPadding: 2.6, lineColor: COLORS.slate200, lineWidth: 0.2 },
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
      startY: getLastTableY(doc, y + 40) + 7,
      margin: { left: 12, right: 12, bottom: 15 },
      head: [['Shop Performance', 'Sales', 'Revenue', 'Gross Profit']],
      body: shopRows,
      styles: { fontSize: 8, cellPadding: 2.5, lineColor: COLORS.slate200, lineWidth: 0.2 },
      headStyles: { fillColor: COLORS.blueDark, textColor: COLORS.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right', fontStyle: 'bold' },
        3: { halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
      },
    });
  }

  // Product Profitability (Organized & Spacious)
  const prodRows = (s.topProducts || []).map((p: any, idx: number) => {
    const rev = Number(p.revenue || 0);
    const prof = Number(p.profit || 0);
    const margin = rev > 0 ? `${((prof / rev) * 100).toFixed(1)}%` : '0.0%';
    return [
      String(idx + 1),
      pdfSafe(p.name),
      pdfSafe(p.sku || '-'),
      formatQtyCompact(Number(p.unitsSold || 0)),
      pdfSafe(formatCurrency(rev, symbol)),
      pdfSafe(formatCurrency(prof, symbol)),
      margin,
    ];
  });
  if (prodRows.length > 0) {
    autoTable(doc, {
      startY: getLastTableY(doc, y + 70) + 7,
      margin: { left: 12, right: 12, bottom: 15 },
      rowPageBreak: 'avoid',
      head: [['#', 'Product Name', 'SKU', 'Qty Sold', 'Revenue', 'Profit', 'Margin']],
      body: prodRows,
      styles: {
        fontSize: 7.8,
        cellPadding: { top: 2.6, right: 2.4, bottom: 2.6, left: 2.4 },
        overflow: 'linebreak',
        lineColor: COLORS.slate200,
        lineWidth: 0.2,
      },
      headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center', textColor: COLORS.slate500 },
        1: { cellWidth: 58, fontStyle: 'bold' },
        2: { cellWidth: 26, textColor: COLORS.slate700 },
        3: { cellWidth: 18, halign: 'right', fontStyle: 'bold', textColor: COLORS.blueDark },
        4: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
        5: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
        6: { cellWidth: 18, halign: 'right', textColor: COLORS.slate700 },
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
      startY: getLastTableY(doc, y + 100) + 7,
      margin: { left: 12, right: 12, bottom: 15 },
      head: [['Seller Performance', 'Orders', 'Revenue', 'Profit']],
      body: sellerRows,
      styles: { fontSize: 8, cellPadding: 2.5, lineColor: COLORS.slate200, lineWidth: 0.2 },
      headStyles: { fillColor: COLORS.violet, textColor: COLORS.white, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right', fontStyle: 'bold' },
        3: { halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
      },
    });
  }

  applyPageFooters(doc, `${biz} - Financial Report (${periodLabel} | ${meta.shopLabel})`);
  return doc;
}

export async function downloadFinancialReportPdf(
  incomeSummary: any,
  settings: BusinessSettings,
  meta: { shopLabel: string; from?: string; to?: string; periodKey?: string; periodLabel?: string }
): Promise<boolean> {
  const doc = buildFinancialReportPdfDoc(incomeSummary, settings, meta);
  const periodKey = meta.periodKey || 'period';
  const dateTag =
    meta.from && meta.to
      ? meta.from === meta.to
        ? meta.from
        : `${meta.from}_to_${meta.to}`
      : new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `financial_report_${periodKey}_${meta.shopLabel}_${dateTag}.pdf`);
}

export async function printFinancialReportPdf(
  incomeSummary: any,
  settings: BusinessSettings,
  meta: { shopLabel: string; from?: string; to?: string; periodKey?: string; periodLabel?: string }
): Promise<PrintPdfResult> {
  const doc = buildFinancialReportPdfDoc(incomeSummary, settings, meta);
  const periodKey = meta.periodKey || 'period';
  const periodLabel = meta.periodLabel || 'Selected Period';
  const dateTag =
    meta.from && meta.to
      ? meta.from === meta.to
        ? meta.from
        : `${meta.from}_to_${meta.to}`
      : new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `Financial Report (${periodLabel}) - ${meta.shopLabel}`,
    `financial_report_${periodKey}_${meta.shopLabel}_${dateTag}.pdf`,
    { orientation: 'portrait', paperSize: 'a4' }
  );
}

// =====================================================================
// 8. SHOP PROFIT & LOSS PDF (AdminReports.tsx)
// =====================================================================
export function buildShopProfitLossPdfDoc(
  rows: any[],
  totals: any,
  generalCompanyExpenses: number,
  settings: BusinessSettings,
  meta: { from?: string; to?: string; periodLabel: string }
): jsPDF {
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
  return doc;
}

export async function downloadShopProfitLossPdf(
  rows: any[],
  totals: any,
  generalCompanyExpenses: number,
  settings: BusinessSettings,
  meta: { from?: string; to?: string; periodLabel: string }
): Promise<boolean> {
  const doc = buildShopProfitLossPdfDoc(rows, totals, generalCompanyExpenses, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `shop_profit_loss_${meta.periodLabel}_${stamp}.pdf`);
}

export async function printShopProfitLossPdf(
  rows: any[],
  totals: any,
  generalCompanyExpenses: number,
  settings: BusinessSettings,
  meta: { from?: string; to?: string; periodLabel: string }
): Promise<PrintPdfResult> {
  const doc = buildShopProfitLossPdfDoc(rows, totals, generalCompanyExpenses, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `Shop Profit & Loss (${meta.periodLabel})`,
    `shop_profit_loss_${meta.periodLabel}_${stamp}.pdf`,
    { orientation: 'landscape', paperSize: 'a4' }
  );
}

// =====================================================================
// 9. PRICE DEVIATIONS AUDIT PDF (AdminReports.tsx)
// =====================================================================
export function buildPriceDeviationsPdfDoc(
  deviations: any[],
  stats: { belowCount: number; belowCostCount: number; aboveCount: number },
  settings: BusinessSettings,
  meta: { shopLabel: string; from?: string; to?: string; direction: string }
): jsPDF {
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
  return doc;
}

export async function downloadPriceDeviationsPdf(
  deviations: any[],
  stats: { belowCount: number; belowCostCount: number; aboveCount: number },
  settings: BusinessSettings,
  meta: { shopLabel: string; from?: string; to?: string; direction: string }
): Promise<boolean> {
  const doc = buildPriceDeviationsPdfDoc(deviations, stats, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(doc, `price_deviations_${meta.shopLabel}_${stamp}.pdf`);
}

export async function printPriceDeviationsPdf(
  deviations: any[],
  stats: { belowCount: number; belowCostCount: number; aboveCount: number },
  settings: BusinessSettings,
  meta: { shopLabel: string; from?: string; to?: string; direction: string }
): Promise<PrintPdfResult> {
  const doc = buildPriceDeviationsPdfDoc(deviations, stats, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `Price Deviation Audit - ${meta.shopLabel}`,
    `price_deviations_${meta.shopLabel}_${stamp}.pdf`,
    { orientation: 'landscape', paperSize: 'a4' }
  );
}

// =====================================================================
// 10. POS COMMERCIAL RECEIPT PDF (ReceiptModal.tsx)
// =====================================================================
export function buildReceiptPdfDoc(
  sale: Sale,
  settings: BusinessSettings
): jsPDF {
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

  return doc;
}

export async function downloadReceiptPdf(
  sale: Sale,
  settings: BusinessSettings
): Promise<boolean> {
  const doc = buildReceiptPdfDoc(sale, settings);
  return triggerPdfDownload(doc, `receipt_${sale.receiptNumber}.pdf`);
}

export async function printReceiptPdf(
  sale: Sale,
  settings: BusinessSettings
): Promise<PrintPdfResult> {
  const doc = buildReceiptPdfDoc(sale, settings);
  return triggerPdfPrint(
    doc,
    `Receipt #${sale.receiptNumber}`,
    `receipt_${sale.receiptNumber}.pdf`,
    { orientation: 'portrait', paperSize: 'receipt' }
  );
}

// =====================================================================
// 8. PURCHASES REPORT PDF (AdminPurchases.tsx — Period-Aware List)
// =====================================================================
export interface PurchasesReportPdfMeta {
  shopLabel: string;
  periodKey?: 'all' | 'day' | 'week' | 'month' | 'custom' | 'search' | string;
  periodTitle?: string;
  periodLabel?: string;
  dateRangeText?: string;
  startDate?: string;
  endDate?: string;
  searchQuery?: string;
  storeNameById?: Record<string, string>;
}

function resolvePurchasesPeriodMeta(meta: PurchasesReportPdfMeta) {
  const key = (meta.periodKey || 'all').toLowerCase();
  const defaultTitle =
    key === 'day' || key === 'today'
      ? 'Daily Purchases Report'
      : key === 'week'
        ? 'Weekly Purchases Report'
        : key === 'month'
          ? 'Monthly Purchases Report'
          : key === 'custom'
            ? 'Custom Period Purchases Report'
            : key === 'search'
              ? 'Purchases Search Report'
              : 'All Purchases Report';

  const defaultLabel =
    key === 'day' || key === 'today'
      ? 'Day (Today)'
      : key === 'week'
        ? 'Week (Last 7 Days)'
        : key === 'month'
          ? 'Month (This Month)'
          : key === 'custom'
            ? 'Custom Range'
            : key === 'search'
              ? 'Search Results (All Dates)'
              : 'All Dates';

  const rangeText =
    meta.dateRangeText ||
    (meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate} to ${meta.endDate}`
      : key === 'all' || key === 'search'
        ? 'All Dates'
        : `${meta.startDate || 'Beginning'} to ${meta.endDate || 'Present'}`);

  return {
    key: key || 'all',
    title: meta.periodTitle || defaultTitle,
    label: meta.periodLabel || defaultLabel,
    rangeText,
  };
}

export function buildPurchasesReportPdfDoc(
  purchases: Purchase[],
  settings: BusinessSettings,
  meta: PurchasesReportPdfMeta
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Procurement Control';
  const period = resolvePurchasesPeriodMeta(meta);

  const totalSpend = purchases.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);
  const paidCount = purchases.filter(p => p.paymentStatus === 'PAID').length;
  const unpaidCount = purchases.length - paidCount;

  const supplierSet = new Set(
    purchases.map(p => (p.supplierName || 'Walk-in Supplier').trim().toLowerCase())
  );

  const productAggMap = new Map<
    string,
    {
      name: string;
      orders: number;
      qtyPurchased: number;
      totalCost: number;
    }
  >();

  let totalUnitsPurchased = 0;

  for (const purchase of purchases) {
    const seenInOrder = new Set<string>();
    for (const item of purchase.items || []) {
      const qty = Number(item.quantity) || 0;
      const unitCost = Number(item.unitCost) || 0;
      const lineTotal =
        item.total !== undefined && item.total !== null ? Number(item.total) : qty * unitCost;

      totalUnitsPurchased += qty;

      const prodKey = item.productId || item.productName;
      const existing = productAggMap.get(prodKey);
      if (existing) {
        existing.qtyPurchased += qty;
        existing.totalCost += lineTotal;
        if (!seenInOrder.has(prodKey)) {
          existing.orders += 1;
          seenInOrder.add(prodKey);
        }
      } else {
        productAggMap.set(prodKey, {
          name: item.productName || 'Unnamed Product',
          orders: 1,
          qtyPurchased: qty,
          totalCost: lineTotal,
        });
        seenInOrder.add(prodKey);
      }
    }
  }

  const aggregatedProducts = Array.from(productAggMap.values()).sort(
    (a, b) => b.totalCost - a.totalCost || b.qtyPurchased - a.qtyPurchased
  );

  const filtersSummary = meta.searchQuery?.trim()
    ? `Search: "${meta.searchQuery.trim()}"`
    : 'All Suppliers & Statuses';

  let y = drawBanner(
    doc,
    period.title,
    `${biz}${settings?.tagline ? ` | ${settings.tagline}` : ''}`,
    [
      `Period: ${period.label} (${period.rangeText})`,
      `Generated: ${new Date().toLocaleString()}`,
      settings?.phone ? `Phone: ${settings.phone}` : settings?.address || '',
    ].filter(Boolean),
    COLORS.navy
  );

  y = drawMetaStrip(doc, y, [
    { label: 'Scope / Shop', value: meta.shopLabel },
    { label: 'Selected Period', value: `${period.label} - ${period.rangeText}` },
    { label: 'Filter / Query', value: filtersSummary },
    {
      label: 'Payment Breakdown',
      value:
        unpaidCount > 0
          ? `${paidCount} Paid, ${unpaidCount} Partial/Unpaid`
          : `${paidCount} Paid order(s)`,
    },
  ]);

  y = drawKpiRow(doc, y, [
    {
      label: 'Total Purchase Spend',
      value: formatCurrency(totalSpend, symbol),
      color: COLORS.blue,
    },
    {
      label: 'Purchase Orders',
      value: `${purchases.length} order(s)`,
      color: COLORS.navy,
    },
    {
      label: 'Products Received',
      value: `${formatQtyCompact(totalUnitsPurchased)} units (${aggregatedProducts.length} items)`,
      color: COLORS.emerald,
    },
    {
      label: 'Suppliers',
      value: `${supplierSet.size} supplier(s)`,
      color: COLORS.violet,
    },
  ]);

  // Section 1: Purchase Orders
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.slate900);
  doc.text(
    pdfSafe(`1. Purchase Orders (${period.label} | ${period.rangeText})`),
    12,
    y + 2.5
  );
  y += 5;

  const orderRows =
    purchases.length === 0
      ? [
          [
            '-',
            '-',
            '-',
            `No purchases found for ${period.label} (${period.rangeText})`,
            '-',
            '-',
          ],
        ]
      : purchases.map(purchase => {
          const items = purchase.items || [];
          const productLines =
            items.length === 0
              ? ['-']
              : items.map((item, idx) => {
                  const qtyStr = formatQtyCompact(Number(item.quantity) || 0);
                  const costStr = formatCurrency(Number(item.unitCost) || 0, symbol);
                  const lineTotal =
                    item.total !== undefined && item.total !== null
                      ? Number(item.total)
                      : (Number(item.quantity) || 0) * (Number(item.unitCost) || 0);
                  const totalStr = formatCurrency(lineTotal, symbol);
                  const prefix = items.length > 1 ? `${idx + 1}. ` : '';
                  return `${prefix}${item.productName}   |   ${qtyStr} x ${costStr}  =  ${totalStr}`;
                });

          const poAndDate = pdfSafeMultiline([
            purchase.purchaseNumber || 'PO',
            purchase.date || purchase.createdAt.slice(0, 10),
            purchase.invoiceNumber ? `Inv: ${purchase.invoiceNumber}` : '',
          ]);

          const supplierBlock = pdfSafeMultiline([
            purchase.supplierName || 'Walk-in Supplier',
            purchase.supplierPhone ? `Tel: ${purchase.supplierPhone}` : '',
            purchase.createdByName ? `By: ${purchase.createdByName}` : '',
          ]);

          const resolvedStoreName =
            purchase.storeName ||
            (purchase.storeId && meta.storeNameById?.[purchase.storeId]) ||
            '';
          const destinationBlock = pdfSafeMultiline([
            purchase.shopName || 'Shop',
            purchase.storeId
              ? `Store: ${resolvedStoreName || 'Warehouse'}`
              : 'Shop Floor',
          ]);

          return [
            poAndDate,
            supplierBlock,
            destinationBlock,
            pdfSafeMultiline(productLines),
            pdfSafe(purchase.paymentStatus || 'PAID'),
            pdfSafe(formatCurrency(purchase.totalAmount || 0, symbol)),
          ];
        });

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 15 },
    rowPageBreak: 'avoid',
    head: [
      [
        'PO # & Date',
        'Supplier & Phone',
        'Shop & Destination',
        'Products Purchased (Item | Qty x Cost = Subtotal)',
        'Status',
        'Total',
      ],
    ],
    body: orderRows,
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 2.8, right: 2.5, bottom: 2.8, left: 2.5 },
      textColor: COLORS.slate900,
      overflow: 'linebreak',
      valign: 'top',
      lineColor: COLORS.slate200,
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: COLORS.navy,
      textColor: COLORS.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      valign: 'middle',
      cellPadding: { top: 3, right: 2.5, bottom: 3, left: 2.5 },
    },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      0: { cellWidth: 36 },
      1: { cellWidth: 44 },
      2: { cellWidth: 36 },
      3: { cellWidth: 109, fontSize: 7.3 },
      4: { cellWidth: 20, halign: 'center' },
      5: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: data => {
      if (data.section === 'body' && data.column.index === 0) {
        data.cell.styles.fontStyle = 'bold';
      }
      if (data.section === 'body' && data.column.index === 4) {
        const val = String(data.cell.raw || '');
        if (val === 'PAID') {
          data.cell.styles.textColor = COLORS.emerald;
          data.cell.styles.fontStyle = 'bold';
        } else if (val === 'PARTIAL' || val === 'UNPAID') {
          data.cell.styles.textColor = COLORS.amber;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    },
  });

  // Section 2: Products Purchased Breakdown
  if (aggregatedProducts.length > 0) {
    let nextY = getLastTableY(doc, y + 30) + 9;
    const pageH = doc.internal.pageSize.getHeight();
    if (nextY > pageH - 38) {
      doc.addPage();
      nextY = 16;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.slate900);
    doc.text(
      pdfSafe(
        `2. Products Purchased Breakdown - ${period.label} (${aggregatedProducts.length} product(s) | ${formatQtyCompact(totalUnitsPurchased)} total units)`
      ),
      12,
      nextY
    );

    const productSummaryRows = aggregatedProducts.map((p, idx) => {
      const avgUnitCost = p.qtyPurchased > 0 ? p.totalCost / p.qtyPurchased : 0;
      return [
        String(idx + 1),
        pdfSafe(p.name),
        String(p.orders),
        formatQtyCompact(p.qtyPurchased),
        pdfSafe(formatCurrency(avgUnitCost, symbol)),
        pdfSafe(formatCurrency(p.totalCost, symbol)),
      ];
    });

    const totalProductsCost = aggregatedProducts.reduce((s, p) => s + p.totalCost, 0);

    autoTable(doc, {
      startY: nextY + 3.5,
      margin: { left: 12, right: 12, bottom: 15 },
      rowPageBreak: 'avoid',
      head: [['#', 'Product Name', 'Orders', 'Qty Purchased', 'Avg Unit Cost', 'Total Cost']],
      body: productSummaryRows,
      foot: [
        [
          '',
          `PERIOD TOTAL (${aggregatedProducts.length} PRODUCTS)`,
          String(purchases.length),
          formatQtyCompact(totalUnitsPurchased),
          '',
          pdfSafe(formatCurrency(totalProductsCost, symbol)),
        ],
      ],
      styles: {
        fontSize: 7.8,
        cellPadding: { top: 2.6, right: 2.5, bottom: 2.6, left: 2.5 },
        textColor: COLORS.slate900,
        overflow: 'linebreak',
        valign: 'middle',
        lineColor: COLORS.slate200,
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: COLORS.blueDark,
        textColor: COLORS.white,
        fontStyle: 'bold',
        fontSize: 7.8,
      },
      footStyles: {
        fillColor: COLORS.slate100,
        textColor: COLORS.slate900,
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center', textColor: COLORS.slate500 },
        1: { cellWidth: 125, fontStyle: 'bold' },
        2: { cellWidth: 24, halign: 'right' },
        3: { cellWidth: 32, halign: 'right', fontStyle: 'bold', textColor: COLORS.blueDark },
        4: { cellWidth: 38, halign: 'right' },
        5: { cellWidth: 42, halign: 'right', fontStyle: 'bold' },
      },
    });
  }

  applyPageFooters(
    doc,
    `${biz} - ${period.title} (${meta.shopLabel} | ${period.rangeText})`
  );
  return doc;
}

export async function downloadPurchasesReportPdf(
  purchases: Purchase[],
  settings: BusinessSettings,
  meta: PurchasesReportPdfMeta
): Promise<boolean> {
  const doc = buildPurchasesReportPdfDoc(purchases, settings, meta);
  const period = resolvePurchasesPeriodMeta(meta);
  const dateTag =
    meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate}_to_${meta.endDate}`
      : new Date().toISOString().slice(0, 10);
  return triggerPdfDownload(
    doc,
    `purchases_report_${period.key}_${meta.shopLabel}_${dateTag}.pdf`
  );
}

export async function printPurchasesReportPdf(
  purchases: Purchase[],
  settings: BusinessSettings,
  meta: PurchasesReportPdfMeta
): Promise<PrintPdfResult> {
  const doc = buildPurchasesReportPdfDoc(purchases, settings, meta);
  const period = resolvePurchasesPeriodMeta(meta);
  const dateTag =
    meta.startDate && meta.endDate
      ? meta.startDate === meta.endDate
        ? meta.startDate
        : `${meta.startDate}_to_${meta.endDate}`
      : new Date().toISOString().slice(0, 10);
  return triggerPdfPrint(
    doc,
    `${period.title} - ${meta.shopLabel} (${dateTag})`,
    `purchases_report_${period.key}_${meta.shopLabel}_${dateTag}.pdf`,
    { orientation: 'landscape', paperSize: 'a4' }
  );
}

// =====================================================================
// 9. SINGLE PURCHASE ORDER VOUCHER PDF (AdminPurchases.tsx)
// =====================================================================
export function buildSinglePurchasePdfDoc(
  purchase: Purchase,
  settings: BusinessSettings,
  resolvedStoreName?: string
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Purchase Order';

  const items = purchase.items || [];
  const totalQty = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
  const grandTotal =
    Number(purchase.totalAmount) ||
    items.reduce(
      (s, i) =>
        s +
        (i.total !== undefined && i.total !== null
          ? Number(i.total)
          : (Number(i.quantity) || 0) * (Number(i.unitCost) || 0)),
      0
    );

  const isPaid = purchase.paymentStatus === 'PAID';
  const purchaseDateStr = purchase.date || purchase.createdAt.slice(0, 10);
  const destLabel = purchase.storeId
    ? `${purchase.shopName || 'Shop'} - Store: ${purchase.storeName || resolvedStoreName || 'Warehouse'}`
    : `${purchase.shopName || 'Shop'} - Shop Floor`;

  let y = drawBanner(
    doc,
    'PURCHASE ORDER VOUCHER',
    `${biz}${settings?.address ? ` | ${settings.address}` : ''}${settings?.phone ? ` | ${settings.phone}` : ''}`,
    [
      `PO #: ${purchase.purchaseNumber || purchase.id.slice(0, 8)}`,
      `Purchase Date: ${purchaseDateStr}`,
      `Payment: ${purchase.paymentStatus}`,
    ],
    isPaid ? COLORS.navy : COLORS.amber
  );

  y = drawMetaStrip(doc, y, [
    {
      label: 'Supplier / Vendor',
      value: purchase.supplierPhone
        ? `${purchase.supplierName} (${purchase.supplierPhone})`
        : purchase.supplierName || 'Walk-in Supplier',
    },
    {
      label: 'Invoice #',
      value: purchase.invoiceNumber || 'Not Provided',
    },
    {
      label: 'Destination',
      value: destLabel,
    },
  ]);

  y = drawKpiRow(doc, y, [
    { label: 'Line Items', value: `${items.length} product(s)`, color: COLORS.navy },
    {
      label: 'Total Units',
      value: `${formatQtyCompact(totalQty)} units`,
      color: COLORS.blue,
    },
    {
      label: 'Payment Status',
      value: purchase.paymentStatus,
      color: isPaid ? COLORS.emerald : COLORS.amber,
    },
    {
      label: 'Total Amount',
      value: formatCurrency(grandTotal, symbol),
      color: COLORS.violet,
    },
  ]);

  const rows =
    items.length === 0
      ? [['-', 'No products recorded on this purchase', '-', '-', '-']]
      : items.map((item, idx) => {
          const qty = Number(item.quantity) || 0;
          const unitCost = Number(item.unitCost) || 0;
          const lineTotal =
            item.total !== undefined && item.total !== null ? Number(item.total) : qty * unitCost;
          return [
            String(idx + 1),
            pdfSafe(item.productName),
            formatQtyCompact(qty),
            pdfSafe(formatCurrency(unitCost, symbol)),
            pdfSafe(formatCurrency(lineTotal, symbol)),
          ];
        });

  autoTable(doc, {
    startY: y,
    margin: { left: 12, right: 12, bottom: 20 },
    rowPageBreak: 'avoid',
    head: [['#', 'Product Name', 'Quantity', 'Unit Cost', 'Subtotal']],
    body: rows,
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 2.8, right: 2.5, bottom: 2.8, left: 2.5 },
      textColor: COLORS.slate900,
      lineColor: COLORS.slate200,
      lineWidth: 0.2,
    },
    headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: COLORS.slate50 },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center', textColor: COLORS.slate500 },
      1: { fontStyle: 'bold' },
      2: { cellWidth: 26, halign: 'center', fontStyle: 'bold', textColor: COLORS.blueDark },
      3: { cellWidth: 34, halign: 'right' },
      4: { cellWidth: 38, halign: 'right', fontStyle: 'bold' },
    },
  });

  let afterY = getLastTableY(doc, y + 30) + 6;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  if (afterY > pageH - 55) {
    doc.addPage();
    afterY = 18;
  }

  // Left: Supplier Contact & Notes
  const leftBoxW = 104;
  doc.setFillColor(...COLORS.slate50);
  doc.setDrawColor(...COLORS.slate200);
  doc.roundedRect(12, afterY, leftBoxW, 26, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.slate500);
  doc.text('SUPPLIER & ORDER NOTES', 15, afterY + 5.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.slate900);
  const noteLines = [
    `Supplier: ${purchase.supplierName || 'Walk-in Supplier'}${purchase.supplierPhone ? `  |  Tel: ${purchase.supplierPhone}` : ''}`,
    `Recorded: ${formatDateTime(purchase.createdAt)} by ${purchase.createdByName || 'Admin'}`,
    purchase.notes ? `Notes: ${purchase.notes}` : '',
  ].filter(Boolean);
  doc.text(pdfSafeMultiline(noteLines), 15, afterY + 10.5, { maxWidth: leftBoxW - 6 });

  // Right: Grand Total Box
  const sumX = pageW - 12 - 76;
  doc.setFillColor(...COLORS.slate50);
  doc.setDrawColor(...COLORS.slate200);
  doc.roundedRect(sumX, afterY, 76, 26, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.slate700);
  doc.text('Total Line Items:', sumX + 4, afterY + 6.5);
  doc.text(`${items.length} (${formatQtyCompact(totalQty)} units)`, sumX + 72, afterY + 6.5, {
    align: 'right',
  });

  doc.text('Payment Status:', sumX + 4, afterY + 13);
  doc.text(pdfSafe(purchase.paymentStatus), sumX + 72, afterY + 13, {
    align: 'right',
  });

  doc.setFillColor(...COLORS.navy);
  doc.roundedRect(sumX + 2, afterY + 16.5, 72, 8, 1.5, 1.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...COLORS.white);
  doc.text('GRAND TOTAL:', sumX + 5, afterY + 21.8);
  doc.text(pdfSafe(formatCurrency(grandTotal, symbol)), sumX + 71, afterY + 21.8, {
    align: 'right',
  });

  // Signature Lines
  const sigY = afterY + 42;
  doc.setDrawColor(...COLORS.slate500);
  doc.setLineWidth(0.3);
  doc.line(12, sigY, 92, sigY);
  doc.line(pageW - 92, sigY, pageW - 12, sigY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.slate500);
  doc.text(pdfSafe(`Recorded By (${purchase.createdByName || 'Admin'})`), 12, sigY + 4.5);
  doc.text('Supplier / Receiver Signature & Date', pageW - 92, sigY + 4.5);

  applyPageFooters(
    doc,
    `${biz} - Purchase Order Voucher (${purchase.purchaseNumber || purchase.id.slice(0, 8)})`
  );
  return doc;
}

export async function downloadSinglePurchasePdf(
  purchase: Purchase,
  settings: BusinessSettings,
  resolvedStoreName?: string
): Promise<boolean> {
  const doc = buildSinglePurchasePdfDoc(purchase, settings, resolvedStoreName);
  const poTag = purchase.purchaseNumber || purchase.id.slice(0, 8);
  const dateTag = purchase.date || purchase.createdAt.slice(0, 10);
  return triggerPdfDownload(doc, `purchase_${poTag}_${dateTag}.pdf`);
}

export async function printSinglePurchasePdf(
  purchase: Purchase,
  settings: BusinessSettings,
  resolvedStoreName?: string
): Promise<PrintPdfResult> {
  const doc = buildSinglePurchasePdfDoc(purchase, settings, resolvedStoreName);
  const poTag = purchase.purchaseNumber || purchase.id.slice(0, 8);
  const dateTag = purchase.date || purchase.createdAt.slice(0, 10);
  return triggerPdfPrint(
    doc,
    `Purchase Order ${poTag} (${dateTag})`,
    `purchase_${poTag}_${dateTag}.pdf`,
    { orientation: 'portrait', paperSize: 'a4' }
  );
}

// =====================================================================
// 16. INVENTORY STOCK REPORT PDF (AdminInventory.tsx — All / Shop / Store)
// =====================================================================
export type InventoryExportScope = 'ALL' | 'SHOP' | 'STORE' | 'MIXED';

export interface InventoryExportRow {
  shopName: string;
  productName: string;
  variation?: string;
  sku: string;
  unit: string;
  shopQty: number;
  storeQty: number;
  totalQty: number;
  activeQty: number;
  rowScope: 'ALL' | 'SHOP' | 'STORE';
  minStock: number;
  purchasePrice: number;
  sellingPrice: number;
  buyValue: number;
  sellValue: number;
  potentialProfit: number;
  storeBreakdown?: string;
  status: 'IN STOCK' | 'LOW STOCK' | 'OUT OF STOCK' | 'INACTIVE';
}

export interface InventoryExportMeta {
  scope: InventoryExportScope;
  shopLabel: string;
  searchQuery?: string;
  lowStockOnly?: boolean;
}

export function buildInventoryReportPdfDoc(
  rows: InventoryExportRow[],
  settings: BusinessSettings,
  meta: InventoryExportMeta
): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const symbol = settings?.currencySymbol || 'TSh';
  const biz = settings?.businessName || 'Inventory Report';

  const scopeTitle =
    meta.scope === 'SHOP'
      ? 'Shop Inventory Stock Report'
      : meta.scope === 'STORE'
        ? 'Store Inventory Stock Report'
        : meta.scope === 'MIXED'
          ? 'Filtered Inventory Stock Report'
          : 'All Inventory Stock Report (Shop + Store)';

  const scopeBadge =
    meta.scope === 'SHOP'
      ? 'Shop Stock Only'
      : meta.scope === 'STORE'
        ? 'Store Stock Only'
        : meta.scope === 'MIXED'
          ? 'Custom Per-Shop Scope'
          : 'All (Shop + Store)';

  const bannerColor =
    meta.scope === 'SHOP'
      ? COLORS.emerald
      : meta.scope === 'STORE'
        ? COLORS.violet
        : meta.scope === 'MIXED'
          ? COLORS.navy
          : COLORS.blueDark;

  const filterNotes: string[] = [];
  if (meta.lowStockOnly) filterNotes.push('Low Stock Only');
  if (meta.searchQuery && meta.searchQuery.trim()) {
    filterNotes.push(`Search: "${meta.searchQuery.trim()}"`);
  }

  const totalShopQty = rows.reduce((sum, r) => sum + Number(r.shopQty || 0), 0);
  const totalStoreQty = rows.reduce((sum, r) => sum + Number(r.storeQty || 0), 0);
  const totalActiveQty = rows.reduce((sum, r) => sum + Number(r.activeQty || 0), 0);
  const totalBuyValue = rows.reduce((sum, r) => sum + Number(r.buyValue || 0), 0);
  const totalSellValue = rows.reduce((sum, r) => sum + Number(r.sellValue || 0), 0);
  const totalPotentialProfit = totalSellValue - totalBuyValue;

  let y = drawBanner(
    doc,
    scopeTitle,
    `${biz} | ${meta.shopLabel}`,
    [
      `Scope: ${scopeBadge}`,
      `Generated: ${new Date().toLocaleString()}`,
      filterNotes.length > 0 ? `Filters: ${filterNotes.join(' | ')}` : `Total Products: ${rows.length}`,
    ],
    bannerColor
  );

  y = drawMetaStrip(doc, y, [
    { label: 'Inventory Scope', value: scopeBadge },
    { label: 'Shop Selection', value: meta.shopLabel },
    {
      label: 'Active Filters',
      value: filterNotes.length > 0 ? filterNotes.join(' | ') : 'None (Full Stock List)',
    },
    { label: 'Potential Profit', value: formatCurrency(totalPotentialProfit, symbol) },
  ]);

  y = drawKpiRow(doc, y, [
    {
      label: 'Total SKUs',
      value: `${rows.length.toLocaleString()} items`,
      color: COLORS.navy,
    },
    {
      label:
        meta.scope === 'SHOP'
          ? 'Shop Units'
          : meta.scope === 'STORE'
            ? 'Store Units'
            : 'Total Units',
      value:
        meta.scope === 'ALL'
          ? `${formatQtyCompact(totalActiveQty)} (Sh:${formatQtyCompact(totalShopQty)} | St:${formatQtyCompact(totalStoreQty)})`
          : `${formatQtyCompact(totalActiveQty)} units`,
      color: COLORS.blue,
    },
    {
      label: 'Total Buy Value',
      value: formatCurrency(totalBuyValue, symbol),
      color: COLORS.violet,
    },
    {
      label: 'Total Selling Value',
      value: formatCurrency(totalSellValue, symbol),
      color: COLORS.emerald,
    },
  ]);

  if (meta.scope === 'SHOP') {
    const body = rows.map((r, idx) => [
      String(idx + 1),
      pdfSafe(r.shopName),
      pdfSafe(r.variation ? `${r.productName}\n(${r.variation})` : r.productName),
      pdfSafe(r.sku || '-'),
      `${formatQtyCompact(r.shopQty)} ${pdfSafe(r.unit)}`,
      formatQtyCompact(r.minStock),
      pdfSafe(formatCurrency(r.purchasePrice, symbol)),
      pdfSafe(formatCurrency(r.sellingPrice, symbol)),
      pdfSafe(formatCurrency(r.buyValue, symbol)),
      pdfSafe(formatCurrency(r.sellValue, symbol)),
      r.status,
    ]);

    const foot = [
      [
        '',
        'TOTAL',
        `${rows.length} product(s)`,
        '',
        formatQtyCompact(totalActiveQty),
        '',
        '',
        '',
        pdfSafe(formatCurrency(totalBuyValue, symbol)),
        pdfSafe(formatCurrency(totalSellValue, symbol)),
        '',
      ],
    ];

    autoTable(doc, {
      startY: y,
      margin: { left: 12, right: 12, bottom: 16 },
      rowPageBreak: 'avoid',
      head: [
        [
          '#',
          'Shop',
          'Product & Variation',
          'SKU',
          'Shop Qty',
          'Min',
          'Buy Price',
          'Sell Price',
          'Buy Value',
          'Sell Value',
          'Status',
        ],
      ],
      body,
      foot,
      styles: {
        fontSize: 7.4,
        cellPadding: { top: 2.3, right: 2, bottom: 2.3, left: 2 },
        overflow: 'linebreak',
        lineColor: COLORS.slate200,
        lineWidth: 0.2,
        textColor: COLORS.slate900,
      },
      headStyles: { fillColor: COLORS.emerald, textColor: COLORS.white, fontStyle: 'bold' },
      footStyles: { fillColor: COLORS.emeraldBg, textColor: COLORS.navy, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        0: { cellWidth: 9, halign: 'center', textColor: COLORS.slate500 },
        1: { cellWidth: 26 },
        2: { cellWidth: 56, fontStyle: 'bold' },
        3: { cellWidth: 24, textColor: COLORS.slate700 },
        4: { cellWidth: 18, halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
        5: { cellWidth: 13, halign: 'right', textColor: COLORS.slate500 },
        6: { cellWidth: 25, halign: 'right' },
        7: { cellWidth: 25, halign: 'right' },
        8: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: COLORS.violet },
        9: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
        10: { cellWidth: 21, halign: 'center', fontStyle: 'bold' },
      },
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 10) {
          const val = String(data.cell.raw || '');
          if (val === 'OUT OF STOCK') {
            data.cell.styles.textColor = COLORS.rose;
          } else if (val === 'LOW STOCK') {
            data.cell.styles.textColor = COLORS.amber;
          } else if (val === 'IN STOCK') {
            data.cell.styles.textColor = COLORS.emerald;
          } else {
            data.cell.styles.textColor = COLORS.slate500;
          }
        }
      },
    });
  } else if (meta.scope === 'STORE') {
    const body = rows.map((r, idx) => [
      String(idx + 1),
      pdfSafe(r.shopName),
      pdfSafe(r.variation ? `${r.productName}\n(${r.variation})` : r.productName),
      pdfSafe(r.sku || '-'),
      `${formatQtyCompact(r.storeQty)} ${pdfSafe(r.unit)}`,
      pdfSafe(r.storeBreakdown || 'Store Stock'),
      pdfSafe(formatCurrency(r.purchasePrice, symbol)),
      pdfSafe(formatCurrency(r.sellingPrice, symbol)),
      pdfSafe(formatCurrency(r.buyValue, symbol)),
      pdfSafe(formatCurrency(r.sellValue, symbol)),
    ]);

    const foot = [
      [
        '',
        'TOTAL',
        `${rows.length} product(s)`,
        '',
        formatQtyCompact(totalActiveQty),
        '',
        '',
        '',
        pdfSafe(formatCurrency(totalBuyValue, symbol)),
        pdfSafe(formatCurrency(totalSellValue, symbol)),
      ],
    ];

    autoTable(doc, {
      startY: y,
      margin: { left: 12, right: 12, bottom: 16 },
      rowPageBreak: 'avoid',
      head: [
        [
          '#',
          'Shop',
          'Product & Variation',
          'SKU',
          'Store Qty',
          'Warehouse Breakdown',
          'Buy Price',
          'Sell Price',
          'Buy Value',
          'Sell Value',
        ],
      ],
      body,
      foot,
      styles: {
        fontSize: 7.4,
        cellPadding: { top: 2.3, right: 2, bottom: 2.3, left: 2 },
        overflow: 'linebreak',
        lineColor: COLORS.slate200,
        lineWidth: 0.2,
        textColor: COLORS.slate900,
      },
      headStyles: { fillColor: COLORS.violet, textColor: COLORS.white, fontStyle: 'bold' },
      footStyles: { fillColor: [237, 233, 254], textColor: COLORS.navy, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        0: { cellWidth: 9, halign: 'center', textColor: COLORS.slate500 },
        1: { cellWidth: 25 },
        2: { cellWidth: 50, fontStyle: 'bold' },
        3: { cellWidth: 22, textColor: COLORS.slate700 },
        4: { cellWidth: 18, halign: 'right', fontStyle: 'bold', textColor: COLORS.violet },
        5: { cellWidth: 41, textColor: COLORS.slate700 },
        6: { cellWidth: 24, halign: 'right' },
        7: { cellWidth: 24, halign: 'right' },
        8: { cellWidth: 30, halign: 'right', fontStyle: 'bold', textColor: COLORS.violet },
        9: { cellWidth: 30, halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
      },
    });
  } else {
    // ALL or MIXED
    const isMixed = meta.scope === 'MIXED';
    const body = rows.map((r, idx) => [
      String(idx + 1),
      pdfSafe(isMixed ? `${r.shopName} [${r.rowScope}]` : r.shopName),
      pdfSafe(r.variation ? `${r.productName}\n(${r.variation})` : r.productName),
      pdfSafe(r.sku || '-'),
      formatQtyCompact(r.shopQty),
      formatQtyCompact(r.storeQty),
      `${formatQtyCompact(r.activeQty)} ${pdfSafe(r.unit)}`,
      pdfSafe(formatCurrency(r.purchasePrice, symbol)),
      pdfSafe(formatCurrency(r.sellingPrice, symbol)),
      pdfSafe(formatCurrency(r.buyValue, symbol)),
      pdfSafe(formatCurrency(r.sellValue, symbol)),
      r.status,
    ]);

    const foot = [
      [
        '',
        'TOTAL',
        `${rows.length} product(s)`,
        '',
        formatQtyCompact(totalShopQty),
        formatQtyCompact(totalStoreQty),
        formatQtyCompact(totalActiveQty),
        '',
        '',
        pdfSafe(formatCurrency(totalBuyValue, symbol)),
        pdfSafe(formatCurrency(totalSellValue, symbol)),
        '',
      ],
    ];

    autoTable(doc, {
      startY: y,
      margin: { left: 12, right: 12, bottom: 16 },
      rowPageBreak: 'avoid',
      head: [
        [
          '#',
          isMixed ? 'Shop [Scope]' : 'Shop',
          'Product & Variation',
          'SKU',
          'Shop Qty',
          'Store Qty',
          isMixed ? 'Active Qty' : 'Total Qty',
          'Buy Price',
          'Sell Price',
          'Buy Value',
          'Sell Value',
          'Status',
        ],
      ],
      body,
      foot,
      styles: {
        fontSize: 7.3,
        cellPadding: { top: 2.2, right: 1.8, bottom: 2.2, left: 1.8 },
        overflow: 'linebreak',
        lineColor: COLORS.slate200,
        lineWidth: 0.2,
        textColor: COLORS.slate900,
      },
      headStyles: { fillColor: COLORS.navy, textColor: COLORS.white, fontStyle: 'bold' },
      footStyles: { fillColor: [239, 246, 255], textColor: COLORS.blueDark, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: COLORS.slate50 },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center', textColor: COLORS.slate500 },
        1: { cellWidth: 24 },
        2: { cellWidth: 48, fontStyle: 'bold' },
        3: { cellWidth: 21, textColor: COLORS.slate700 },
        4: { cellWidth: 16, halign: 'right', textColor: COLORS.emerald, fontStyle: 'bold' },
        5: { cellWidth: 16, halign: 'right', textColor: COLORS.violet, fontStyle: 'bold' },
        6: { cellWidth: 17, halign: 'right', fontStyle: 'bold', textColor: COLORS.blueDark },
        7: { cellWidth: 23, halign: 'right' },
        8: { cellWidth: 23, halign: 'right' },
        9: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: COLORS.violet },
        10: { cellWidth: 28, halign: 'right', fontStyle: 'bold', textColor: COLORS.emerald },
        11: { cellWidth: 21, halign: 'center', fontStyle: 'bold' },
      },
      didParseCell: data => {
        if (data.section === 'body' && data.column.index === 11) {
          const val = String(data.cell.raw || '');
          if (val === 'OUT OF STOCK') {
            data.cell.styles.textColor = COLORS.rose;
          } else if (val === 'LOW STOCK') {
            data.cell.styles.textColor = COLORS.amber;
          } else if (val === 'IN STOCK') {
            data.cell.styles.textColor = COLORS.emerald;
          } else {
            data.cell.styles.textColor = COLORS.slate500;
          }
        }
      },
    });
  }

  applyPageFooters(doc, `${biz} - ${scopeTitle} (${meta.shopLabel})`);
  return doc;
}

export async function downloadInventoryReportPdf(
  rows: InventoryExportRow[],
  settings: BusinessSettings,
  meta: InventoryExportMeta
): Promise<boolean> {
  const doc = buildInventoryReportPdfDoc(rows, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  const scopeSlug =
    meta.scope === 'SHOP'
      ? 'shop'
      : meta.scope === 'STORE'
        ? 'store'
        : meta.scope === 'MIXED'
          ? 'filtered'
          : 'all';
  return triggerPdfDownload(doc, `inventory_${scopeSlug}_${meta.shopLabel}_${stamp}.pdf`);
}

export async function printInventoryReportPdf(
  rows: InventoryExportRow[],
  settings: BusinessSettings,
  meta: InventoryExportMeta
): Promise<PrintPdfResult> {
  const doc = buildInventoryReportPdfDoc(rows, settings, meta);
  const stamp = new Date().toISOString().slice(0, 10);
  const scopeSlug =
    meta.scope === 'SHOP'
      ? 'shop'
      : meta.scope === 'STORE'
        ? 'store'
        : meta.scope === 'MIXED'
          ? 'filtered'
          : 'all';
  const scopeTitle =
    meta.scope === 'SHOP'
      ? 'Shop Inventory'
      : meta.scope === 'STORE'
        ? 'Store Inventory'
        : 'All Inventory';
  return triggerPdfPrint(
    doc,
    `${scopeTitle} - ${meta.shopLabel} (${stamp})`,
    `inventory_${scopeSlug}_${meta.shopLabel}_${stamp}.pdf`,
    { orientation: 'landscape', paperSize: 'a4' }
  );
}


