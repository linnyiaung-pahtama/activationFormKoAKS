import React, { useState, useMemo, useEffect, useRef } from 'react';
import html2canvas from 'html2canvas';
import {
  Printer,
  X,
  CheckCircle2,
  Receipt,
  Share2,
  Copy,
  Check,
  Send,
  MessageCircle,
  Download,
  Smartphone,
  Bluetooth,
  FileText,
} from 'lucide-react';
import { NoodleActivationRecord, SkuDefinition } from '../types';
import {
  buildEscPosRasterReceiptBytes,
  buildEscPosTextReceiptBytes,
  formatThermalReceiptDocument,
  normalizeReceiptText,
  ThermalPaperWidth,
} from '../utils/thermalReceiptFormatter';

interface ThermalInvoiceModalProps {
  record: NoodleActivationRecord | null;
  skus?: SkuDefinition[];
  onClose: () => void;
}

interface BluetoothRemoteGATTCharacteristic {
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
  };
  writeValue?: (value: BufferSource) => Promise<void>;
  writeValueWithResponse?: (value: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
}

interface BluetoothRemoteGATTService {
  getCharacteristic: (
    characteristic: string
  ) => Promise<BluetoothRemoteGATTCharacteristic>;
  getCharacteristics: () => Promise<BluetoothRemoteGATTCharacteristic[]>;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect: () => Promise<BluetoothRemoteGATTServer>;
  disconnect: () => void;
  getPrimaryService: (service: string) => Promise<BluetoothRemoteGATTService>;
  getPrimaryServices: () => Promise<BluetoothRemoteGATTService[]>;
}

interface BluetoothDevice {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
}

const BT_THERMAL_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fee7-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000ff12-0000-1000-8000-00805f9b34fb',
  '0000af30-0000-1000-8000-00805f9b34fb',
  '00001101-0000-1000-8000-00805f9b34fb',
];

export function buildEscPosReceiptBytes(
  record: NoodleActivationRecord,
  paperWidth: ThermalPaperWidth,
  skus: SkuDefinition[] = []
): Uint8Array {
  return buildEscPosTextReceiptBytes(record, paperWidth, skus);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode(...Array.from(sub)));
  }
  return typeof window !== 'undefined' ? window.btoa(parts.join('')) : '';
}

function buildPureImageShareData(file: File): ShareData {
  const payload: Record<string, unknown> = {
    files: [file],
  };
  delete payload.url;
  delete payload.text;
  delete payload.title;
  return payload as ShareData;
}

async function copyPngBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.write === 'function' &&
      typeof ClipboardItem !== 'undefined'
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob }),
      ]);
      return true;
    }
  } catch {
    // Clipboard restriction fallback
  }
  return false;
}

