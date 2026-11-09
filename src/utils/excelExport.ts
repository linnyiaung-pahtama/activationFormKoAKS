import * as XLSX from 'xlsx';
import {
  NoodleActivationRecord,
  PricingMode,
  SkuDefinition,
} from '../types';
import { BRANCH_OPTIONS, getRecordBranch } from './branchHelper';

export interface SkuSummaryRow {
  id: string;
  code: string;
  name: string;
  myanmarSubName: string;
  packSpec: string;
  defaultLdpPrice: number;
  avgRealizedPrice: number;
  priceDelta: number;
  ordersCount: number;
  manualPriceOrders: number;
  paidQty: number;
  focQty: number;
  revenueMmk: number;
  sharePct: number;
  focRatioPct: number;
}

export interface ItemizedSkuExportRow {
  'Row ID': string;
  'Activation ID': string;
  'Invoice No': string;
  'Activation Date': string;
  Branch: string;
  'Region Scope': string;
  'Route Code': string;
  'Seller Username': string;
  'Seller Name': string;
  Supervisor: string;
  Manager: string;
  'Wholesale Store Name': string;
  'PG Cover': string;
  'Retailer Store Name': string;
  'Outlet Type': string;
  'Phone Number': string;
  'Address No': string;
  Street: string;
  Ward: string;
  Township: string;
  'Full Address': string;
  'Sales Status': string;
  'Non-Covered Reason': string;
  'Pricing Mode': string;
  'SKU ID': string;
  'SKU Code': string;
  'SKU Name': string;
  'Myanmar Name': string;
  'Pack Spec': string;
  'Unit Price (MMK)': number;
  'Paid Qty': number;
  'FOC Qty (0 MMK)': number;
  'Total Qty': number;
  'Line Total (MMK)': number;
  Remarks: string;
}

export function buildSkuBreakdown(
  records: NoodleActivationRecord[],
  skus: SkuDefinition[]
): SkuSummaryRow[] {
  const allSkuRevenue = records.reduce(
    (sum, r) => sum + (r.salesStatus ? r.grandTotalMmk : 0),
    0
  );

  return skus.map((sku) => {
    let paidQty = 0;
    let focQty = 0;
    let revenueMmk = 0;
    let ordersCount = 0;
    let manualPriceOrders = 0;

    records.forEach((rec) => {
      if (!rec.salesStatus) return;
      const line = rec.items.find((i) => i.skuId === sku.id);
      if (line) {
        paidQty += line.quantity;
        focQty += line.focQuantity;
        revenueMmk += line.lineTotal;
        if (line.quantity > 0 || line.focQuantity > 0) {
          ordersCount += 1;
        }
        if (
          rec.pricingMode === PricingMode.MANUAL_WHOLESALE &&
          line.quantity > 0
        ) {
          manualPriceOrders += 1;
        }
      }
    });

    const avgRealizedPrice =
      paidQty > 0 ? Math.round(revenueMmk / paidQty) : sku.defaultLdpPrice;
    const priceDelta = avgRealizedPrice - sku.defaultLdpPrice;
    const sharePct =
      allSkuRevenue > 0 ? Math.round((revenueMmk / allSkuRevenue) * 100) : 0;
    const focRatioPct =
      paidQty + focQty > 0
        ? Math.round((focQty / (paidQty + focQty)) * 100)
        : 0;

    return {
      ...sku,
      paidQty,
      focQty,
      revenueMmk,
      ordersCount,
      manualPriceOrders,
      avgRealizedPrice,
      priceDelta,
      sharePct,
      focRatioPct,
    };
  });
}

/**
 * Builds normalized Itemized SKU Rows (1 row per active SKU line item per invoice,
 * plus 1 survey row for non-sales visits when no specific SKU filter is active),
 * matching the `public.noodle_activation_sku_details` / `public.v_itemized_sku_export` SQL schema.
 */
