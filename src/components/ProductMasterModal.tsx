import React, { useState } from 'react';
import {
  Package,
  Plus,
  X,
  Trash2,
  Upload,
  CheckCircle2,
  Edit3,
  Power,
} from 'lucide-react';
import { SkuDefinition, UserAccount, UserRole } from '../types';

interface ProductMasterModalProps {
  isOpen: boolean;
  onClose: () => void;
  skus: SkuDefinition[];
  currentUser: UserAccount;
  onAddSku: (newSku: SkuDefinition) => void;
  onUpdateSku: (updatedSku: SkuDefinition) => void;
  onToggleSkuActive: (skuId: string) => void;
  onDeleteSku: (skuId: string) => void;
}

const ACCENT_OPTIONS = [
  { id: 'amber', label: 'Amber Gold' },
  { id: 'yellow', label: 'Coconut Yellow' },
  { id: 'rose', label: 'Tom Yum Rose' },
  { id: 'emerald', label: 'Herb Emerald' },
  { id: 'blue', label: 'Navy Blue' },
  { id: 'purple', label: 'Mala Purple' },
];

export const ProductMasterModal: React.FC<ProductMasterModalProps> = ({
  isOpen,
  onClose,
  skus,
  currentUser,
  onAddSku,
  onUpdateSku,
  onToggleSkuActive,
  onDeleteSku,
}) => {
  const [showAddForm, setShowAddForm] = useState<boolean>(true);
  const [skuName, setSkuName] = useState<string>('');
  const [myanmarSubName, setMyanmarSubName] = useState<string>('');
  const [skuCode, setSkuCode] = useState<string>('');
  const [packSpec, setPackSpec] = useState<string>('1x30pcs');
  const [defaultLdpPrice, setDefaultLdpPrice] = useState<string>('800');
  const [accentColor, setAccentColor] = useState<string>('amber');
  const [imageUrl, setImageUrl] = useState<string>('');
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [editingSkuId, setEditingSkuId] = useState<string | null>(null);

  if (!isOpen) return null;

  const canManageProducts =
    currentUser.role === UserRole.ADMIN ||
    currentUser.role === UserRole.BRAND_MANAGER;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setSkuName('');
    setMyanmarSubName('');
    setSkuCode('');
    setPackSpec('1x30pcs');
    setDefaultLdpPrice('800');
    setAccentColor('amber');
    setImageUrl('');
    setEditingSkuId(null);
  };

  const handleStartEdit = (sku: SkuDefinition) => {
    setEditingSkuId(sku.id);
    setSkuName(sku.name);
    setMyanmarSubName(sku.myanmarSubName);
    setSkuCode(sku.code);
    setPackSpec(sku.packSpec);
    setDefaultLdpPrice(String(sku.defaultLdpPrice));
    setAccentColor(sku.accentColor || 'amber');
    setImageUrl(sku.imageUrl);
    setShowAddForm(true);
    setFeedback(null);
  };

  const handleSubmitProduct = (e: React.FormEvent) => {
    e.preventDefault();
    if (!skuName.trim()) return;

    const priceNum = Math.max(0, Number(defaultLdpPrice) || 0);
    const autoCode =
      skuCode.trim() ||
      `SHL-NEW-${String(skus.length + 1).padStart(2, '0')}`;

    if (editingSkuId) {
      const existing = skus.find((s) => s.id === editingSkuId);
      const updated: SkuDefinition = {
        id: editingSkuId,
        code: autoCode,
        name: skuName.trim(),
        myanmarSubName: myanmarSubName.trim() || skuName.trim(),
        packSpec: packSpec.trim() || '1x30pcs',
        defaultLdpPrice: priceNum,
        imageUrl: imageUrl.trim() || '/images/shaloot_chicken_sichat.jpg',
        accentColor,
        active: existing?.active !== false,
      };
      onUpdateSku(updated);
      setFeedback(`Updated SKU "${updated.name}" in Product Master List.`);
      resetForm();
      return;
    }

    const slugId =
      skuName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') + `_${Date.now().toString().slice(-4)}`;

    const newSku: SkuDefinition = {
      id: slugId,
      code: autoCode,
      name: skuName.trim(),
      myanmarSubName: myanmarSubName.trim() || skuName.trim(),
      packSpec: packSpec.trim() || '1x30pcs',
      defaultLdpPrice: priceNum,
      imageUrl: imageUrl.trim() || '/images/shaloot_chicken_sichat.jpg',
      accentColor,
      active: true,
    };

    onAddSku(newSku);
    setFeedback(
      `Added new SKU "${newSku.name}" (${newSku.defaultLdpPrice.toLocaleString()} MMK) to Product Master List.`
    );
    resetForm();
  };

  const activeSkusCount = skus.filter((s) => s.active !== false).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto overflow-x-hidden">
      <div className="app-modal-panel bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-3xl overflow-hidden my-4 sm:my-8">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-[#1E3E62] bg-[#0F2C59] text-white">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-blue-200">
              Pahtama Group · Product Master List
            </div>
            <h3 className="text-sm sm:text-base font-bold text-white break-words">
              Shaloot Noodle SKU Portfolio ({activeSkusCount} Active /{' '}
              {skus.length} Total)
            </h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canManageProducts && (
              <button
                type="button"
                onClick={() => {
                  resetForm();
                  setShowAddForm((prev) => !prev);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                {showAddForm ? 'Hide Form' : 'Add New SKU'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-blue-200 hover:text-white rounded-lg hover:bg-[#1E3E62] transition-colors cursor-pointer"
              aria-label="Close product master list"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-5 max-h-[78vh] overflow-y-auto overflow-x-hidden">
          {feedback && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}

          {showAddForm && canManageProducts && (
            <form
              onSubmit={handleSubmitProduct}
              className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    {editingSkuId
                      ? 'Edit Existing SKU'
                      : 'Add New Shaloot SKU to Catalog'}
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Synchronized automatically with Activation Form, POS
                    Invoices, Supabase, and Backend Catalog.
                  </p>
                </div>
                {editingSkuId && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Product / SKU Name <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={skuName}
                    onChange={(e) => setSkuName(e.target.value)}
                    placeholder="e.g., Shaloot Noodle Mala 55g (1x30pcs)"
                    required
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Default LTP Price (MMK){' '}
                    <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={5}
                    value={defaultLdpPrice}
                    onChange={(e) => setDefaultLdpPrice(e.target.value)}
                    required
                    className="w-full px-3.5 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Myanmar Sub-Name
                  </label>
                  <input
                    type="text"
                    value={myanmarSubName}
                    onChange={(e) => setMyanmarSubName(e.target.value)}
                    placeholder="e.g., ရှလွတ် မာလာခေါက်ဆွဲ (55g x 30pcs)"
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    SKU Code &amp; Pack Spec
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={skuCode}
                      onChange={(e) => setSkuCode(e.target.value)}
                      placeholder="SHL-ML-55"
                      className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                    <input
                      type="text"
                      value={packSpec}
                      onChange={(e) => setPackSpec(e.target.value)}
                      placeholder="1x30pcs"
                      className="w-full px-2.5 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Accent Color
                  </label>
                  <select
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {ACCENT_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-3 flex-1">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload SKU Image</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="Or paste SKU image URL..."
                    className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <button
                  type="submit"
                  className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  {editingSkuId ? 'Save SKU Changes' : 'Add SKU'}
                </button>
              </div>
            </form>
          )}

          {/* SKU Master List Cards */}
          <div className="space-y-3">
            {skus.map((sku, index) => {
              const isSkuActive = sku.active !== false;
              return (
                <div
                  key={sku.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-3.5 border rounded-xl transition-colors ${
                    isSkuActive
                      ? 'border-slate-200 bg-white'
                      : 'border-slate-200 bg-slate-50 opacity-75'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    <div className="w-14 h-14 rounded-lg bg-slate-50 border border-slate-200 p-1 shrink-0 flex items-center justify-center overflow-hidden">
                      {sku.imageUrl && !imgErrors[sku.id] ? (
                        <img
                          src={sku.imageUrl}
                          alt={sku.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain"
                          onError={() =>
                            setImgErrors((prev) => ({
                              ...prev,
                              [sku.id]: true,
                            }))
                          }
                        />
                      ) : (
                        <Package className="w-5 h-5 text-amber-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-slate-500">
                        <span>SKU {String(index + 1).padStart(2, '0')}</span>
                        <span aria-hidden="true">·</span>
                        <span>{sku.code}</span>
                        <span aria-hidden="true">·</span>
                        <span>{sku.packSpec}</span>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">
                          Accent: {sku.accentColor || 'amber'}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-slate-900 truncate mt-0.5">
                        {sku.name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {sku.myanmarSubName}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <div className="text-left sm:text-right font-mono tabular-nums">
                      <div className="text-[10px] text-slate-500">
                        Default LTP
                      </div>
                      <div className="text-sm font-bold text-slate-900">
                        {sku.defaultLdpPrice.toLocaleString()} MMK
                      </div>
                    </div>

                    {canManageProducts && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onToggleSkuActive(sku.id);
                            setFeedback(
                              `Toggled status for "${sku.name}".`
                            );
                          }}
                          title="Toggle SKU active status"
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                            isSkuActive
                              ? 'text-emerald-800 bg-emerald-50 hover:bg-emerald-100'
                              : 'text-slate-600 bg-slate-200 hover:bg-slate-300'
                          }`}
                        >
                          <Power className="w-3 h-3" />
                          {isSkuActive ? 'Active' : 'Inactive'}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleStartEdit(sku)}
                          title="Edit SKU"
                          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        {skus.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteSku(sku.id);
                              setFeedback(`Removed SKU "${sku.name}".`);
                            }}
                            title="Delete SKU"
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50">
          <span className="text-xs text-slate-500">
            FOC (Free Of Charge) unit prices for all SKUs are permanently locked
            at 0 MMK.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] rounded-lg transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
