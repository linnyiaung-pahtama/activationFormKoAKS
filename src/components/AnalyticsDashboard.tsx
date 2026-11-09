import React, { useState, useMemo } from 'react';
import {
  AllCommunityModule,
  ColDef,
  ICellRendererParams,
  ModuleRegistry,
  themeQuartz,
} from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import {
  Download,
  Printer,
  Search,
  Trash2,
  FileSpreadsheet,
  Calendar,
  Layers,
  RotateCcw,
  Plus,
  Edit3,
  Inbox,
  MapPin,
} from 'lucide-react';
import {
  NoodleActivationRecord,
  PricingMode,
  SkuDefinition,
  UserAccount,
  UserRole,
} from '../types';
import {
  exportActivationsToExcel,
  exportItemizedSkuRowsToCsv,
} from '../utils/excelExport';
import { BRANCH_OPTIONS, getRecordBranch } from '../utils/branchHelper';

ModuleRegistry.registerModules([AllCommunityModule]);

type SkuSliceOption = string;
type BreakdownViewMode = 'REVENUE_AND_QTY' | 'PAID_VS_FOC' | 'PRICE_VARIANCE';

interface AnalyticsDashboardProps {
  currentUser: UserAccount;
  records: NoodleActivationRecord[];
  skus: SkuDefinition[];
  isDarkTheme?: boolean;
  onOpenInvoicePreview: (record: NoodleActivationRecord) => void;
  onEditRecord?: (record: NoodleActivationRecord) => void;
  onDeleteRecord: (id: string) => Promise<void>;
  onNavigateToForm: () => void;
  onOpenProductMaster: () => void;
}

const lightGridTheme = themeQuartz.withParams({
  backgroundColor: '#FFFFFF',
  foregroundColor: '#0F2C59',
  headerBackgroundColor: '#F8FAFC',
  headerTextColor: '#0F2C59',
  borderColor: '#E2E8F0',
  oddRowBackgroundColor: '#FCFDFE',
  rowHoverColor: '#F1F5F9',
});

const darkGridTheme = themeQuartz.withParams({
  backgroundColor: '#152A47',
  foregroundColor: '#F8FAFC',
  headerBackgroundColor: '#0E2038',
  headerTextColor: '#E2E8F0',
  borderColor: '#2D4D77',
  oddRowBackgroundColor: '#122540',
  rowHoverColor: '#1E3E62',
});