export function buildItemizedSkuExportRows(
  records: NoodleActivationRecord[],
  skus: SkuDefinition[],
  selectedSkuSlice = 'ALL'
): ItemizedSkuExportRow[] {
  const skuMap = new Map<string, SkuDefinition>();
  skus.forEach((s) => skuMap.set(s.id, s));

  const itemizedRows: ItemizedSkuExportRow[] = [];

  for (const rec of records) {
    const branchName = rec.branch || getRecordBranch(rec);
    const pricingLabel =
      rec.pricingMode === PricingMode.COMPANY_LDP
        ? 'Company LTP Price'
        : 'Manual Wholesale Store Price';

    const activeLines = rec.salesStatus
      ? rec.items.filter((item) => {
          const hasQty = item.quantity > 0 || item.focQuantity > 0;
          if (!hasQty) return false;
          if (selectedSkuSlice !== 'ALL' && item.skuId !== selectedSkuSlice) {
            return false;
          }
          return true;
        })
      : [];

    if (rec.salesStatus && activeLines.length > 0) {
      for (const line of activeLines) {
        const skuDef = skuMap.get(line.skuId);
        itemizedRows.push({
          'Row ID': `${rec.id}_${line.skuId}`,
          'Activation ID': rec.id,
          'Invoice No': rec.invoiceNo,
          'Activation Date': rec.activationDate,
          Branch: branchName,
          'Region Scope': rec.regionScope,
          'Route Code': rec.routeCode,
          'Seller Username': rec.sellerUsername,
          'Seller Name': rec.sellerName,
          Supervisor: rec.supervisorUsername || '',
          Manager: rec.managerUsername || '',
          'Wholesale Store Name': rec.wholesaleStoreName,
          'PG Cover': rec.pgCover,
          'Retailer Store Name': rec.retailerStoreName,
          'Outlet Type': rec.outletType,
          'Phone Number': rec.phoneNumber,
          'Address No': rec.addressNo,
          Street: rec.addressStreet,
          Ward: rec.addressWard,
          Township: rec.township,
          'Full Address': rec.fullAddress,
          'Sales Status': 'Yes',
          'Non-Covered Reason': '-',
          'Pricing Mode': pricingLabel,
          'SKU ID': line.skuId,
          'SKU Code': skuDef?.code || line.skuId,
          'SKU Name': line.skuName || skuDef?.name || line.skuId,
          'Myanmar Name': skuDef?.myanmarSubName || '',
          'Pack Spec': skuDef?.packSpec || '1x30pcs',
          'Unit Price (MMK)': line.unitPrice,
          'Paid Qty': line.quantity,
          'FOC Qty (0 MMK)': line.focQuantity,
          'Total Qty': line.quantity + line.focQuantity,
          'Line Total (MMK)': line.lineTotal,
          Remarks: rec.remarks || '',
        });
      }
    } else if (!rec.salesStatus && selectedSkuSlice === 'ALL') {
      itemizedRows.push({
        'Row ID': `${rec.id}_no_sale`,
        'Activation ID': rec.id,
        'Invoice No': rec.invoiceNo,
        'Activation Date': rec.activationDate,
        Branch: branchName,
        'Region Scope': rec.regionScope,
        'Route Code': rec.routeCode,
        'Seller Username': rec.sellerUsername,
        'Seller Name': rec.sellerName,
        Supervisor: rec.supervisorUsername || '',
        Manager: rec.managerUsername || '',
        'Wholesale Store Name': rec.wholesaleStoreName,
        'PG Cover': rec.pgCover,
        'Retailer Store Name': rec.retailerStoreName,
        'Outlet Type': rec.outletType,
        'Phone Number': rec.phoneNumber,
        'Address No': rec.addressNo,
        Street: rec.addressStreet,
        Ward: rec.addressWard,
        Township: rec.township,
        'Full Address': rec.fullAddress,
        'Sales Status': 'No',
        'Non-Covered Reason': rec.nonCoveredReason || 'Recorded Visit',
        'Pricing Mode': pricingLabel,
        'SKU ID': 'none',
        'SKU Code': '-',
        'SKU Name': 'No SKU Sold (Non-Sales Visit)',
        'Myanmar Name': '-',
        'Pack Spec': '-',
        'Unit Price (MMK)': 0,
        'Paid Qty': 0,
        'FOC Qty (0 MMK)': 0,
        'Total Qty': 0,
        'Line Total (MMK)': 0,
        Remarks: rec.remarks || rec.nonCoveredReason || '',
      });
    }
  }

  return itemizedRows;
}

/**
 * Exports normalized Itemized SKU Rows directly as a UTF-8 BOM CSV file
 * (preserving Burmese script legibly when opened in Microsoft Excel).
 */