export const ThermalInvoiceModal: React.FC<ThermalInvoiceModalProps> = ({
  record,
  skus = [],
  onClose,
}) => {
  const receiptPrintAreaRef = useRef<HTMLDivElement | null>(null);
  const btDeviceRef = useRef<BluetoothDevice | null>(null);
  const btCharacteristicRef = useRef<BluetoothRemoteGATTCharacteristic | null>(
    null
  );

  const [paperWidth, setPaperWidth] = useState<ThermalPaperWidth>('58mm');
  const [escPosEncodingMode, setEscPosEncodingMode] = useState<
    'raster' | 'utf8'
  >('raster');
  const [copiedPng, setCopiedPng] = useState<boolean>(false);
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [isCapturingPng, setIsCapturingPng] = useState<boolean>(false);
  const [isPrintingBluetooth, setIsPrintingBluetooth] =
    useState<boolean>(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [pngBlobUrl, setPngBlobUrl] = useState<string | null>(null);
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [pngBlob, setPngBlob] = useState<Blob | null>(null);

  const formattedReceipt = useMemo(() => {
    if (!record) return null;
    return formatThermalReceiptDocument(record, paperWidth, skus);
  }, [record, paperWidth, skus]);

  // Inject dynamic @page paper size matching active 58mm or 80mm roll during native print
  useEffect(() => {
    if (!record || typeof document === 'undefined') return;
    const styleId = 'thermal-dynamic-page-style';
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    const rollWidthMm = paperWidth === '58mm' ? '58mm' : '80mm';
    styleEl.textContent = `@media print { @page { size: ${rollWidthMm} auto; margin: 0mm !important; } }`;

    return () => {
      styleEl?.remove();
    };
  }, [record, paperWidth]);

  const captureInvoicePngBlobAndDataUrl = async (
    filename: string
  ): Promise<{ blob: Blob; file: File; dataUrl: string } | null> => {
    const targetNode = receiptPrintAreaRef.current;
    if (!targetNode || typeof document === 'undefined') return null;

    try {
      if (document.fonts && document.fonts.ready) {
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
      }

      const targetWidth = paperWidth === '58mm' ? 384 : 576;
      const canvas = await html2canvas(targetNode, {
        scale: 2,
        windowWidth: targetWidth,
        width: targetWidth,
        height: targetNode.scrollHeight,
        scrollX: 0,
        scrollY: 0,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
        onclone: (clonedDoc) => {
          clonedDoc.querySelectorAll('.no-print').forEach((el) => el.remove());
          const clonedPrintArea =
            clonedDoc.getElementById('thermal-print-area');
          if (clonedPrintArea) {
            clonedPrintArea.style.width = `${targetWidth}px`;
            clonedPrintArea.style.minWidth = `${targetWidth}px`;
            clonedPrintArea.style.maxWidth = `${targetWidth}px`;
            clonedPrintArea.style.margin = '0 auto';
            clonedPrintArea.style.backgroundColor = '#ffffff';
            clonedPrintArea.style.color = '#000000';
            clonedPrintArea.style.letterSpacing = '0px';
          }
        },
      });

      const dataUrl = canvas.toDataURL('image/png');
      const capturedBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });

      if (capturedBlob && dataUrl) {
        const cleanFile = new File([capturedBlob], filename, {
          type: 'image/png',
          lastModified: Date.now(),
        });
        return {
          blob: capturedBlob,
          file: cleanFile,
          dataUrl,
        };
      }
    } catch {
      // Fallback
    }
    return null;
  };

  useEffect(() => {
    if (!record) {
      setPngBlobUrl(null);
      setPngDataUrl(null);
      setPngBlob(null);
      return;
    }

    let isCancelled = false;
    let createdPngUrl: string | null = null;
    const safeInv = record.invoiceNo.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `Pahtama_Invoice_${safeInv}_${paperWidth}.png`;

    const timer = setTimeout(() => {
      void (async () => {
        const captured = await captureInvoicePngBlobAndDataUrl(filename);
        if (isCancelled || !captured) return;
        setPngDataUrl(captured.dataUrl);
        setPngBlob(captured.blob);
        createdPngUrl = URL.createObjectURL(captured.blob);
        setPngBlobUrl(createdPngUrl);
      })();
    }, 100);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      if (createdPngUrl) URL.revokeObjectURL(createdPngUrl);
    };
  }, [record, paperWidth, skus]);

  if (!record || !formattedReceipt) return null;

  const safeInvoiceNo = record.invoiceNo.replace(/[^a-zA-Z0-9._-]/g, '_');
  const downloadFilename = `Pahtama_Invoice_${safeInvoiceNo}_${paperWidth}.png`;
  const cleanInvoiceId = normalizeReceiptText(record.invoiceNo);

  const openUrlDirectly = (url: string, newTab = true) => {
    const a = document.createElement('a');
    a.href = url;
    if (newTab) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const triggerPngDownloadFromBlob = (blob: Blob, customFeedback?: string) => {
    try {
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = downloadFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      setShareFeedback(
        customFeedback || `Saved thermal receipt image (${downloadFilename}).`
      );
    } catch {
      setShareFeedback('Could not save invoice PNG image.');
    }
  };

  const handleSaveAsImage = async () => {
    setIsCapturingPng(true);
    try {
      const captured = await captureInvoicePngBlobAndDataUrl(downloadFilename);
      const activeBlob = captured?.blob || pngBlob;
      if (activeBlob) {
        triggerPngDownloadFromBlob(activeBlob);
      }
    } finally {
      setIsCapturingPng(false);
    }
  };

  const handleCopyFormattedText = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(formattedReceipt.plainText);
        setCopiedText(true);
        setShareFeedback(
          `Copied UTF-8 NFC formatted receipt (${formattedReceipt.spec.maxCols}-char width) to clipboard.`
        );
        setTimeout(() => setCopiedText(false), 2500);
      }
    } catch {
      setShareFeedback('Clipboard text copy unavailable in this browser.');
    }
  };

  const handlePosPrint = () => {
    setShareFeedback(
      `Opening ${paperWidth} (${formattedReceipt.spec.printableMm}mm printable width) thermal roll print dialog...`
    );
    try {
      window.focus();
      window.print();
    } catch {
      setShareFeedback(
        'System print dialog unavailable in this frame; use Save as Image or Bluetooth ESC/POS.'
      );
    }
  };

  const writeBleChunksSafely = async (
    characteristic: BluetoothRemoteGATTCharacteristic,
    data: Uint8Array
  ) => {
    const canWriteNoResp =
      characteristic.properties.writeWithoutResponse &&
      typeof characteristic.writeValueWithoutResponse === 'function';
    let chunkSize = canWriteNoResp ? 180 : 120;

    let offset = 0;
    while (offset < data.length) {
      const chunk = data.slice(offset, offset + chunkSize);
      try {
        if (
          canWriteNoResp &&
          typeof characteristic.writeValueWithoutResponse === 'function'
        ) {
          await characteristic.writeValueWithoutResponse(chunk);
          await new Promise((resolve) => setTimeout(resolve, 10));
        } else if (typeof characteristic.writeValueWithResponse === 'function') {
          await characteristic.writeValueWithResponse(chunk);
          await new Promise((resolve) => setTimeout(resolve, 18));
        } else if (typeof characteristic.writeValue === 'function') {
          await characteristic.writeValue(chunk);
          await new Promise((resolve) => setTimeout(resolve, 18));
        }
        offset += chunk.length;
      } catch (err) {
        if (chunkSize > 80) {
          // Automatically step down BLE packet size for legacy 20-100 byte MTU printers
          chunkSize = 80;
          continue;
        }
        throw err;
      }
    }
  };

  const handlePrintBluetoothReceipt = async () => {
    setIsPrintingBluetooth(true);
    try {
      // Use monochrome raster bitmap by default (or always when Burmese is present in raster mode)
      // so Burmese characters never print mojibake on CP437/GBK hardware ROM printers.
      const useRaster =
        escPosEncodingMode === 'raster' ||
        formattedReceipt.hasBurmeseOrNonAscii;
      const escPosBytes = useRaster
        ? await buildEscPosRasterReceiptBytes(record, paperWidth, skus)
        : buildEscPosTextReceiptBytes(record, paperWidth, skus);

      const navWithBt = navigator as Navigator & {
        bluetooth?: {
          requestDevice: (
            options: Record<string, unknown>
          ) => Promise<BluetoothDevice>;
        };
      };

      if (
        !navWithBt.bluetooth ||
        typeof navWithBt.bluetooth.requestDevice !== 'function'
      ) {
        const base64EscPos = uint8ArrayToBase64(escPosBytes);
        openUrlDirectly(`rawbt:base64,${base64EscPos}`, false);
        setShareFeedback(
          'Sent Burmese-encoded ESC/POS stream to RawBT Bluetooth thermal printer helper.'
        );
        return;
      }

      let characteristic = btCharacteristicRef.current;

      if (
        !characteristic ||
        !btDeviceRef.current?.gatt ||
        !btDeviceRef.current.gatt.connected
      ) {
        setShareFeedback(
          'Scanning for 58mm/80mm Bluetooth thermal printers (Rongta, Xprinter, Sunmi, ESC/POS)...'
        );
        const device = await navWithBt.bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: BT_THERMAL_PRINTER_SERVICES,
        });

        if (!device.gatt) {
          throw new Error('Selected Bluetooth printer does not support GATT.');
        }

        const server = await device.gatt.connect();
        let foundChar: BluetoothRemoteGATTCharacteristic | null = null;
        const services = await server.getPrimaryServices();
        for (const svc of services) {
          try {
            const chars = await svc.getCharacteristics();
            const writable = chars.find(
              (c) => c.properties.write || c.properties.writeWithoutResponse
            );
            if (writable) {
              foundChar = writable;
              break;
            }
          } catch {
            // Continue searching services
          }
        }

        if (!foundChar) {
          throw new Error(
            'Connected to printer, but no writable ESC/POS characteristic was found.'
          );
        }

        btDeviceRef.current = device;
        btCharacteristicRef.current = foundChar;
        characteristic = foundChar;
      }

      setShareFeedback(
        `Transmitting ${paperWidth} ${
          useRaster ? 'Myanmar Unicode Raster' : 'UTF-8'
        } receipt to thermal printer...`
      );
      await writeBleChunksSafely(characteristic, escPosBytes);

      setShareFeedback(
        `Printed ${paperWidth} receipt (${cleanInvoiceId}) cleanly with Burmese Unicode encoding!`
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'NotFoundError') {
        setShareFeedback('Bluetooth printer pairing cancelled.');
        return;
      }
      const msg =
        err instanceof Error ? err.message : 'Bluetooth connection failed';
      setShareFeedback(`Bluetooth print note: ${msg}`);
    } finally {
      setIsPrintingBluetooth(false);
    }
  };

  const handleCopyInvoicePng = async () => {
    setIsCapturingPng(true);
    try {
      const captured = await captureInvoicePngBlobAndDataUrl(downloadFilename);
      const blob = captured?.blob || pngBlob;
      if (!blob) return;
      setPngBlob(blob);
      const ok = await copyPngBlobToClipboard(blob);
      if (ok) {
        setCopiedPng(true);
        setShareFeedback(
          'Receipt image copied to clipboard! Paste directly into Viber, Telegram, or Messenger.'
        );
        setTimeout(() => setCopiedPng(false), 2500);
      } else {
        triggerPngDownloadFromBlob(
          blob,
          `Clipboard image copy unsupported on this browser - downloaded ${downloadFilename} instead.`
        );
      }
    } finally {
      setIsCapturingPng(false);
    }
  };

  const handleShareInvoicePng = async (targetApp?: string) => {
    setIsCapturingPng(true);
    try {
      const captured = await captureInvoicePngBlobAndDataUrl(downloadFilename);
      const activeBlob = captured?.blob || pngBlob;
      if (!activeBlob) return;

      const cleanPngFile = new File([activeBlob], downloadFilename, {
        type: 'image/png',
        lastModified: Date.now(),
      });
      const pureImageShareData = buildPureImageShareData(cleanPngFile);

      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.share === 'function' &&
        (!navigator.canShare || navigator.canShare(pureImageShareData))
      ) {
        try {
          await navigator.share(pureImageShareData);
          setShareFeedback(
            targetApp
              ? `Shared receipt PNG to ${targetApp}.`
              : `Shared receipt PNG (${downloadFilename}).`
          );
          return;
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') return;
        }
      }

      await copyPngBlobToClipboard(activeBlob);
      triggerPngDownloadFromBlob(
        activeBlob,
        targetApp
          ? `Downloaded & copied ${downloadFilename} - attach or paste into ${targetApp}.`
          : `Downloaded & copied ${downloadFilename}.`
      );
    } finally {
      setIsCapturingPng(false);
    }
  };

  const rawBtPosHref = pngDataUrl ? `rawbt:${pngDataUrl}` : '#';

  return (
    <div
      id="thermal-modal-root"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-2 sm:p-4 overflow-y-auto"
    >
      <div
        id="thermal-modal-card"
        className={`bg-white border border-slate-200 rounded-xl shadow-xl w-full max-h-[95vh] flex flex-col overflow-hidden transition-all ${
          paperWidth === '80mm' ? 'max-w-[650px]' : 'max-w-[460px]'
        }`}
      >
        {/* Top Modal Header */}
        <div className="no-print flex items-center justify-between px-4 py-3 border-b border-[#1E3E62] bg-[#0F2C59] text-white shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Receipt className="w-4 h-4 text-amber-300 shrink-0" />
            <h3 className="text-xs sm:text-sm font-semibold text-white truncate">
              Thermal POS Invoice ({paperWidth} · {formattedReceipt.spec.maxCols} cols)
            </h3>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex items-center bg-[#1E3E62] p-0.5 rounded-lg border border-blue-400/25">
              <button
                type="button"
                onClick={() => setPaperWidth('58mm')}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  paperWidth === '58mm'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-blue-100 hover:text-white'
                }`}
              >
                58mm (32 ch)
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth('80mm')}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  paperWidth === '80mm'
                    ? 'bg-amber-400 text-slate-950'
                    : 'text-blue-100 hover:text-white'
                }`}
              >
                80mm (48 ch)
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-blue-200 hover:text-white rounded-lg hover:bg-[#1E3E62] transition-colors cursor-pointer"
              aria-label="Close invoice preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Share, Encoding & Copy Toolbar */}
        <div className="no-print px-4 py-2.5 bg-slate-50 border-b border-slate-200 space-y-2 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={isCapturingPng}
                onClick={() => void handleSaveAsImage()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#0F2C59] bg-white hover:bg-slate-100 border border-slate-300 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <Download className="w-3 h-3" />
                Save Image
              </button>

              <button
                type="button"
                disabled={isCapturingPng}
                onClick={() => void handleCopyInvoicePng()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#0F2C59] bg-white hover:bg-slate-100 border border-slate-300 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                {copiedPng ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    Copied PNG
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    Copy Image
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleCopyFormattedText()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#0F2C59] bg-white hover:bg-slate-100 border border-slate-300 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                {copiedText ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    Copied Text
                  </>
                ) : (
                  <>
                    <FileText className="w-3 h-3" />
                    Copy Text
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={isCapturingPng}
                onClick={() => void handleShareInvoicePng('Viber')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-purple-700 hover:bg-purple-800 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <MessageCircle className="w-3 h-3" />
                Viber
              </button>

              <button
                type="button"
                disabled={isCapturingPng}
                onClick={() => void handleShareInvoicePng('Telegram')}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <Send className="w-3 h-3" />
                Telegram
              </button>

              <button
                type="button"
                disabled={isCapturingPng}
                onClick={() => void handleShareInvoicePng()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 bg-slate-200/80 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                <Share2 className="w-3 h-3" />
                Share
              </button>

              <a
                href={rawBtPosHref}
                onClick={(e) => {
                  if (!pngDataUrl) {
                    e.preventDefault();
                    void handlePrintBluetoothReceipt();
                  } else {
                    setShareFeedback(
                      'Sending Burmese-compatible receipt image to RawBT POS print service...'
                    );
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors whitespace-nowrap cursor-pointer no-underline"
              >
                <Smartphone className="w-3 h-3" />
                RawBT App
              </a>
            </div>

            <button
              type="button"
              onClick={() =>
                setEscPosEncodingMode((prev) =>
                  prev === 'raster' ? 'utf8' : 'raster'
                )
              }
              title="Raster Bitmap renders Burmese Unicode without mojibake on all ESC/POS printers"
              className="px-2 py-1 text-[10.5px] font-semibold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap cursor-pointer"
            >
              BT Mode:{' '}
              {escPosEncodingMode === 'raster'
                ? 'Myanmar Raster (No Mojibake)'
                : 'UTF-8 Text'}
            </button>
          </div>

          {shareFeedback && (
            <div className="text-[11px] text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-1 font-medium">
              {shareFeedback}
            </div>
          )}
        </div>

        {/* Thermal Paper Roll Viewport */}
        <div
          id="thermal-modal-viewport"
          className="p-3 sm:p-4 bg-[#E2E8F0] flex-1 overflow-y-auto overflow-x-auto flex justify-center items-start"
        >
          <div
            ref={receiptPrintAreaRef}
            id="thermal-print-area"
            lang="my"
            data-paper-width={paperWidth}
            className={`receipt-container thermal-receipt-font bg-white text-black border border-slate-300 shadow-xs overflow-hidden transition-all ${
              paperWidth === '58mm'
                ? 'w-[384px] min-w-[384px] max-w-[384px] px-3.5 py-3.5 text-[11px]'
                : 'w-[576px] min-w-[576px] max-w-[576px] px-5 py-5 text-[12px]'
            }`}
          >
            {/* Pre-Wrapped, NFC-Normalized Thermal Lines */}
            <div className="w-full max-w-full space-y-0.5">
              {formattedReceipt.lines.map((entry, idx) => {
                if (entry.kind === 'divider-double') {
                  return (
                    <div
                      key={idx}
                      className="w-full border-t-2 border-black my-1.5"
                      aria-hidden="true"
                    />
                  );
                }

                if (entry.kind === 'divider-single') {
                  return (
                    <div
                      key={idx}
                      className="w-full border-t border-dashed border-black my-1.5"
                      aria-hidden="true"
                    />
                  );
                }

                if (entry.kind === 'divider-dotted') {
                  return (
                    <div
                      key={idx}
                      className="w-full border-t border-dotted border-neutral-500 my-1"
                      aria-hidden="true"
                    />
                  );
                }

                if (entry.kind === 'title') {
                  return (
                    <div
                      key={idx}
                      className={`w-full text-center font-black break-words ${
                        paperWidth === '58mm' ? 'text-[13.5px]' : 'text-[15.5px]'
                      }`}
                    >
                      {entry.text}
                    </div>
                  );
                }

                if (entry.kind === 'subtitle') {
                  return (
                    <div
                      key={idx}
                      className="w-full text-center font-bold text-[11px] break-words"
                    >
                      {entry.text}
                    </div>
                  );
                }

                if (entry.kind === 'center') {
                  return (
                    <div
                      key={idx}
                      className="w-full text-center font-semibold text-[10px] text-neutral-800 break-words"
                    >
                      {entry.text}
                    </div>
                  );
                }

                if (entry.kind === 'total-grand') {
                  return (
                    <div
                      key={idx}
                      className={`w-full flex items-baseline justify-between gap-2 font-black tabular-nums pt-0.5 ${
                        paperWidth === '58mm' ? 'text-[13px]' : 'text-[14.5px]'
                      }`}
                    >
                      <span className="min-w-0 break-words">{entry.left}</span>
                      <span className="shrink-0 text-right">{entry.right}</span>
                    </div>
                  );
                }

                if (entry.kind === 'kv' || entry.kind === 'kv-bold') {
                  const isBold = entry.kind === 'kv-bold';
                  return (
                    <div
                      key={idx}
                      className={`w-full flex items-baseline justify-between gap-2 tabular-nums ${
                        isBold ? 'font-bold' : 'font-medium'
                      }`}
                    >
                      <span className="min-w-0 text-left break-words whitespace-pre-wrap">
                        {entry.left}
                      </span>
                      <span
                        className={`shrink-0 text-right ${
                          isBold ? 'font-black' : 'font-semibold'
                        }`}
                      >
                        {entry.right}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={idx}
                    className={`w-full text-left break-words whitespace-pre-wrap ${
                      entry.kind === 'text-bold' ? 'font-bold' : 'font-medium'
                    }`}
                  >
                    {entry.text}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Primary Actions */}
        <div className="no-print flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 bg-white shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-[#0F2C59] font-semibold">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              {paperWidth} ({formattedReceipt.spec.printableMm}mm /{' '}
              {formattedReceipt.spec.maxCols} ch) Ready
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[38px] px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              Close
            </button>

            <a
              href={pngBlobUrl || pngDataUrl || '#'}
              download={downloadFilename}
              onClick={(e) => {
                if (!pngBlobUrl && !pngDataUrl) {
                  e.preventDefault();
                  void handleSaveAsImage();
                } else {
                  setShareFeedback(
                    `Saved receipt image (${downloadFilename}).`
                  );
                }
              }}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#1E3E62] hover:bg-[#284f7c] rounded-lg transition-colors whitespace-nowrap cursor-pointer no-underline"
            >
              <Download className="w-3.5 h-3.5" />
              Save / Copy PNG
            </a>

            <button
              type="button"
              disabled={isPrintingBluetooth}
              onClick={() => void handlePrintBluetoothReceipt()}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Bluetooth className="w-3.5 h-3.5" />
              {isPrintingBluetooth ? 'Printing...' : 'Bluetooth ESC/POS'}
            </button>

            <button
              type="button"
              onClick={handlePosPrint}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#0F2C59] hover:bg-[#1E3E62] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Invoice
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
