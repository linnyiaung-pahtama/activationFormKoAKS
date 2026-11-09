import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Printer,
  Send,
  PlusCircle,
  CheckCircle2,
  Lock,
  Calendar,
  Package,
  MapPin,
  Share2,
  Plus,
  RefreshCw,
  Search,
  FileText,
  AlertCircle,
} from 'lucide-react';
import {
  NON_COVERED_REASONS,
  OUTLET_TYPE_OPTIONS,
  PRESET_WHOLESALE_STORES,
  YANGON_TOWNSHIPS,
  MANDALAY_TOWNSHIPS,
} from '../constants/catalog';
import {
  BRANCH_OPTIONS,
  getRecordBranch,
  NAYPYITAW_TOWNSHIPS,
  BAGO_TOWNSHIPS,
} from '../utils/branchHelper';
import {
  getStoredWholesaleStores,
  subscribeToWholesaleStores,
  WholesaleStoreItem,
} from '../services/wholesaleStoreService';
import { getCachedActivations } from '../services/dataService';
import {
  NoodleActivationRecord,
  PricingMode,
  SkuDefinition,
  SkuLineItem,
  UserAccount,
  UserRole,
} from '../types';

interface ActivationFormProps {
  currentUser: UserAccount;
  allUsers: UserAccount[];
  skus: SkuDefinition[];
  editingRecord?: NoodleActivationRecord | null;
  onSubmitRecord: (record: NoodleActivationRecord) => Promise<void>;
  onUpdateRecord?: (record: NoodleActivationRecord) => Promise<void>;
  onCancelEditRecord?: () => void;
  onOpenInvoicePreview: (record: NoodleActivationRecord) => void;
  onOpenProductMaster: () => void;
}

interface SkuFormState {
  quantity: number;
  unitPrice: number;
  focQuantity: number;
}

const FORM_DRAFT_STORAGE_KEY = 'pahtama_activation_form_draft_v2';

interface SavedFormDraft {
  invoiceSuffix?: string;
  selectedSellerUsername?: string;
  activationDate?: string;
  wholesaleStoreName?: string;
  pgCover?: string;
  retailerStoreName?: string;
  outletType?: string;
  phoneNumber?: string;
  addressNo?: string;
  addressStreet?: string;
  addressWard?: string;
  township?: string;
  branch?: string;
  salesStatus?: boolean;
  nonCoveredReason?: string;
  pricingMode?: PricingMode;
  remarks?: string;
  skuInputs?: Record<string, SkuFormState>;
}

/**
 * Invoice numbers: INV-<visit date YYMMDD>-<route>-<HHMMSS of the moment it is assigned>,
 * e.g. INV-261109-YGN04-143052 (older records use INV-YYYYMMDD-NNNN).
 *
 * - Each seller has their own route code, so two sellers can never produce the
 *   same number (the old random 4-digit suffix clashed between sellers).
 * - The number is assigned when the visit is submitted (or first previewed), not
 *   when the form opens, and it is never restored from a saved draft. A form left
 *   open in another tab or brought back by the browser can't reuse an old number.
 * - Works offline: no server round trip needed.
 */