export const AnalyticsDashboard: React.FC<AnalyticsDashboardProps> = ({
  currentUser,
  records,
  skus,
  isDarkTheme = false,
  onOpenInvoicePreview,
  onEditRecord,
  onDeleteRecord,
  onNavigateToForm,
  onOpenProductMaster,
}) => {
  const todayStr = new Date().toISOString().split('T')[0];

  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [datePreset, setDatePreset] = useState<
    'ALL' | 'TODAY' | 'LAST_7' | 'THIS_MONTH' | 'CUSTOM'
  >('ALL');

  const [selectedSkuSlice, setSelectedSkuSlice] =
    useState<SkuSliceOption>('ALL');
  const [breakdownMode, setBreakdownMode] =
    useState<BreakdownViewMode>('REVENUE_AND_QTY');

  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [salesFilter, setSalesFilter] = useState<'ALL' | 'YES' | 'NO'>('ALL');
  const [pricingFilter, setPricingFilter] = useState<'ALL' | PricingMode>(
    'ALL'
  );
  const [routeFilter, setRouteFilter] = useState<string>('ALL');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const branchCounts = useMemo(() => {
    const counts: Record<string, number> = {
      Yangon: 0,
      Mandalay: 0,
      Naypyitaw: 0,
      Bago: 0,
    };
    records.forEach((r) => {
      const b = getRecordBranch(r);
      if (counts[b] !== undefined) {
        counts[b]++;
      }
    });
    return counts;
  }, [records]);

  const uniqueRoutes = useMemo(() => {
    const set = new Set<string>(records.map((r) => r.routeCode));
    return Array.from(set).sort();
  }, [records]);

  const applyDatePreset = (
    preset: 'ALL' | 'TODAY' | 'LAST_7' | 'THIS_MONTH' | 'CUSTOM'
  ) => {
    setDatePreset(preset);
    if (preset === 'ALL') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'TODAY') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === 'LAST_7') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (preset === 'THIS_MONTH') {
      const firstOfMonth = `${todayStr.slice(0, 7)}-01`;
      setStartDate(firstOfMonth);
      setEndDate(todayStr);
    }
  };

  const filteredRecords = useMemo(() => {
    return records.filter((rec) => {
      if (selectedBranch !== 'ALL' && getRecordBranch(rec) !== selectedBranch) {
        return false;
      }
      if (startDate && rec.activationDate < startDate) {
        return false;
      }
      if (endDate && rec.activationDate > endDate) {
        return false;
      }
      if (salesFilter === 'YES' && !rec.salesStatus) {
        return false;
      }
      if (salesFilter === 'NO' && rec.salesStatus) {
        return false;
      }
      if (pricingFilter !== 'ALL' && rec.pricingMode !== pricingFilter) {
        return false;
      }
      if (routeFilter !== 'ALL' && rec.routeCode !== routeFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchStore = rec.wholesaleStoreName.toLowerCase().includes(q);
        const matchRetailer = rec.retailerStoreName.toLowerCase().includes(q);
        const matchType = rec.outletType.toLowerCase().includes(q);
        const matchPhone = rec.phoneNumber.toLowerCase().includes(q);
        const matchAddr = rec.fullAddress.toLowerCase().includes(q);
        const matchInvoice = rec.invoiceNo.toLowerCase().includes(q);
        const matchBranch = (rec.branch || getRecordBranch(rec))
          .toLowerCase()
          .includes(q);
        const matchSeller =
          rec.sellerName.toLowerCase().includes(q) ||
          rec.sellerUsername.toLowerCase().includes(q) ||
          rec.routeCode.toLowerCase().includes(q);
        if (
          !matchStore &&
          !matchRetailer &&
          !matchType &&
          !matchPhone &&
          !matchAddr &&
          !matchInvoice &&
          !matchBranch &&
          !matchSeller
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    records,
    selectedBranch,
    startDate,
    endDate,
    salesFilter,
    pricingFilter,
    routeFilter,
    searchQuery,
  ]);

  const getSlicedMetricsForRecord = (rec: NoodleActivationRecord) => {
    if (!rec.salesStatus) {
      return { paidQty: 0, focQty: 0, revenueMmk: 0, unitPrice: 0 };
    }
    if (selectedSkuSlice === 'ALL') {
      return {
        paidQty: rec.totalPaidQty,
        focQty: rec.totalFocQty,
        revenueMmk: rec.grandTotalMmk,
        unitPrice:
          rec.totalPaidQty > 0
            ? Math.round(rec.grandTotalMmk / rec.totalPaidQty)
            : 0,
      };
    }
    const skuLine = rec.items.find((i) => i.skuId === selectedSkuSlice);
    return {
      paidQty: skuLine?.quantity ?? 0,
      focQty: skuLine?.focQuantity ?? 0,
      revenueMmk: skuLine?.lineTotal ?? 0,
      unitPrice: skuLine?.unitPrice ?? 0,
    };
  };

  const summaryStats = useMemo(() => {
    const totalVisited = filteredRecords.length;
    const totalWithSales = filteredRecords.filter((r) => {
      if (!r.salesStatus) return false;
      if (selectedSkuSlice === 'ALL') return true;
      const m = getSlicedMetricsForRecord(r);
      return m.paidQty > 0 || m.focQty > 0;
    }).length;
    const salesConversionRate =
      totalVisited > 0 ? Math.round((totalWithSales / totalVisited) * 100) : 0;

    let totalRevenueMmk = 0;
    let totalPaidQty = 0;
    let totalFocQty = 0;

    filteredRecords.forEach((r) => {
      const m = getSlicedMetricsForRecord(r);
      totalRevenueMmk += m.revenueMmk;
      totalPaidQty += m.paidQty;
      totalFocQty += m.focQty;
    });

    const avgOrderValueMmk =
      totalWithSales > 0 ? Math.round(totalRevenueMmk / totalWithSales) : 0;

    return {
      totalVisited,
      totalWithSales,
      salesConversionRate,
      totalRevenueMmk,
      totalPaidQty,
      totalFocQty,
      avgOrderValueMmk,
    };
  }, [filteredRecords, selectedSkuSlice]);

  const skuBreakdown = useMemo(() => {
    const allSkuRevenue = filteredRecords.reduce(
      (sum, r) => sum + (r.salesStatus ? r.grandTotalMmk : 0),
      0
    );

    return skus.map((sku) => {
      let paidQty = 0;
      let focQty = 0;
      let revenueMmk = 0;
      let ordersCount = 0;
      let manualPriceOrders = 0;

      filteredRecords.forEach((rec) => {
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
  }, [filteredRecords, skus]);

  const sellerPerformance = useMemo(() => {
    const map = new Map<
      string,
      {
        sellerUsername: string;
        sellerName: string;
        routeCode: string;
        supervisorUsername: string;
        regionScope: string;
        visited: number;
        withSales: number;
        paidQty: number;
        focQty: number;
        revenueMmk: number;
      }
    >();

    filteredRecords.forEach((rec) => {
      const m = getSlicedMetricsForRecord(rec);
      const existing = map.get(rec.sellerUsername) || {
        sellerUsername: rec.sellerUsername,
        sellerName: rec.sellerName,
        routeCode: rec.routeCode,
        supervisorUsername: rec.supervisorUsername,
        regionScope: rec.regionScope,
        visited: 0,
        withSales: 0,
        paidQty: 0,
        focQty: 0,
        revenueMmk: 0,
      };
      existing.visited += 1;
      if (rec.salesStatus && (m.paidQty > 0 || m.focQty > 0)) {
        existing.withSales += 1;
      }
      existing.paidQty += m.paidQty;
      existing.focQty += m.focQty;
      existing.revenueMmk += m.revenueMmk;
      map.set(rec.sellerUsername, existing);
    });

    return Array.from(map.values()).sort((a, b) => b.revenueMmk - a.revenueMmk);
  }, [filteredRecords, selectedSkuSlice]);

  const agGridRows = useMemo(() => {
    return filteredRecords.map((rec) => {
      const branchName = rec.branch || getRecordBranch(rec);
      const sliced = getSlicedMetricsForRecord(rec);
      const skuSummaryText = rec.salesStatus
        ? rec.items
            .filter((i) => i.quantity > 0 || i.focQuantity > 0)
            .map(
              (i) =>
                `${i.skuName
                  .replace('Shaloot Noodle ', '')
                  .replace(' (1x30pcs)', '')}: ${i.quantity}${
                  i.focQuantity > 0 ? `+${i.focQuantity}FOC` : ''
                }`
            )
            .join(' | ') || '0 pcs'
        : `No Sale (${rec.nonCoveredReason || 'Survey'})`;

      const dynamicSkuFields: Record<string, string> = {};
      skus.forEach((sku) => {
        const line = rec.items.find((i) => i.skuId === sku.id);
        dynamicSkuFields[`sku_${sku.id}`] = rec.salesStatus
          ? `${line?.quantity ?? 0} (+${line?.focQuantity ?? 0} FOC)`
          : '-';
      });

      return {
        ...rec,
        branchName,
        skuSummaryText,
        ...dynamicSkuFields,
        slicedPaidQty: sliced.paidQty,
        slicedFocQty: sliced.focQty,
        slicedRevenueMmk: sliced.revenueMmk,
      };
    });
  }, [filteredRecords, selectedSkuSlice, skus]);

  const columnDefs = useMemo<ColDef<any>[]>(() => {
    const cols: ColDef<any>[] = [
      {
        headerName: 'Invoice No',
        field: 'invoiceNo',
        width: 155,
        pinned: 'left',
        cellClass: 'font-mono font-semibold',
      },
      {
        headerName: 'Date',
        field: 'activationDate',
        width: 115,
        cellClass: 'font-mono tabular-nums',
      },
      {
        headerName: 'Branch',
        field: 'branchName',
        width: 110,
        cellClass: 'font-semibold',
      },
      {
        headerName: 'Route',
        field: 'routeCode',
        width: 115,
        cellClass: 'font-mono font-semibold',
      },
      {
        headerName: 'Seller',
        field: 'sellerUsername',
        width: 155,
        valueFormatter: (p) =>
          p.data ? `${p.data.sellerUsername} (${p.data.sellerName})` : '',
      },
      {
        headerName: 'Retailer Name',
        field: 'retailerStoreName',
        minWidth: 165,
        flex: 1,
        cellClass: 'font-semibold',
      },
      {
        headerName: 'Outlet Type',
        field: 'outletType',
        width: 135,
      },
      {
        headerName: 'Wholesale Store',
        field: 'wholesaleStoreName',
        minWidth: 175,
        flex: 1,
      },
      {
        headerName: 'SKU Breakdown',
        field: 'skuSummaryText',
        minWidth: 230,
        flex: 1.3,
        cellClass: 'font-mono text-xs',
      },
    ];

    skus.forEach((sku) => {
      if (selectedSkuSlice === 'ALL' || selectedSkuSlice === sku.id) {
        const shortHeader = sku.name
          .replace('Shaloot Noodle ', '')
          .replace(' (1x30pcs)', '');
        cols.push({
          headerName: `${shortHeader} (+FOC)`,
          field: `sku_${sku.id}`,
          width: 150,
          type: 'rightAligned',
          cellClass: 'font-mono tabular-nums',
        });
      }
    });

    cols.push(
      {
        headerName:
          selectedSkuSlice === 'ALL' ? 'Paid Qty' : 'Selected Paid',
        field: 'slicedPaidQty',
        width: 110,
        type: 'rightAligned',
        cellClass: 'font-mono tabular-nums font-semibold',
      },
      {
        headerName: selectedSkuSlice === 'ALL' ? 'FOC Qty' : 'Selected FOC',
        field: 'slicedFocQty',
        width: 105,
        type: 'rightAligned',
        cellClass: 'font-mono tabular-nums',
      },
      {
        headerName:
          selectedSkuSlice === 'ALL'
            ? 'Grand Total (MMK)'
            : 'SKU Revenue (MMK)',
        field: 'slicedRevenueMmk',
        width: 155,
        type: 'rightAligned',
        cellClass: 'font-mono tabular-nums font-bold',
        valueFormatter: (p) =>
          `${Number(p.value || 0).toLocaleString()} MMK`,
      },
      {
        headerName: 'Actions',
        field: 'id',
        width: currentUser.role === UserRole.ADMIN ? 235 : 175,
        pinned: 'right',
        sortable: false,
        filter: false,
        cellRenderer: (params: ICellRendererParams<NoodleActivationRecord>) => {
          const rec = params.data;
          if (!rec) return null;
          const isConfirming = confirmDeleteId === rec.id;

          if (isConfirming) {
            return (
              <div className="flex items-center justify-end gap-1 h-full">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteId(null);
                    void onDeleteRecord(rec.id);
                  }}
                  className="px-2 py-1 text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded cursor-pointer whitespace-nowrap"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(null)}
                  className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            );
          }

          return (
            <div className="flex items-center justify-end gap-1.5 h-full">
              <button
                type="button"
                onClick={() => onOpenInvoicePreview(rec)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Printer className="w-3 h-3" />
                Print Invoice
              </button>
              {onEditRecord && (
                <button
                  type="button"
                  onClick={() => onEditRecord(rec)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  title="Edit activation record"
                >
                  <Edit3 className="w-3 h-3" />
                  Edit
                </button>
              )}
              {currentUser.role === UserRole.ADMIN && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteId(rec.id)}
                  className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
                  title="Delete activation record"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        },
      }
    );

    return cols;
  }, [
    selectedSkuSlice,
    skus,
    currentUser.role,
    confirmDeleteId,
    onOpenInvoicePreview,
    onEditRecord,
    onDeleteRecord,
  ]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      filter: true,
      resizable: true,
    }),
    []
  );

  const handleExportFullCsv = () => {
    const skuHeaders = skus.flatMap((sku) => {
      const shortName = sku.name.replace(/^Shaloot Noodle\s+/i, '');
      return [
        `${shortName} Paid Qty`,
        `${shortName} Price (MMK)`,
        `${shortName} FOC (0 MMK)`,
      ];
    });

    const headers = [
      'Invoice No',
      'Activation Date',
      'Branch',
      'Seller Username',
      'Seller Name',
      'Route Code',
      'Supervisor',
      'Manager',
      'Region Scope',
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
      'Sales (Yes/No)',
      'Non-Covered Reason',
      'Pricing Mode',
      ...skuHeaders,
      'Total Paid Qty',
      'Total FOC Qty',
      'Grand Total (MMK)',
      'Remarks',
    ];

    const escapeCsv = (val: string | number | boolean | undefined) => {
      const str = String(val ?? '');
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const rows = filteredRecords.map((rec) => {
      const skuValues = skus.flatMap((sku) => {
        const line = rec.items.find((i) => i.skuId === sku.id);
        return [
          rec.salesStatus ? (line?.quantity ?? 0) : 0,
          line?.unitPrice ?? sku.defaultLdpPrice,
          rec.salesStatus ? (line?.focQuantity ?? 0) : 0,
        ];
      });

      return [
        rec.invoiceNo,
        rec.activationDate,
        rec.branch || getRecordBranch(rec),
        rec.sellerUsername,
        rec.sellerName,
        rec.routeCode,
        rec.supervisorUsername,
        rec.managerUsername,
        rec.regionScope,
        rec.wholesaleStoreName,
        rec.pgCover,
        rec.retailerStoreName,
        rec.outletType,
        rec.phoneNumber,
        rec.addressNo,
        rec.addressStreet,
        rec.addressWard,
        rec.township,
        rec.fullAddress,
        rec.salesStatus ? 'Yes' : 'No',
        rec.salesStatus ? '-' : rec.nonCoveredReason || '-',
        rec.pricingMode === PricingMode.COMPANY_LDP
          ? 'Company LTP Price'
          : 'Manual Wholesale Store Price',
        ...skuValues,
        rec.totalPaidQty,
        rec.totalFocQty,
        rec.grandTotalMmk,
        rec.remarks || '',
      ]
        .map(escapeCsv)
        .join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Pahtama_Noodle_Activations_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportSkuSummaryCsv = () => {
    const headers = [
      'SKU Code',
      'SKU Name',
      'Standard LTP Price (MMK)',
      'Avg Realized Price (MMK)',
      'Total Paid Qty',
      'Total FOC Qty (0 MMK)',
      'Total Combined Qty',
      'Total Revenue (MMK)',
      'Revenue Share (%)',
    ];
    const rows = skuBreakdown.map((s) =>
      [
        s.code,
        `"${s.name}"`,
        s.defaultLdpPrice,
        s.avgRealizedPrice,
        s.paidQty,
        s.focQty,
        s.paidQty + s.focQty,
        s.revenueMmk,
        s.sharePct,
      ].join(',')
    );

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `Pahtama_SKU_Summary_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportItemizedSkuCsv = () => {
    exportItemizedSkuRowsToCsv(filteredRecords, skus, selectedSkuSlice);
  };

  const handleExportExcel4Sheets = () => {
    exportActivationsToExcel(
      filteredRecords,
      skus,
      skuBreakdown,
      selectedSkuSlice
    );
  };

  const activeSkuLabel = useMemo(() => {
    if (selectedSkuSlice === 'ALL')
      return `All ${skus.length} Shaloot SKUs Combined`;
    const found = skus.find((s) => s.id === selectedSkuSlice);
    return found ? found.name : 'All SKUs';
  }, [selectedSkuSlice, skus]);

  return (
    <div className="w-full max-w-full space-y-5 sm:space-y-6 overflow-x-hidden min-w-0">
      {/* Header & Export Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-4 sm:p-6 overflow-hidden">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-[#0F2C59]">
            National Activation &amp; Sales Analytics
          </h2>
          <p className="text-xs text-slate-500 mt-0.5 break-words tabular-nums">
            Scope: {currentUser.fullName} · {currentUser.regionScope} ·{' '}
            {filteredRecords.length} matching records · Active Slice:{' '}
            <span className="font-semibold text-slate-800">
              {activeSkuLabel}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(currentUser.role === UserRole.ADMIN ||
            currentUser.role === UserRole.BRAND_MANAGER) && (
            <button
              type="button"
              onClick={onOpenProductMaster}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              Product Master List
            </button>
          )}
          <button
            type="button"
            onClick={handleExportItemizedSkuCsv}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0F2C59] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            Export Itemized SKU CSV
          </button>
          <button
            type="button"
            onClick={handleExportSkuSummaryCsv}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
            Export SKU Summary CSV
          </button>
          <button
            type="button"
            onClick={handleExportFullCsv}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 shrink-0" />
            Download CSV
          </button>
          <button
            type="button"
            onClick={handleExportExcel4Sheets}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
            Export Excel (.xlsx · 4 Sheets)
          </button>
        </div>
      </div>

      {/* Dynamic Multi-Branch, Date Range & SKU Slicers */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 overflow-hidden">
        {/* Branch Slicer Bar */}
        <div className="space-y-2 pb-3.5 border-b border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="w-4 h-4 text-[#0F2C59] shrink-0" />
              <span className="text-xs font-semibold text-slate-900">
                Branch Slicer
              </span>
              <span className="text-xs text-slate-500">
                · Yangon, Mandalay, Naypyitaw &amp; Bago
              </span>
            </div>
            {selectedBranch !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedBranch('ALL')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline cursor-pointer self-start sm:self-auto"
              >
                <RotateCcw className="w-3 h-3" />
                Reset Branch
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg max-w-full">
            <button
              type="button"
              onClick={() => setSelectedBranch('ALL')}
              className={`inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                selectedBranch === 'ALL'
                  ? 'bg-[#0F2C59] text-white'
                  : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <span>All Branches</span>
              <span className="font-mono text-[11px] opacity-85">
                ({records.length})
              </span>
            </button>

            {BRANCH_OPTIONS.map((branchName) => {
              const isSelected = selectedBranch === branchName;
              const count = branchCounts[branchName] || 0;
              return (
                <button
                  key={branchName}
                  type="button"
                  onClick={() =>
                    setSelectedBranch((prev) =>
                      prev === branchName ? 'ALL' : branchName
                    )
                  }
                  className={`inline-flex items-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-[#1E3E62] text-white'
                      : 'text-slate-700 hover:text-slate-900 hover:bg-white/60'
                  }`}
                >
                  <span>{branchName}</span>
                  <span className="font-mono text-[11px] opacity-85">
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Date Range Slicer & SKU-Specific Slicer */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          <div className="lg:col-span-6 space-y-2 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                Date Range Slicer
              </span>
              <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-0.5 rounded-lg self-start sm:self-auto max-w-full">
                {(
                  [
                    { id: 'ALL', label: 'All Dates' },
                    { id: 'TODAY', label: 'Today' },
                    { id: 'LAST_7', label: 'Last 7 Days' },
                    { id: 'THIS_MONTH', label: 'This Month' },
                    { id: 'CUSTOM', label: 'Custom Range' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyDatePreset(preset.id)}
                    className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      datePreset === preset.id
                        ? 'bg-white text-[#0F2C59] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label
                  htmlFor="filter-start-date"
                  className="block text-[11px] font-medium text-slate-500 mb-1"
                >
                  From Date
                </label>
                <input
                  id="filter-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setDatePreset('CUSTOM');
                  }}
                  className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="min-w-0">
                <label
                  htmlFor="filter-end-date"
                  className="block text-[11px] font-medium text-slate-500 mb-1"
                >
                  To Date
                </label>
                <input
                  id="filter-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setDatePreset('CUSTOM');
                  }}
                  className="w-full px-3 py-1.5 text-xs font-mono tabular-nums bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 space-y-2 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                SKU-Specific Slicer
              </span>
              <span className="text-[11px] text-slate-500">
                Slices KPIs, Route Matrix &amp; Ledger
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-lg max-w-full">
              <button
                type="button"
                onClick={() => setSelectedSkuSlice('ALL')}
                className={`py-1.5 px-2.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selectedSkuSlice === 'ALL'
                    ? 'bg-[#0F2C59] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All SKUs ({skus.length})
              </button>
              {skus.map((sku) => (
                <button
                  key={sku.id}
                  type="button"
                  onClick={() => setSelectedSkuSlice(sku.id)}
                  className={`py-1.5 px-2.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    selectedSkuSlice === sku.id
                      ? 'bg-amber-600 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sku.name
                    .replace('Shaloot Noodle ', '')
                    .replace(' (1x30pcs)', '')}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 6 Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Activations
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {summaryStats.totalVisited.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5 tabular-nums">
            {summaryStats.totalWithSales} orders ·{' '}
            {summaryStats.totalVisited - summaryStats.totalWithSales} non-covered
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Net Revenue
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {summaryStats.totalRevenueMmk.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5">
            Myanmar Kyat (MMK)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Paid Packs
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {summaryStats.totalPaidQty.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5 truncate">
            {activeSkuLabel}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            Total FOC Giveaway Packs
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {summaryStats.totalFocQty.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5">
            Locked @ 0 MMK unit rate
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            Average Order Value
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1.5">
            {summaryStats.avgOrderValueMmk.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5">
            MMK per converted outlet
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">
            Sales Conversion Rate
          </div>
          <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1.5">
            {summaryStats.salesConversionRate}%
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5 tabular-nums">
            {summaryStats.totalWithSales} of {summaryStats.totalVisited} outlets
          </div>
        </div>
      </div>

      {/* SKU Analytical Breakdown Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden w-full max-w-full">
        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">
              SKU Performance &amp; Pricing Breakdown
            </h3>
            <p className="text-xs text-slate-500">
              Click any SKU row to slice the dashboard, or toggle analytical
              metric modes
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg self-start sm:self-auto max-w-full">
            {(
              [
                { id: 'REVENUE_AND_QTY', label: 'Revenue & Quantity' },
                { id: 'PAID_VS_FOC', label: 'Paid vs FOC Ratio' },
                { id: 'PRICE_VARIANCE', label: 'Pricing Variance' },
              ] as const
            ).map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setBreakdownMode(mode.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  breakdownMode === mode.id
                    ? 'bg-white text-[#0F2C59] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-3 px-6">Product SKU</th>
                <th className="py-3 px-4 text-right">Company LTP</th>
                <th className="py-3 px-4 text-right">Avg Sold Price</th>
                <th className="py-3 px-4 text-right">Paid Qty</th>
                <th className="py-3 px-4 text-right">FOC Qty (0 MMK)</th>
                <th className="py-3 px-4 text-right">Revenue (MMK)</th>
                <th className="py-3 px-6 text-right">
                  {breakdownMode === 'REVENUE_AND_QTY'
                    ? 'Revenue Share'
                    : breakdownMode === 'PAID_VS_FOC'
                    ? 'Paid vs FOC Mix'
                    : 'LTP Variance / Manual Orders'}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {skuBreakdown.map((sku) => {
                const isSelectedSlice = selectedSkuSlice === sku.id;
                return (
                  <tr
                    key={sku.id}
                    onClick={() =>
                      setSelectedSkuSlice((prev) =>
                        prev === sku.id ? 'ALL' : sku.id
                      )
                    }
                    className={`transition-colors cursor-pointer ${
                      isSelectedSlice
                        ? 'bg-amber-50/70'
                        : 'hover:bg-slate-50/80'
                    }`}
                  >
                    <td className="py-3.5 px-6">
                      <div className="font-semibold text-slate-900">
                        {sku.name}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {sku.code} · {sku.myanmarSubName}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                      {sku.defaultLdpPrice.toLocaleString()} MMK
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-900">
                      {sku.avgRealizedPrice.toLocaleString()} MMK
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {sku.paidQty.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-700">
                      {sku.focQty.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                      {sku.revenueMmk.toLocaleString()}
                    </td>
                    <td className="py-3.5 px-6 text-right font-mono tabular-nums">
                      {breakdownMode === 'REVENUE_AND_QTY' && (
                        <div className="inline-flex items-center gap-2 justify-end w-28">
                          <svg
                            viewBox="0 0 100 8"
                            className="w-14 h-2 rounded-full overflow-hidden"
                            aria-hidden="true"
                          >
                            <rect
                              width="100"
                              height="8"
                              rx="4"
                              fill="#E2E8F0"
                            />
                            <rect
                              width={Math.min(100, Math.max(0, sku.sharePct))}
                              height="8"
                              rx="4"
                              fill="#D97706"
                            />
                          </svg>
                          <span className="text-slate-700 w-9 text-right">
                            {sku.sharePct}%
                          </span>
                        </div>
                      )}
                      {breakdownMode === 'PAID_VS_FOC' && (
                        <span className="text-slate-700">
                          {sku.focRatioPct}% FOC ({sku.paidQty + sku.focQty}{' '}
                          pcs)
                        </span>
                      )}
                      {breakdownMode === 'PRICE_VARIANCE' && (
                        <span
                          className={
                            sku.priceDelta < 0
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-700'
                          }
                        >
                          {sku.priceDelta >= 0
                            ? `+${sku.priceDelta}`
                            : sku.priceDelta}{' '}
                          MMK ({sku.manualPriceOrders} manual)
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Route & Seller Performance Matrix */}
      {currentUser.role !== UserRole.SELLER && sellerPerformance.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-900">
              Route &amp; Seller Performance Matrix ({activeSkuLabel})
            </h3>
            <p className="text-xs text-slate-500">
              Aggregated activation visits, conversion, and SKU revenue by route
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                  <th className="py-2.5 px-6">Route Code</th>
                  <th className="py-2.5 px-4">Activation Seller</th>
                  <th className="py-2.5 px-4">Region / Supervisor</th>
                  <th className="py-2.5 px-4 text-right">Converted / Visited</th>
                  <th className="py-2.5 px-4 text-right">Paid Qty</th>
                  <th className="py-2.5 px-4 text-right">FOC Qty</th>
                  <th className="py-2.5 px-6 text-right">Net Revenue (MMK)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {sellerPerformance.map((row) => (
                  <tr
                    key={row.sellerUsername}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="py-3 px-6 font-mono font-semibold text-slate-900">
                      {row.routeCode}
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-medium text-slate-900">
                        {row.sellerName}
                      </span>{' '}
                      <span className="text-slate-500">
                        ({row.sellerUsername})
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {row.regionScope} · {row.supervisorUsername}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                      {row.withSales} / {row.visited}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                      {row.paidQty.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                      {row.focQty.toLocaleString()}
                    </td>
                    <td className="py-3 px-6 text-right font-mono tabular-nums font-bold text-slate-900">
                      {row.revenueMmk.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AG Grid Transactional Ledger Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Transactional Activation Ledger (AG Grid)
              </h3>
              <p className="text-xs text-slate-500">
                Sort, filter columns, print 58mm/80mm thermal POS invoices, or
                edit records in place.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedBranch('ALL');
                applyDatePreset('ALL');
                setSelectedSkuSlice('ALL');
                setSalesFilter('ALL');
                setPricingFilter('ALL');
                setRouteFilter('ALL');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors self-start sm:self-auto cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset All Filters
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search invoice, retailer, wholesale, phone, route..."
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            <div>
              <select
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                aria-label="Filter by Branch"
                className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-medium"
              >
                <option value="ALL">All Branches ({records.length})</option>
                {BRANCH_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    Branch: {b} ({branchCounts[b] || 0})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <select
                value={salesFilter}
                onChange={(e) =>
                  setSalesFilter(e.target.value as 'ALL' | 'YES' | 'NO')
                }
                aria-label="Filter by Sales Status"
                className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">All Sales Statuses</option>
                <option value="YES">Sales: Yes (Converted)</option>
                <option value="NO">Sales: No (Non-Covered)</option>
              </select>
            </div>

            <div>
              <select
                value={pricingFilter}
                onChange={(e) =>
                  setPricingFilter(e.target.value as 'ALL' | PricingMode)
                }
                aria-label="Filter by Pricing Mode"
                className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">All Pricing Modes</option>
                <option value={PricingMode.COMPANY_LDP}>Company LTP</option>
                <option value={PricingMode.MANUAL_WHOLESALE}>
                  Manual Wholesale
                </option>
              </select>
            </div>

            <div>
              <select
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
                aria-label="Filter by Route Code"
                className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="ALL">All Routes</option>
                {uniqueRoutes.map((rt) => (
                  <option key={rt} value={rt}>
                    Route: {rt}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {agGridRows.length > 0 ? (
          <div className="w-full h-[470px]">
            <AgGridReact
              theme={isDarkTheme ? darkGridTheme : lightGridTheme}
              rowData={agGridRows}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              pagination={true}
              paginationPageSize={10}
              paginationPageSizeSelector={[10, 25, 50, 100, 250, 500]}
              rowHeight={42}
              headerHeight={40}
              animateRows={false}
            />
          </div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center space-y-3.5">
            <div className="inline-flex p-3 rounded-2xl bg-blue-50 text-[#0F2C59]">
              <Inbox className="w-7 h-7" />
            </div>
            <div className="text-base font-semibold text-slate-900">
              No activation records collected yet
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
              Submit your first retailer survey activation or SKU order to
              populate live KPIs, multi-branch slicers, and thermal POS
              receipts.
            </p>
            <div className="pt-2 flex items-center justify-center">
              <button
                type="button"
                onClick={onNavigateToForm}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] rounded-lg transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Record First Activation
              </button>
            </div>
          </div>
        ) : (
          <div className="p-12 text-center space-y-3">
            <div className="text-sm font-semibold text-slate-900">
              No activation records match your active slicers
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Reset your branch, date range, or SKU slicer to view all
              available records in your scope.
            </p>
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedBranch('ALL');
                  applyDatePreset('ALL');
                  setSelectedSkuSlice('ALL');
                  setSalesFilter('ALL');
                  setPricingFilter('ALL');
                  setRouteFilter('ALL');
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
              >
                Reset Filters
              </button>
              <button
                type="button"
                onClick={onNavigateToForm}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] rounded-lg transition-colors cursor-pointer"
              >
                New Activation Entry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