export function exportItemizedSkuRowsToCsv(
  records: NoodleActivationRecord[],
  skus: SkuDefinition[],
  selectedSkuSlice = 'ALL'
): void {
  const itemizedRows = buildItemizedSkuExportRows(
    records,
    skus,
    selectedSkuSlice
  );

  const headers: (keyof ItemizedSkuExportRow)[] = [
    'Row ID',
    'Activation ID',
    'Invoice No',
    'Activation Date',
    'Branch',
    'Region Scope',
    'Route Code',
    'Seller Username',
    'Seller Name',
    'Supervisor',
    'Manager',
    'Wholesale Store Name',
    'PG Cover',
    'Retailer Store Name',
    'Outlet Type',
    'Phone Number',
    'Address No',
    'Street',
    'Ward',
    'Township',
    'Full Address',
    'Sales Status',
    'Non-Covered Reason',
    'Pricing Mode',
    'SKU ID',
    'SKU Code',
    'SKU Name',
    'Myanmar Name',
    'Pack Spec',
    'Unit Price (MMK)',
    'Paid Qty',
    'FOC Qty (0 MMK)',
    'Total Qty',
    'Line Total (MMK)',
    'Remarks',
  ];

  const escapeCsv = (val: string | number | undefined) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = itemizedRows.map((row) =>
    headers.map((h) => escapeCsv(row[h])).join(',')
  );

  const csvContent = '\uFEFF' + [headers.join(','), ...csvLines].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute(
    'download',
    `Pahtama_Itemized_SKU_Rows_${new Date().toISOString().split('T')[0]}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports a 4-sheet Excel (.xlsx) workbook:
 * - Sheet 1: "Overview Summary"
 * - Sheet 2: "Raw Activations"
 * - Sheet 3: "Itemized SKU Rows" (Normalized SKU line items matching `noodle_activation_sku_details`)
 * - Sheet 4: "SKU Performance"
 */
export function exportActivationsToExcel(
  records: NoodleActivationRecord[],
  skus: SkuDefinition[],
  customSkuBreakdown?: SkuSummaryRow[],
  selectedSkuSlice = 'ALL'
): void {
  const skuBreakdown = customSkuBreakdown ?? buildSkuBreakdown(records, skus);
  const itemizedSkuRows = buildItemizedSkuExportRows(
    records,
    skus,
    selectedSkuSlice
  );
  const wb = XLSX.utils.book_new();

  // ==========================================================================
  // SHEET 1: Overview Summary
  // ==========================================================================
  const totalActivations = records.length;
  const totalSalesOrders = records.filter((r) => r.salesStatus).length;
  const totalNonCovered = totalActivations - totalSalesOrders;
  const conversionRate =
    totalActivations > 0
      ? Math.round((totalSalesOrders / totalActivations) * 100)
      : 0;
  const totalNetRevenue = records.reduce(
    (s, r) => s + (r.salesStatus ? r.grandTotalMmk : 0),
    0
  );
  const totalPaidPacks = records.reduce(
    (s, r) => s + (r.salesStatus ? r.totalPaidQty : 0),
    0
  );
  const totalFocPacks = records.reduce(
    (s, r) => s + (r.salesStatus ? r.totalFocQty : 0),
    0
  );
  const avgOrderValue =
    totalSalesOrders > 0 ? Math.round(totalNetRevenue / totalSalesOrders) : 0;

  const overviewRows: Record<string, string | number>[] = [
    {
      Section: 'Executive KPI Summary',
      Metric: 'Total Activations (Outlets Visited)',
      Value: totalActivations,
      Unit: 'Outlets',
      Notes: `${totalSalesOrders} with SKU orders, ${totalNonCovered} survey-only`,
    },
    {
      Section: 'Executive KPI Summary',
      Metric: 'Itemized SKU Line Rows',
      Value: itemizedSkuRows.length,
      Unit: 'Rows',
      Notes: 'Normalized SKU rows in "Itemized SKU Rows" sheet',
    },
    {
      Section: 'Executive KPI Summary',
      Metric: 'Total Net Revenue',
      Value: totalNetRevenue,
      Unit: 'MMK',
      Notes: 'Paid SKU quantities only (FOC locked at 0 MMK)',
    },
    {
      Section: 'Executive KPI Summary',
      Metric: 'Total Paid Packs',
      Value: totalPaidPacks,
      Unit: 'Packs',
      Notes: 'Across all active Shaloot SKUs',
    },
    {
      Section: 'Executive KPI Summary',
      Metric: 'Total FOC Giveaway Packs',
      Value: totalFocPacks,
      Unit: 'Packs',
      Notes: 'Free-Of-Charge promotional sampling',
    },
    {
      Section: 'Executive KPI Summary',
      Metric: 'Average Order Value (AOV)',
      Value: avgOrderValue,
      Unit: 'MMK',
      Notes: 'Net Revenue / Active Sales Orders',
    },
    {
      Section: 'Executive KPI Summary',
      Metric: 'Sales Conversion Rate',
      Value: `${conversionRate}%`,
      Unit: '%',
      Notes: `${totalSalesOrders} / ${totalActivations} outlets converted`,
    },
  ];

  BRANCH_OPTIONS.forEach((branch) => {
    const branchRecs = records.filter((r) => getRecordBranch(r) === branch);
    const branchSales = branchRecs.filter((r) => r.salesStatus);
    const branchRev = branchSales.reduce((s, r) => s + r.grandTotalMmk, 0);
    const branchPaid = branchSales.reduce((s, r) => s + r.totalPaidQty, 0);
    const branchFoc = branchSales.reduce((s, r) => s + r.totalFocQty, 0);
    overviewRows.push({
      Section: 'Branch Breakdown',
      Metric: `${branch} Branch`,
      Value: branchRev,
      Unit: 'MMK',
      Notes: `Visits: ${branchRecs.length} | Orders: ${branchSales.length} | Paid: ${branchPaid} | FOC: ${branchFoc}`,
    });
  });

  const wsOverview = XLSX.utils.json_to_sheet(overviewRows);
  wsOverview['!cols'] = [
    { wch: 24 },
    { wch: 34 },
    { wch: 18 },
    { wch: 12 },
    { wch: 56 },
  ];
  XLSX.utils.book_append_sheet(wb, wsOverview, 'Overview Summary');

  // ==========================================================================
  // SHEET 2: Raw Activations
  // ==========================================================================
  const rawRows: Record<string, string | number>[] =
    records.length > 0
      ? records.map((rec) => {
          const baseRow: Record<string, string | number> = {
            'Invoice No': rec.invoiceNo,
            'Activation Date': rec.activationDate,
            Branch: rec.branch || getRecordBranch(rec),
            'Seller Username': rec.sellerUsername,
            'Seller Name': rec.sellerName,
            'Route Code': rec.routeCode,
            Supervisor: rec.supervisorUsername,
            Manager: rec.managerUsername,
            'Region Scope': rec.regionScope,
            'Wholesale Store Name': rec.wholesaleStoreName,
            'PG Cover': rec.pgCover,
            'Retailer Store Name': rec.retailerStoreName,
            'Outlet Type': rec.outletType,
            'Phone Number': rec.phoneNumber,
            'Address No': rec.addressNo,
            Street: rec.addressStreet,
            Ward: rec.addressWard,
            Township: rec.township,
            'Full Address': rec.fullAddress,
            'Sales Status': rec.salesStatus ? 'Yes' : 'No',
            'Non-Covered Reason': rec.salesStatus
              ? '-'
              : rec.nonCoveredReason || '-',
            'Pricing Mode':
              rec.pricingMode === PricingMode.COMPANY_LDP
                ? 'Company LTP Price'
                : 'Manual Wholesale Store Price',
          };

          skus.forEach((sku) => {
            const line = rec.items.find((i) => i.skuId === sku.id);
            const shortLabel = sku.name.replace(/^Shaloot Noodle\s+/i, '');
            baseRow[`${shortLabel} Paid Qty`] = rec.salesStatus
              ? (line?.quantity ?? 0)
              : 0;
            baseRow[`${shortLabel} Unit Price (MMK)`] =
              line?.unitPrice ?? sku.defaultLdpPrice;
            baseRow[`${shortLabel} FOC Qty (0 MMK)`] = rec.salesStatus
              ? (line?.focQuantity ?? 0)
              : 0;
            baseRow[`${shortLabel} Line Total (MMK)`] = rec.salesStatus
              ? (line?.lineTotal ?? 0)
              : 0;
          });

          baseRow['Total Paid Qty'] = rec.totalPaidQty;
          baseRow['Total FOC Qty'] = rec.totalFocQty;
          baseRow['Grand Total (MMK)'] = rec.grandTotalMmk;
          baseRow['Remarks'] = rec.remarks || '';

          return baseRow;
        })
      : [
          {
            'Invoice No': '-',
            'Activation Date': '-',
            Branch: '-',
            'Seller Username': '-',
            'Retailer Store Name': 'No records in current filter',
            'Total Paid Qty': 0,
            'Total FOC Qty': 0,
            'Grand Total (MMK)': 0,
          },
        ];

  const wsRaw = XLSX.utils.json_to_sheet(rawRows);
  wsRaw['!cols'] = Object.keys(rawRows[0] || {}).map((key) => ({
    wch: Math.max(key.length + 4, 16),
  }));
  XLSX.utils.book_append_sheet(wb, wsRaw, 'Raw Activations');

  // ==========================================================================
  // SHEET 3: Itemized SKU Rows (Normalized `noodle_activation_sku_details` View)
  // ==========================================================================
  const itemizedSheetData: Record<string, string | number>[] =
    itemizedSkuRows.length > 0
      ? (itemizedSkuRows as unknown as Record<string, string | number>[])
      : [
          {
            'Row ID': '-',
            'Activation ID': '-',
            'Invoice No': '-',
            'Activation Date': '-',
            Branch: '-',
            'Route Code': '-',
            'Seller Username': '-',
            'Retailer Store Name': 'No itemized SKU rows in current filter',
            'SKU Code': '-',
            'SKU Name': '-',
            'Unit Price (MMK)': 0,
            'Paid Qty': 0,
            'FOC Qty (0 MMK)': 0,
            'Total Qty': 0,
            'Line Total (MMK)': 0,
          },
        ];

  const wsItemized = XLSX.utils.json_to_sheet(itemizedSheetData);
  wsItemized['!cols'] = Object.keys(itemizedSheetData[0] || {}).map((key) => ({
    wch: Math.max(key.length + 5, 16),
  }));
  XLSX.utils.book_append_sheet(wb, wsItemized, 'Itemized SKU Rows');

  // ==========================================================================
  // SHEET 4: SKU Performance
  // ==========================================================================
  const totalPaidAllSkus = skuBreakdown.reduce((s, r) => s + r.paidQty, 0);
  const totalFocAllSkus = skuBreakdown.reduce((s, r) => s + r.focQty, 0);
  const totalCombinedAllSkus = totalPaidAllSkus + totalFocAllSkus;
  const totalRevAllSkus = skuBreakdown.reduce((s, r) => s + r.revenueMmk, 0);
  const totalOrdersAllSkus = skuBreakdown.reduce(
    (s, r) => s + r.ordersCount,
    0
  );
  const totalManualAllSkus = skuBreakdown.reduce(
    (s, r) => s + r.manualPriceOrders,
    0
  );

  const skuPerfRows: Record<string, string | number>[] = skuBreakdown.map(
    (s, index) => ({
      'No.': index + 1,
      'SKU Code': s.code,
      'SKU Name': s.name,
      'Myanmar Name': s.myanmarSubName,
      'Pack Spec': s.packSpec,
      'Standard LTP Price (MMK)': s.defaultLdpPrice,
      'Avg Realized Price (MMK)': s.avgRealizedPrice,
      'Price Variance vs LTP (MMK)': s.priceDelta,
      'Orders with SKU': s.ordersCount,
      'Manual Wholesale Price Orders': s.manualPriceOrders,
      'Total Paid Qty': s.paidQty,
      'Total FOC Qty (0 MMK)': s.focQty,
      'Total Combined Qty': s.paidQty + s.focQty,
      'FOC Ratio (%)': `${s.focRatioPct}%`,
      'Total Revenue (MMK)': s.revenueMmk,
      'Revenue Share (%)': `${s.sharePct}%`,
    })
  );

  skuPerfRows.push({
    'No.': 'TOTAL',
    'SKU Code': '-',
    'SKU Name': `All ${skuBreakdown.length} SKUs Combined`,
    'Myanmar Name': '-',
    'Pack Spec': '-',
    'Standard LTP Price (MMK)': '-',
    'Avg Realized Price (MMK)':
      totalPaidAllSkus > 0
        ? Math.round(totalRevAllSkus / totalPaidAllSkus)
        : 0,
    'Price Variance vs LTP (MMK)': '-',
    'Orders with SKU': totalOrdersAllSkus,
    'Manual Wholesale Price Orders': totalManualAllSkus,
    'Total Paid Qty': totalPaidAllSkus,
    'Total FOC Qty (0 MMK)': totalFocAllSkus,
    'Total Combined Qty': totalCombinedAllSkus,
    'FOC Ratio (%)':
      totalCombinedAllSkus > 0
        ? `${Math.round((totalFocAllSkus / totalCombinedAllSkus) * 100)}%`
        : '0%',
    'Total Revenue (MMK)': totalRevAllSkus,
    'Revenue Share (%)': totalRevAllSkus > 0 ? '100%' : '0%',
  });

  const wsSkuPerf = XLSX.utils.json_to_sheet(skuPerfRows);
  wsSkuPerf['!cols'] = [
    { wch: 8 },
    { wch: 14 },
    { wch: 38 },
    { wch: 30 },
    { wch: 14 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
    { wch: 16 },
    { wch: 26 },
    { wch: 16 },
    { wch: 20 },
    { wch: 18 },
    { wch: 14 },
    { wch: 20 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, wsSkuPerf, 'SKU Performance');

  const dateStamp = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Pahtama_Shaloot_Activations_${dateStamp}.xlsx`);
}