function routeTagFor(seller: { routeCode?: string; username?: string }): string {
  const fromRoute = String(seller.routeCode || '')
    .toUpperCase()
    .replace(/^RT-/, '')
    .replace(/[^A-Z0-9]/g, '');
  if (fromRoute && !fromRoute.startsWith('ALL')) return fromRoute.slice(0, 8);
  const fromUser = String(seller.username || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return fromUser || 'USER';
}

function invoicePrefix(dateStr: string, routeTag: string): string {
  // YYMMDD (not YYYYMMDD) so "INV NO: INV-261109-YGN04-143052" fits one line on 58mm (32 cols)
  return `INV-${String(dateStr || '').replace(/-/g, '').slice(2)}-${routeTag}-`;
}

function buildInvoiceNumber(dateStr: string, routeTag: string, when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmmss = `${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  return `${invoicePrefix(dateStr, routeTag)}${hhmmss}`;
}

/** Next free invoice number (skips any number already saved on this device). */
function assignUniqueInvoiceNumber(dateStr: string, routeTag: string): string {
  const used = new Set(getCachedActivations().map((r) => r.invoiceNo));
  const start = Date.now();
  for (let i = 0; i < 3600; i++) {
    const candidate = buildInvoiceNumber(dateStr, routeTag, new Date(start + i * 1000));
    if (!used.has(candidate)) return candidate;
  }
  return `${buildInvoiceNumber(dateStr, routeTag, new Date(start))}-${Math.floor(Math.random() * 90 + 10)}`;
}

function loadSavedFormDraft(): SavedFormDraft | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(FORM_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedFormDraft;
  } catch {
    return null;
  }
}

export const ActivationForm: React.FC<ActivationFormProps> = ({
  currentUser,
  allUsers,
  skus,
  editingRecord = null,
  onSubmitRecord,
  onUpdateRecord,
  onCancelEditRecord,
  onOpenInvoicePreview,
  onOpenProductMaster,
}) => {
  const today = new Date().toISOString().split('T')[0];
  const savedDraft = useMemo(() => loadSavedFormDraft(), []);

  const canManageProducts =
    currentUser.role === UserRole.ADMIN ||
    currentUser.role === UserRole.BRAND_MANAGER;

  // Filter SKUs: show active SKUs (plus any SKU that already has qty on an editingRecord)
  const visibleSkus = useMemo(() => {
    return skus.filter((s) => {
      if (s.active !== false) return true;
      if (editingRecord) {
        return editingRecord.items.some(
          (item) =>
            item.skuId === s.id && (item.quantity > 0 || item.focQuantity > 0)
        );
      }
      return false;
    });
  }, [skus, editingRecord]);

  const sellersList = useMemo(() => {
    const sellers = allUsers.filter((u) => u.role === UserRole.SELLER);
    if (currentUser.role === UserRole.SUPERVISOR) {
      return sellers.filter(
        (s) =>
          (s.supervisorUsername || '').toLowerCase() ===
          currentUser.username.toLowerCase()
      );
    }
    if (currentUser.role === UserRole.MANAGER) {
      return sellers.filter(
        (s) =>
          (s.managerUsername || '').toLowerCase() ===
          currentUser.username.toLowerCase()
      );
    }
    return sellers;
  }, [allUsers, currentUser]);

  const [selectedSellerUsername, setSelectedSellerUsername] = useState<string>(
    currentUser.role === UserRole.SELLER
      ? currentUser.username
      : savedDraft?.selectedSellerUsername ||
          sellersList[0]?.username ||
          'seller1'
  );

  const activeSeller = useMemo(() => {
    if (currentUser.role === UserRole.SELLER) return currentUser;
    return (
      sellersList.find((s) => s.username === selectedSellerUsername) ||
      sellersList[0] ||
      currentUser
    );
  }, [currentUser, sellersList, selectedSellerUsername]);

  // Assigned on submit / first preview (see assignUniqueInvoiceNumber); never from a draft
  const [assignedInvoiceNo, setAssignedInvoiceNo] = useState<string | null>(null);
  const [activationDate, setActivationDate] = useState<string>(
    savedDraft?.activationDate || today
  );

  const activeInvoiceNo = useMemo(() => {
    if (editingRecord) return editingRecord.invoiceNo;
    return assignedInvoiceNo || '';
  }, [editingRecord, assignedInvoiceNo]);

  const [availableWholesaleStores, setAvailableWholesaleStores] = useState<
    WholesaleStoreItem[]
  >(() => getStoredWholesaleStores());

  const [wholesaleSearchQuery, setWholesaleSearchQuery] = useState<string>('');
  const [wholesaleStoreName, setWholesaleStoreName] = useState<string>(
    savedDraft?.wholesaleStoreName ||
      availableWholesaleStores[0]?.name ||
      PRESET_WHOLESALE_STORES[0]?.name ||
      'ဝမ်းနိုင်း - C00107520'
  );

  const filteredWholesaleStores = useMemo(() => {
    if (!wholesaleSearchQuery.trim()) return availableWholesaleStores;
    const q = wholesaleSearchQuery.trim().toLowerCase();
    return availableWholesaleStores.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.township || '').toLowerCase().includes(q) ||
        (s.region || '').toLowerCase().includes(q)
    );
  }, [availableWholesaleStores, wholesaleSearchQuery]);

  useEffect(() => {
    return subscribeToWholesaleStores((updated) => {
      setAvailableWholesaleStores(updated);
      setWholesaleStoreName((prev) => {
        if (!prev && updated.length > 0) return updated[0].name;
        return prev;
      });
    });
  }, []);

  const [pgCover, setPgCover] = useState<string>(savedDraft?.pgCover || 'Yes');
  const [retailerStoreName, setRetailerStoreName] = useState<string>(
    savedDraft?.retailerStoreName || ''
  );
  const [outletType, setOutletType] = useState<string>(() => {
    if (
      savedDraft?.outletType &&
      OUTLET_TYPE_OPTIONS.includes(savedDraft.outletType)
    ) {
      return savedDraft.outletType;
    }
    return OUTLET_TYPE_OPTIONS[0] || 'Consumer';
  });
  const [phoneNumber, setPhoneNumber] = useState<string>(
    savedDraft?.phoneNumber || ''
  );

  const [addressNo, setAddressNo] = useState<string>(
    savedDraft?.addressNo || ''
  );
  const [addressStreet, setAddressStreet] = useState<string>(
    savedDraft?.addressStreet || ''
  );
  const [addressWard, setAddressWard] = useState<string>(
    savedDraft?.addressWard || ''
  );
  const [township, setTownship] = useState<string>(savedDraft?.township || '');
  const [branch, setBranch] = useState<string>(() => {
    if (editingRecord?.branch) return editingRecord.branch;
    if (savedDraft?.branch) return savedDraft.branch;
    return getRecordBranch({
      branch: activeSeller.branch,
      regionScope: activeSeller.regionScope,
      routeCode: activeSeller.routeCode,
      township: savedDraft?.township,
    });
  });

  const handleTownshipChange = (newTownship: string) => {
    setTownship(newTownship);
    if (newTownship) {
      const detected = getRecordBranch({ township: newTownship });
      setBranch(detected);
    }
  };

  const fullAddress = useMemo(() => {
    const parts: string[] = [];
    if (addressNo.trim()) {
      const cleanNo = addressNo.trim();
      parts.push(/^no\.?\s/i.test(cleanNo) ? cleanNo : `No. ${cleanNo}`);
    }
    if (addressStreet.trim()) {
      const cleanStreet = addressStreet.trim();
      parts.push(
        /\b(street|st\.?)\b$/i.test(cleanStreet)
          ? cleanStreet
          : `${cleanStreet} Street`
      );
    }
    if (addressWard.trim()) {
      const cleanWard = addressWard.trim();
      parts.push(/\bward\b/i.test(cleanWard) ? cleanWard : `${cleanWard} Ward`);
    }
    if (township.trim()) {
      const cleanTownship = township.trim();
      parts.push(
        /\b(township|tsp\.?)\b$/i.test(cleanTownship)
          ? cleanTownship
          : `${cleanTownship} Township`
      );
    }
    return parts.join(', ');
  }, [addressNo, addressStreet, addressWard, township]);

  const [salesStatus, setSalesStatus] = useState<boolean>(
    savedDraft?.salesStatus !== undefined ? savedDraft.salesStatus : true
  );
  const [nonCoveredReason, setNonCoveredReason] = useState<string>(
    savedDraft?.nonCoveredReason || NON_COVERED_REASONS[0]
  );
  const [pricingMode, setPricingMode] = useState<PricingMode>(
    savedDraft?.pricingMode || PricingMode.COMPANY_LDP
  );
  const [remarks, setRemarks] = useState<string>(savedDraft?.remarks || '');

  const [skuInputs, setSkuInputs] = useState<Record<string, SkuFormState>>(
    () => {
      const initial: Record<string, SkuFormState> = {};
      skus.forEach((s) => {
        const draftSku = savedDraft?.skuInputs?.[s.id];
        initial[s.id] = {
          quantity: draftSku?.quantity ?? 0,
          unitPrice: draftSku?.unitPrice ?? s.defaultLdpPrice,
          focQuantity: draftSku?.focQuantity ?? 0,
        };
      });
      return initial;
    }
  );

  useEffect(() => {
    if (editingRecord) return;
    try {
      const draft: SavedFormDraft = {
        selectedSellerUsername,
        activationDate,
        wholesaleStoreName,
        pgCover,
        retailerStoreName,
        outletType,
        phoneNumber,
        addressNo,
        addressStreet,
        addressWard,
        township,
        branch,
        salesStatus,
        nonCoveredReason,
        pricingMode,
        remarks,
        skuInputs,
      };
      window.localStorage.setItem(
        FORM_DRAFT_STORAGE_KEY,
        JSON.stringify(draft)
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [
    editingRecord,
    selectedSellerUsername,
    activationDate,
    wholesaleStoreName,
    pgCover,
    retailerStoreName,
    outletType,
    phoneNumber,
    addressNo,
    addressStreet,
    addressWard,
    township,
    branch,
    salesStatus,
    nonCoveredReason,
    pricingMode,
    remarks,
    skuInputs,
  ]);

  useEffect(() => {
    setSkuInputs((prev) => {
      const next = { ...prev };
      let changed = false;
      skus.forEach((s) => {
        if (!next[s.id]) {
          next[s.id] = {
            quantity: 0,
            unitPrice: s.defaultLdpPrice,
            focQuantity: 0,
          };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [skus]);

  useEffect(() => {
    if (!editingRecord) return;
    setActivationDate(editingRecord.activationDate || today);
    setBranch(editingRecord.branch || getRecordBranch(editingRecord));
    setWholesaleStoreName(editingRecord.wholesaleStoreName || '');
    setPgCover(editingRecord.pgCover || 'Yes');
    setRetailerStoreName(editingRecord.retailerStoreName || '');
    setOutletType(
      editingRecord.outletType || OUTLET_TYPE_OPTIONS[0] || 'Consumer'
    );
    setPhoneNumber(editingRecord.phoneNumber || '');
    setAddressNo(editingRecord.addressNo || '');
    setAddressStreet(editingRecord.addressStreet || '');
    setAddressWard(editingRecord.addressWard || '');
    setTownship(editingRecord.township || '');
    setSalesStatus(Boolean(editingRecord.salesStatus));
    setNonCoveredReason(
      editingRecord.nonCoveredReason || NON_COVERED_REASONS[0]
    );
    setPricingMode(editingRecord.pricingMode || PricingMode.COMPANY_LDP);
    setRemarks(editingRecord.remarks || '');
    if (editingRecord.sellerUsername) {
      setSelectedSellerUsername(editingRecord.sellerUsername);
    }

    const mappedSkus: Record<string, SkuFormState> = {};
    skus.forEach((s) => {
      const line = editingRecord.items?.find((i) => i.skuId === s.id);
      mappedSkus[s.id] = {
        quantity: line?.quantity ?? 0,
        unitPrice: line?.unitPrice ?? s.defaultLdpPrice,
        focQuantity: line?.focQuantity ?? 0,
      };
    });
    setSkuInputs(mappedSkus);
    setValidationMessage(null);
  }, [editingRecord, skus, today]);

  const [imgErrorMap, setImgErrorMap] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  // Synchronous lock: blocks a second tap before React re-renders the disabled button
  const submitLockRef = useRef(false);
  const [lastSubmittedRecord, setLastSubmittedRecord] =
    useState<NoodleActivationRecord | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  );

  const handlePricingModeChange = (mode: PricingMode) => {
    setPricingMode(mode);
    if (mode === PricingMode.COMPANY_LDP) {
      setSkuInputs((prev) => {
        const next: Record<string, SkuFormState> = { ...prev };
        skus.forEach((s) => {
          const cur = next[s.id] || {
            quantity: 0,
            unitPrice: s.defaultLdpPrice,
            focQuantity: 0,
          };
          next[s.id] = {
            ...cur,
            unitPrice: s.defaultLdpPrice,
          };
        });
        return next;
      });
    }
  };

  const updateSkuField = (
    skuId: string,
    field: keyof SkuFormState,
    rawValue: string
  ) => {
    const numeric = Math.max(0, Number(rawValue.replace(/[^0-9.]/g, '')) || 0);
    setSkuInputs((prev) => {
      const fallbackPrice =
        skus.find((s) => s.id === skuId)?.defaultLdpPrice ?? 0;
      const current = prev[skuId] || {
        quantity: 0,
        unitPrice: fallbackPrice,
        focQuantity: 0,
      };
      return {
        ...prev,
        [skuId]: {
          ...current,
          [field]: numeric,
        },
      };
    });
  };

  const computedItems: SkuLineItem[] = useMemo(() => {
    return visibleSkus.map((sku) => {
      if (!salesStatus) {
        return {
          skuId: sku.id,
          skuName: sku.name,
          quantity: 0,
          unitPrice: sku.defaultLdpPrice,
          focQuantity: 0,
          focPrice: 0,
          lineTotal: 0,
        };
      }
      const state = skuInputs[sku.id] || {
        quantity: 0,
        unitPrice: sku.defaultLdpPrice,
        focQuantity: 0,
      };
      const activePrice =
        pricingMode === PricingMode.COMPANY_LDP
          ? sku.defaultLdpPrice
          : state.unitPrice;
      return {
        skuId: sku.id,
        skuName: sku.name,
        quantity: state.quantity,
        unitPrice: activePrice,
        focQuantity: state.focQuantity,
        focPrice: 0,
        lineTotal: state.quantity * activePrice,
      };
    });
  }, [visibleSkus, salesStatus, pricingMode, skuInputs]);

  const totalPaidQty = useMemo(
    () => computedItems.reduce((acc, item) => acc + item.quantity, 0),
    [computedItems]
  );

  const totalFocQty = useMemo(
    () => computedItems.reduce((acc, item) => acc + item.focQuantity, 0),
    [computedItems]
  );

  const grandTotalMmk = useMemo(
    () => computedItems.reduce((acc, item) => acc + item.lineTotal, 0),
    [computedItems]
  );

  /** Returns this visit's invoice number, assigning a fresh unique one if needed. */
  const ensureInvoiceNo = (): string => {
    if (editingRecord) return editingRecord.invoiceNo;
    const prefix = invoicePrefix(activationDate, routeTagFor(activeSeller));
    // Keep an already-assigned number only if date and seller still match it
    if (assignedInvoiceNo && assignedInvoiceNo.startsWith(prefix)) {
      return assignedInvoiceNo;
    }
    const next = assignUniqueInvoiceNumber(activationDate, routeTagFor(activeSeller));
    setAssignedInvoiceNo(next);
    return next;
  };

  /** A visit already saved on this device with the same seller, date, shop and amounts. */
  const findPossibleDuplicateVisit = (): NoodleActivationRecord | null => {
    const norm = (v?: string) => String(v || '').trim().toLowerCase();
    return (
      getCachedActivations().find(
        (r) =>
          norm(r.sellerUsername) === norm(activeSeller.username) &&
          r.activationDate === activationDate &&
          norm(r.retailerStoreName) === norm(retailerStoreName) &&
          norm(r.township) === norm(township) &&
          Boolean(r.salesStatus) === salesStatus &&
          Number(r.totalPaidQty || 0) === totalPaidQty &&
          Number(r.totalFocQty || 0) === totalFocQty &&
          Number(r.grandTotalMmk || 0) === grandTotalMmk
      ) || null
    );
  };

  const buildDraftRecord = (): NoodleActivationRecord => {
    return {
      id: editingRecord ? editingRecord.id : `act-${Date.now()}`,
      invoiceNo: ensureInvoiceNo(),
      activationDate,
      createdAt: editingRecord
        ? editingRecord.createdAt
        : new Date().toISOString(),
      wholesaleStoreName:
        wholesaleStoreName.trim() || 'Unspecified Wholesale Store',
      pgCover: pgCover.trim() || 'Yes',
      retailerStoreName:
        retailerStoreName.trim() || 'Direct Wholesale Customer',
      outletType: outletType.trim() || 'Consumer',
      phoneNumber: phoneNumber.trim() || '-',
      addressNo: addressNo.trim(),
      addressStreet: addressStreet.trim(),
      addressWard: addressWard.trim(),
      township: township.trim() || activeSeller.regionScope,
      fullAddress: fullAddress || township.trim() || activeSeller.regionScope,
      branch:
        branch ||
        getRecordBranch({
          township,
          branch: activeSeller.branch,
          regionScope: activeSeller.regionScope,
          routeCode: activeSeller.routeCode,
        }),
      salesStatus,
      pricingMode,
      coveredStatus: salesStatus,
      nonCoveredReason: !salesStatus
        ? nonCoveredReason.trim() || 'Out of Stock'
        : undefined,
      sellerUsername: activeSeller.username,
      sellerName: activeSeller.fullName,
      routeCode: activeSeller.routeCode,
      supervisorUsername: activeSeller.supervisorUsername || 'supervisor1',
      managerUsername: activeSeller.managerUsername || 'manager1',
      regionScope: activeSeller.regionScope,
      items: computedItems,
      totalPaidQty,
      totalFocQty,
      grandTotalMmk,
      remarks: remarks.trim() || undefined,
    };
  };

  const resetAllFormFields = () => {
    setAssignedInvoiceNo(null);
    setActivationDate(today);
    setWholesaleSearchQuery('');
    setWholesaleStoreName(
      availableWholesaleStores[0]?.name ||
        PRESET_WHOLESALE_STORES[0]?.name ||
        'ဝမ်းနိုင်း - C00107520'
    );
    setPgCover('Yes');
    setRetailerStoreName('');
    setOutletType(OUTLET_TYPE_OPTIONS[0] || 'Consumer');
    setPhoneNumber('');
    setAddressNo('');
    setAddressStreet('');
    setAddressWard('');
    setTownship('');
    setBranch(
      getRecordBranch({
        branch: activeSeller.branch,
        regionScope: activeSeller.regionScope,
        routeCode: activeSeller.routeCode,
      })
    );
    setRemarks('');
    setSalesStatus(true);
    setNonCoveredReason(NON_COVERED_REASONS[0]);
    setPricingMode(PricingMode.COMPANY_LDP);
    const resetSkus: Record<string, SkuFormState> = {};
    skus.forEach((s) => {
      resetSkus[s.id] = {
        quantity: 0,
        unitPrice: s.defaultLdpPrice,
        focQuantity: 0,
      };
    });
    setSkuInputs(resetSkus);
    setValidationMessage(null);
    try {
      window.localStorage.removeItem(FORM_DRAFT_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  };

  const handleAddNewForm = () => {
    onCancelEditRecord?.();
    resetAllFormFields();
    setLastSubmittedRecord(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitLockRef.current) return; // already saving (double tap)
    setValidationMessage(null);

    if (
      !activationDate.trim() ||
      !branch.trim() ||
      !wholesaleStoreName.trim() ||
      !pgCover.trim() ||
      !retailerStoreName.trim() ||
      !outletType.trim() ||
      !phoneNumber.trim() ||
      !addressNo.trim() ||
      !addressStreet.trim() ||
      !addressWard.trim() ||
      !township.trim()
    ) {
      setValidationMessage(
        'Please complete all required Header Info and Retailer Profile fields (Date, Branch, Wholesale Store, PG Cover, Retailer Name, Outlet Type, Phone Number, No., Street, Ward, and Township).'
      );
      return;
    }

    if (!salesStatus && !nonCoveredReason.trim()) {
      setValidationMessage(
        'Sales Status is set to "No". Please select a Non-Covered Reason before submitting.'
      );
      return;
    }

    if (salesStatus && totalPaidQty === 0 && totalFocQty === 0) {
      setValidationMessage(
        'Sales Status is set to "Yes". Please enter at least 1 Paid or FOC SKU quantity, or switch Sales Status to "No" and choose a Non-Covered Reason.'
      );
      return;
    }

    if (!editingRecord) {
      const existing = findPossibleDuplicateVisit();
      if (
        existing &&
        !window.confirm(
          `This visit looks already saved:\n\n${existing.invoiceNo}\n${existing.retailerStoreName} · ${existing.activationDate} · ${Number(existing.grandTotalMmk || 0).toLocaleString()} MMK\n\nPress OK only if this is a NEW, separate visit. Press Cancel to stop.`
        )
      ) {
        setValidationMessage(
          `Not saved: this visit was already saved as ${existing.invoiceNo}. Check My Route Ledger, or press "Clear / New Form" to start the next visit.`
        );
        return;
      }
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const recordPayload = buildDraftRecord();
      if (editingRecord && onUpdateRecord) {
        await onUpdateRecord(recordPayload);
      } else {
        await onSubmitRecord(recordPayload);
      }
      setLastSubmittedRecord(recordPayload);
      resetAllFormFields();
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handlePreviewCurrentInvoice = () => {
    if (lastSubmittedRecord && !retailerStoreName.trim() && !editingRecord) {
      onOpenInvoicePreview(lastSubmittedRecord);
      return;
    }
    if (
      !activationDate.trim() ||
      !wholesaleStoreName.trim() ||
      !retailerStoreName.trim() ||
      !phoneNumber.trim() ||
      !township.trim()
    ) {
      setValidationMessage(
        'Please fill in Retailer Name, Wholesale Store, Phone Number, and Township before generating a POS Invoice Preview.'
      );
      return;
    }
    setValidationMessage(null);
    const draft = buildDraftRecord();
    onOpenInvoicePreview(draft);
  };


  return (
    <div className="w-full max-w-full space-y-5 sm:space-y-6 overflow-x-hidden min-w-0">
      {editingRecord && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="text-sm font-semibold text-slate-900 break-words">
              Editing Activation Record · {editingRecord.invoiceNo}
            </div>
            <p className="text-xs text-slate-700 break-words">
              Retailer: {editingRecord.retailerStoreName} · Saving updates
              synchronizes immediately across your route ledger and Supabase.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddNewForm}
            className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-amber-400 hover:bg-amber-100 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto cursor-pointer"
          >
            Cancel Edit
          </button>
        </div>
      )}

      {lastSubmittedRecord && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="break-words">
                Activation Saved ({lastSubmittedRecord.invoiceNo})
              </span>
            </div>
            <p className="text-xs text-emerald-800 tabular-nums break-words">
              Branch: {lastSubmittedRecord.branch || getRecordBranch(lastSubmittedRecord)} · Wholesale:{' '}
              {lastSubmittedRecord.wholesaleStoreName} · Retailer:{' '}
              {lastSubmittedRecord.retailerStoreName} ·{' '}
              {lastSubmittedRecord.salesStatus ? (
                <>
                  Grand Total:{' '}
                  <span className="font-semibold font-mono">
                    {lastSubmittedRecord.grandTotalMmk.toLocaleString()} MMK
                  </span>
                </>
              ) : (
                <>Non-Covered: {lastSubmittedRecord.nonCoveredReason}</>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAddNewForm}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-white border border-emerald-300 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <PlusCircle className="w-3.5 h-3.5 shrink-0" />
              New Entry
            </button>
            <button
              type="button"
              onClick={() => onOpenInvoicePreview(lastSubmittedRecord)}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5 shrink-0" />
              Generate POS Invoice Preview
            </button>
          </div>
        </div>
      )}

      {validationMessage && (
        <div
          role="alert"
          className="bg-rose-50 border border-rose-300 text-rose-900 text-xs font-semibold px-4 py-3 rounded-xl flex items-start gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span className="break-words">{validationMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5 sm:space-y-6 min-w-0">
        {/* Section 01: Header Info & Retailer Profile */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-6 overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-[#0F2C59]">
                01. Header Info &amp; Retailer Profile
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 break-words tabular-nums">
                Seller: {activeSeller.fullName} · Route: {activeSeller.routeCode}{' '}
                · Region: {activeSeller.regionScope}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto min-w-0">
              {currentUser.role !== UserRole.SELLER && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 w-full sm:w-auto min-w-0">
                  <label
                    htmlFor="seller-override"
                    className="text-xs font-medium text-slate-600 whitespace-nowrap shrink-0"
                  >
                    Route Seller:
                  </label>
                  <select
                    id="seller-override"
                    value={selectedSellerUsername}
                    onChange={(e) => {
                      const nextUsername = e.target.value;
                      setSelectedSellerUsername(nextUsername);
                      const nextSeller = sellersList.find(
                        (s) => s.username === nextUsername
                      );
                      if (nextSeller && !editingRecord) {
                        setBranch(
                          getRecordBranch({
                            branch: nextSeller.branch,
                            regionScope: nextSeller.regionScope,
                            routeCode: nextSeller.routeCode,
                          })
                        );
                      }
                    }}
                    className="w-full sm:w-auto max-w-full min-w-0 truncate text-xs font-medium bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {sellersList.map((s) => (
                      <option key={s.id} value={s.username}>
                        {s.username} — {s.routeCode} ({s.fullName})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {canManageProducts && (
                <button
                  type="button"
                  onClick={onOpenProductMaster}
                  className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3E62] hover:bg-[#0F2C59] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  Product Master List
                </button>
              )}
              <button
                type="button"
                onClick={handleAddNewForm}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                Reset Form
              </button>
            </div>
          </div>

          {/* Header Info Row: Auto Invoice No, Activation Date, Branch, PG Cover, Searchable Wholesale Store */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Auto-generated Invoice Number (INV-YYYYMMDD-XXXX) */}
            <div className="min-w-0">
              <label
                htmlFor="invoice-no-display"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Invoice Number (Auto)
              </label>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1 min-w-0">
                  <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="invoice-no-display"
                    type="text"
                    value={activeInvoiceNo}
                    placeholder="Assigned when you submit"
                    readOnly
                    className="w-full pl-9 pr-2.5 py-2 text-xs sm:text-sm font-mono font-semibold tabular-nums bg-slate-100 border border-slate-300 rounded-lg text-[#0F2C59]"
                  />
                </div>
              </div>
            </div>

            {/* Activation Date */}
            <div className="min-w-0">
              <label
                htmlFor="activation-date"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Activation Date <span className="text-rose-600">*</span>
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="activation-date"
                  type="date"
                  value={activationDate}
                  onChange={(e) => {
                    setActivationDate(e.target.value);
                    setLastSubmittedRecord(null);
                  }}
                  required
                  className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>

            {/* Branch Selection */}
            <div className="min-w-0">
              <label
                htmlFor="header-branch-select"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Branch <span className="text-rose-600">*</span>
              </label>
              <select
                id="header-branch-select"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {BRANCH_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            {/* PG Cover */}
            <div className="min-w-0">
              <label
                htmlFor="pg-cover-textbox"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                PG Cover (Yes / No) <span className="text-rose-600">*</span>
              </label>
              <select
                id="pg-cover-textbox"
                value={pgCover}
                onChange={(e) => setPgCover(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
          </div>

          {/* Searchable Wholesale Store Name & Retailer Profile Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-100">
            {/* Searchable Wholesale Store Name */}
            <div className="min-w-0 md:col-span-2">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="wholesale-store-select"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Wholesale Store Name <span className="text-rose-600">*</span>
                </label>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {filteredWholesaleStores.length} of{' '}
                  {availableWholesaleStores.length} stores
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={wholesaleSearchQuery}
                    onChange={(e) => {
                      const q = e.target.value;
                      setWholesaleSearchQuery(q);
                      const matches = availableWholesaleStores.filter((s) =>
                        s.name.toLowerCase().includes(q.trim().toLowerCase())
                      );
                      if (q.trim() && matches.length === 1) {
                        setWholesaleStoreName(matches[0].name);
                      }
                    }}
                    placeholder="Filter wholesale catalog..."
                    className="w-full pl-8 pr-3 py-2 text-xs sm:text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <select
                  id="wholesale-store-select"
                  value={
                    availableWholesaleStores.some(
                      (s) => s.name === wholesaleStoreName
                    )
                      ? wholesaleStoreName
                      : '__OTHER__'
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__OTHER__') {
                      setWholesaleStoreName('');
                    } else {
                      setWholesaleStoreName(val);
                    }
                    setLastSubmittedRecord(null);
                  }}
                  className="w-full truncate px-3 py-2 text-xs sm:text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {filteredWholesaleStores.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                  <option value="__OTHER__">
                    Custom / Other Wholesale Store...
                  </option>
                </select>
              </div>
              <input
                id="wholesale-store-textbox"
                type="text"
                list="wholesale-store-suggestions"
                value={wholesaleStoreName}
                onChange={(e) => {
                  setWholesaleStoreName(e.target.value);
                  setLastSubmittedRecord(null);
                }}
                placeholder="Selected or custom wholesale store name..."
                required
                className="mt-2 w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <datalist id="wholesale-store-suggestions">
                {availableWholesaleStores.map((s) => (
                  <option key={s.name} value={s.name} />
                ))}
              </datalist>
            </div>

            {/* Retailer Store Name */}
            <div className="min-w-0">
              <label
                htmlFor="retailer-store-textbox"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Retailer Store Name <span className="text-rose-600">*</span>
              </label>
              <input
                id="retailer-store-textbox"
                type="text"
                value={retailerStoreName}
                onChange={(e) => setRetailerStoreName(e.target.value)}
                placeholder="Enter retailer store name..."
                required
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Outlet Type & Phone stacked or adjacent */}
            <div className="min-w-0 space-y-3">
              <div>
                <label
                  htmlFor="outlet-type-textbox"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Outlet Type <span className="text-rose-600">*</span>
                </label>
                <select
                  id="outlet-type-textbox"
                  value={outletType}
                  onChange={(e) => setOutletType(e.target.value)}
                  required
                  className="w-full truncate px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {editingRecord?.outletType &&
                    !OUTLET_TYPE_OPTIONS.includes(editingRecord.outletType) && (
                      <option value={editingRecord.outletType}>
                        {editingRecord.outletType}
                      </option>
                    )}
                  {OUTLET_TYPE_OPTIONS.map((typeOption) => (
                    <option key={typeOption} value={typeOption}>
                      {typeOption}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="phone-number-textbox"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Contact Phone Number <span className="text-rose-600">*</span>
                </label>
                <input
                  id="phone-number-textbox"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g., 09-421088312"
                  required
                  className="w-full px-3.5 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Structured Address (No., Street, Ward, Township) */}
          <div className="p-4 sm:p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-4 h-4 text-[#0F2C59] shrink-0" />
                <h3 className="text-xs font-semibold text-slate-900">
                  Structured Retailer Address (No., Street, Ward, Township)
                </h3>
              </div>
              <span className="text-[11px] text-slate-500 shrink-0">
                Auto-formats Full Address
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="min-w-0">
                <label
                  htmlFor="addr-no"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  No. <span className="text-rose-600">*</span>
                </label>
                <input
                  id="addr-no"
                  type="text"
                  value={addressNo}
                  onChange={(e) => setAddressNo(e.target.value)}
                  placeholder="e.g., 42/A"
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="min-w-0">
                <label
                  htmlFor="addr-street"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Street <span className="text-rose-600">*</span>
                </label>
                <input
                  id="addr-street"
                  type="text"
                  value={addressStreet}
                  onChange={(e) => setAddressStreet(e.target.value)}
                  placeholder="e.g., Pinlon"
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="min-w-0">
                <label
                  htmlFor="addr-ward"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Ward <span className="text-rose-600">*</span>
                </label>
                <input
                  id="addr-ward"
                  type="text"
                  value={addressWard}
                  onChange={(e) => setAddressWard(e.target.value)}
                  placeholder="e.g., 4"
                  required
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="min-w-0">
                <label
                  htmlFor="addr-township"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Township <span className="text-rose-600">*</span>
                </label>
                <select
                  id="addr-township"
                  value={township}
                  onChange={(e) => handleTownshipChange(e.target.value)}
                  required
                  className="w-full truncate px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  <option value="">Select Township...</option>
                  {township &&
                    !YANGON_TOWNSHIPS.includes(township) &&
                    !MANDALAY_TOWNSHIPS.includes(township) &&
                    !NAYPYITAW_TOWNSHIPS.includes(township) &&
                    !BAGO_TOWNSHIPS.includes(township) && (
                      <option value={township}>{township}</option>
                    )}
                  <optgroup label="Yangon Townships">
                    {YANGON_TOWNSHIPS.map((t) => (
                      <option key={`ygn-${t}`} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Mandalay Townships">
                    {MANDALAY_TOWNSHIPS.map((t) => (
                      <option key={`mdy-${t}`} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Naypyitaw Townships">
                    {NAYPYITAW_TOWNSHIPS.map((t) => (
                      <option key={`npt-${t}`} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Bago Townships">
                    {BAGO_TOWNSHIPS.map((t) => (
                      <option key={`bago-${t}`} value={t}>
                        {t}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>

            <div className="min-w-0">
              <label
                htmlFor="full-address-combined"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Combined Full Address
              </label>
              <input
                id="full-address-combined"
                type="text"
                value={fullAddress}
                readOnly
                placeholder="No. 42/A, Pinlon Street, 4 Ward, North Dagon Township"
                className="w-full px-3.5 py-2 text-sm bg-slate-100 border border-slate-300 rounded-lg text-slate-800 font-medium cursor-default"
              />
            </div>
          </div>

          {/* Sales Status Toggle & Pricing Mode / Non-Covered Reason */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            {/* Sales Status Toggle */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-xs font-semibold text-slate-800">
                  Sales Status Toggle
                </span>
                <span className="text-xs text-slate-500">
                  {salesStatus
                    ? 'Yes — SKU Ordering Grid Active'
                    : 'No — Non-Covered Survey Visit'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-200/80 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSalesStatus(true)}
                  className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    salesStatus
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  Yes (Record SKU Order)
                </button>
                <button
                  type="button"
                  onClick={() => setSalesStatus(false)}
                  className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    !salesStatus
                      ? 'bg-[#0F2C59] text-white shadow-xs'
                      : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  No (Non-Covered Visit)
                </button>
              </div>
            </div>

            {/* Conditional Right Panel: Pricing Mode (when Yes) OR Non-Covered Reason (when No) */}
            {salesStatus ? (
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-xs font-semibold text-slate-800">
                    Pricing Mode
                  </span>
                  <span className="text-xs text-slate-500">
                    {pricingMode === PricingMode.COMPANY_LDP
                      ? 'Locked Standard Company LTP'
                      : 'Custom Wholesale Unit Price'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-1 bg-slate-200/80 rounded-lg">
                  <button
                    type="button"
                    onClick={() =>
                      handlePricingModeChange(PricingMode.COMPANY_LDP)
                    }
                    className={`py-2 px-2.5 text-xs font-semibold rounded-md transition-colors text-center truncate cursor-pointer ${
                      pricingMode === PricingMode.COMPANY_LDP
                        ? 'bg-white text-[#0F2C59] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Company LTP Price
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handlePricingModeChange(PricingMode.MANUAL_WHOLESALE)
                    }
                    className={`py-2 px-2.5 text-xs font-semibold rounded-md transition-colors text-center truncate cursor-pointer ${
                      pricingMode === PricingMode.MANUAL_WHOLESALE
                        ? 'bg-white text-[#0F2C59] shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Manual Wholesale Store Price
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-amber-50/70 border border-amber-300 rounded-xl space-y-2.5 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="non-covered-reason-select"
                    className="text-xs font-semibold text-slate-900"
                  >
                    Non-Covered Reason <span className="text-rose-600">*</span>
                  </label>
                  <span className="text-[11px] text-amber-800 font-medium">
                    Required when Sales is No
                  </span>
                </div>
                <select
                  id="non-covered-reason-select"
                  value={nonCoveredReason}
                  onChange={(e) => setNonCoveredReason(e.target.value)}
                  required={!salesStatus}
                  className="w-full px-3 py-2 text-sm bg-white border border-amber-300 rounded-lg text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {NON_COVERED_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Non-Sales Direct Action Bar when Sales === No */}
          {!salesStatus && (
            <div className="pt-4 border-t border-slate-200 space-y-4">
              <div>
                <label
                  htmlFor="non-sales-remarks"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Survey Remarks / Follow-Up Notes (Optional)
                </label>
                <input
                  id="non-sales-remarks"
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Additional context on competitor stock, pricing feedback, or next visit date..."
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={handlePreviewCurrentInvoice}
                  className="min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Printer className="w-4 h-4 shrink-0" />
                  Generate POS Invoice Preview
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="min-h-[42px] inline-flex items-center justify-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Send className="w-4 h-4 shrink-0" />
                  {isSubmitting
                    ? 'Saving...'
                    : editingRecord
                    ? 'Update Survey Record'
                    : 'Submit Survey'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Section 02: Interactive SKU Matrix (When Sales Status === Yes) */}
        {salesStatus && (
          <>
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5 overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-200">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold text-[#0F2C59]">
                    02. Interactive SKU Matrix &amp; FOC Sampling
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Enter Paid Quantity, verify Unit Price (MMK), and record FOC
                    sampling quantities permanently locked at 0 MMK.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-medium text-slate-600 tabular-nums">
                    {visibleSkus.length} Active SKUs · 1x30pcs Pack Spec
                  </span>
                  {canManageProducts && (
                    <button
                      type="button"
                      onClick={onOpenProductMaster}
                      className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-900 bg-amber-400 hover:bg-amber-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" />
                      Manage SKUs
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                {visibleSkus.map((sku, idx) => {
                  const state = skuInputs[sku.id] || {
                    quantity: 0,
                    unitPrice: sku.defaultLdpPrice,
                    focQuantity: 0,
                  };
                  const activePrice =
                    pricingMode === PricingMode.COMPANY_LDP
                      ? sku.defaultLdpPrice
                      : state.unitPrice;
                  const lineTotal = state.quantity * activePrice;

                  return (
                    <div
                      key={sku.id}
                      className="flex flex-col justify-between border border-slate-200 rounded-xl p-4 bg-white hover:border-slate-300 transition-colors min-w-0"
                    >
                      <div className="space-y-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-14 h-14 bg-slate-50 border border-slate-200 rounded-lg overflow-hidden flex items-center justify-center p-1 shrink-0">
                            {!imgErrorMap[sku.id] ? (
                              <img
                                src={sku.imageUrl}
                                alt={sku.name}
                                referrerPolicy="no-referrer"
                                onError={() =>
                                  setImgErrorMap((prev) => ({
                                    ...prev,
                                    [sku.id]: true,
                                  }))
                                }
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <Package className="w-6 h-6 text-amber-600" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] text-slate-500 tabular-nums">
                              <span>
                                SKU {String(idx + 1).padStart(2, '0')}
                              </span>
                              <span aria-hidden="true"> · </span>
                              <span>{sku.code}</span>
                              <span aria-hidden="true"> · </span>
                              <span>
                                LTP {sku.defaultLdpPrice.toLocaleString()} MMK
                              </span>
                            </div>
                            <h3 className="text-xs font-semibold text-slate-900 mt-0.5 leading-snug">
                              {sku.name}
                            </h3>
                            <p className="text-[11px] text-slate-500 truncate">
                              {sku.myanmarSubName}
                            </p>
                          </div>
                        </div>

                        {/* Paid Quantity & Unit Price */}
                        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                          <div>
                            <label
                              htmlFor={`qty-${sku.id}`}
                              className="block text-xs font-semibold text-slate-700 mb-1"
                            >
                              Paid Quantity
                            </label>
                            <input
                              id={`qty-${sku.id}`}
                              type="number"
                              min={0}
                              step={1}
                              value={state.quantity}
                              onFocus={(e) => e.currentTarget.select()}
                              onClick={(e) => e.currentTarget.select()}
                              onMouseUp={(e) => e.preventDefault()}
                              onChange={(e) =>
                                updateSkuField(
                                  sku.id,
                                  'quantity',
                                  e.target.value
                                )
                              }
                              className="w-full px-3 py-1.5 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`price-${sku.id}`}
                              className="flex items-center justify-between text-xs font-semibold text-slate-700 mb-1"
                            >
                              <span>Unit Price (MMK)</span>
                              {pricingMode === PricingMode.COMPANY_LDP && (
                                <Lock className="w-3 h-3 text-slate-400" />
                              )}
                            </label>
                            <input
                              id={`price-${sku.id}`}
                              type="number"
                              min={0}
                              step={5}
                              value={activePrice}
                              disabled={pricingMode === PricingMode.COMPANY_LDP}
                              onFocus={(e) => e.currentTarget.select()}
                              onClick={(e) => e.currentTarget.select()}
                              onMouseUp={(e) => e.preventDefault()}
                              onChange={(e) =>
                                updateSkuField(
                                  sku.id,
                                  'unitPrice',
                                  e.target.value
                                )
                              }
                              className={`w-full px-3 py-1.5 text-sm font-mono tabular-nums rounded-lg border ${
                                pricingMode === PricingMode.COMPANY_LDP
                                  ? 'bg-slate-100 border-slate-200 text-slate-600 cursor-not-allowed'
                                  : 'bg-amber-50/40 border-amber-400 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500'
                              }`}
                            />
                          </div>
                        </div>

                        {/* FOC Sampling Row (Permanently locked at 0 MMK) */}
                        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-semibold text-slate-700">
                              FOC (Free Of Charge)
                            </span>
                            <span className="text-slate-500 font-mono tabular-nums">
                              Locked @ 0 MMK
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <label
                                htmlFor={`foc-qty-${sku.id}`}
                                className="block text-[10px] font-medium text-slate-600 mb-0.5"
                              >
                                FOC Quantity
                              </label>
                              <input
                                id={`foc-qty-${sku.id}`}
                                type="number"
                                min={0}
                                step={1}
                                value={state.focQuantity}
                                onFocus={(e) => e.currentTarget.select()}
                                onClick={(e) => e.currentTarget.select()}
                                onMouseUp={(e) => e.preventDefault()}
                                onChange={(e) =>
                                  updateSkuField(
                                    sku.id,
                                    'focQuantity',
                                    e.target.value
                                  )
                                }
                                className="w-full px-2.5 py-1 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`foc-price-${sku.id}`}
                                className="flex items-center justify-between text-[10px] font-medium text-slate-600 mb-0.5"
                              >
                                <span>FOC Unit Price</span>
                                <Lock className="w-2.5 h-2.5 text-slate-400" />
                              </label>
                              <input
                                id={`foc-price-${sku.id}`}
                                type="number"
                                value={0}
                                disabled
                                readOnly
                                className="w-full px-2.5 py-1 text-xs font-mono tabular-nums bg-slate-200/70 border border-slate-200 rounded-md text-slate-500 cursor-not-allowed"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-slate-200 flex items-center justify-between text-xs tabular-nums">
                        <span className="font-medium text-slate-600">
                          Line Total:
                        </span>
                        <span className="text-sm font-bold font-mono text-slate-900">
                          {lineTotal.toLocaleString()} MMK
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Section 03: Grand Total Summary & Form Actions */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5 overflow-hidden">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                <div className="lg:col-span-6 min-w-0">
                  <label
                    htmlFor="activation-remarks"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    Field Remarks / Merchandising Note (Optional)
                  </label>
                  <input
                    id="activation-remarks"
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="POSM hanger placed, display verified, or wholesale delivery note..."
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 tabular-nums min-w-0">
                  <div className="flex sm:block items-center justify-between min-w-0">
                    <div className="text-[11px] text-slate-500">
                      Total Paid Qty
                    </div>
                    <div className="text-sm sm:text-base font-bold font-mono text-slate-900 truncate">
                      {totalPaidQty.toLocaleString()} pcs
                    </div>
                  </div>
                  <div className="flex sm:block items-center justify-between min-w-0">
                    <div className="text-[11px] text-slate-500">
                      Total FOC (0 MMK)
                    </div>
                    <div className="text-sm sm:text-base font-bold font-mono text-slate-900 truncate">
                      {totalFocQty.toLocaleString()} pcs
                    </div>
                  </div>
                  <div className="flex sm:block items-center justify-between min-w-0">
                    <div className="text-[11px] text-slate-500">
                      Grand Total (MMK)
                    </div>
                    <div className="text-sm sm:text-base font-bold font-mono text-amber-700 truncate">
                      {grandTotalMmk.toLocaleString()} MMK
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleAddNewForm}
                  className="min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                  Clear / New Form
                </button>

                <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
                  <button
                    type="button"
                    onClick={handlePreviewCurrentInvoice}
                    className="min-h-[42px] flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#0F2C59] bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Printer className="w-4 h-4 shrink-0" />
                    Generate POS Invoice Preview
                  </button>

                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="min-h-[42px] flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Send className="w-4 h-4 shrink-0" />
                    {isSubmitting
                      ? 'Saving Activation...'
                      : editingRecord
                      ? 'Update & Sync Record'
                      : 'Submit Survey'}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </form>
    </div>
  );
};
