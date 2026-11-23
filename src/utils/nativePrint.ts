import { Capacitor, registerPlugin } from '@capacitor/core';
import { saveFileCrossPlatform } from './nativeDownload';

export type PrintOrientation = 'portrait' | 'landscape';
export type PrintPaperSize = 'a4' | 'receipt';

interface NativePrintPluginInterface {
  isSupported(): Promise<{ supported: boolean; platform: string }>;
  printPdf(options: {
    base64Data: string;
    jobName: string;
    orientation?: PrintOrientation;
    paperSize?: PrintPaperSize;
  }): Promise<{
    started: boolean;
    jobName: string;
  }>;
}

const NativePrint = registerPlugin<NativePrintPluginInterface>('NativePrint');

export interface PrintPdfResult {
  ok: boolean;
  mode: 'android_native' | 'web_print' | 'fallback_download' | 'failed';
  jobName: string;
  error?: string;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  return uint8ArrayToBase64(new Uint8Array(buffer));
}

function base64ToBlob(base64Data: string, mimeType: string): Blob {
  const clean = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/**
 * Triggers native browser print dialog for a PDF Blob via a hidden off-screen iframe
 * (never uses window.open so it works seamlessly inside iframes & mobile browsers).
 */
function printPdfBlobViaIframe(blob: Blob): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      resolve(false);
      return;
    }

    const blobUrl = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';

    let settled = false;
    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      window.setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
        URL.revokeObjectURL(blobUrl);
      }, 1500);
    };

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        finish(false);
        return;
      }

      try {
        win.addEventListener('afterprint', cleanup, { once: true });
      } catch {
        // Ignore cross-context listener restriction on some PDF viewers
      }

      window.setTimeout(() => {
        try {
          win.focus();
          win.print();
          finish(true);
          // Safety cleanup after 2 minutes in case afterprint doesn't fire
          window.setTimeout(cleanup, 120000);
        } catch (err) {
          console.warn('[nativePrint] Iframe PDF print failed:', err);
          cleanup();
          finish(false);
        }
      }, 280);
    };

    iframe.onerror = () => {
      cleanup();
      finish(false);
    };

    iframe.src = blobUrl;
    document.body.appendChild(iframe);

    // Fallback safety if iframe onload never fires
    window.setTimeout(() => {
      if (!settled) {
        cleanup();
        finish(false);
      }
    }, 8000);
  });
}

/**
 * Professional cross-platform PDF printer:
 * - On Android Capacitor APK: opens the native Android System Print Spooler
 *   (Wi-Fi, Bluetooth/Thermal Print Services, USB OTG, Mopria, HP, Epson, Canon, Save as PDF).
 * - On Web / Desktop / Mobile Browser: prints directly via hidden PDF iframe without popups.
 * - Automatic graceful fallback if a print bridge is unavailable.
 */
export async function printPdfCrossPlatform(options: {
  jobName: string;
  fileName?: string;
  blob?: Blob;
  base64Data?: string;
  orientation?: PrintOrientation;
  paperSize?: PrintPaperSize;
}): Promise<PrintPdfResult> {
  const {
    jobName,
    fileName = 'document.pdf',
    blob,
    orientation = 'portrait',
    paperSize = 'a4',
  } = options;

  try {
    // 1. Native Android / iOS Capacitor APK path
    if (Capacitor.isNativePlatform()) {
      let base64 = options.base64Data || '';
      if (!base64 && blob) {
        base64 = await blobToBase64(blob);
      }
      if (!base64) {
        return {
          ok: false,
          mode: 'failed',
          jobName,
          error: 'Missing PDF content for printing.',
        };
      }

      try {
        const res = await NativePrint.printPdf({
          base64Data: base64,
          jobName,
          orientation,
          paperSize,
        });
        if (res && res.started) {
          return {
            ok: true,
            mode: 'android_native',
            jobName: res.jobName || jobName,
          };
        }
      } catch (nativeErr: any) {
        console.warn(
          '[nativePrint] Native Android print plugin error, falling back to device PDF viewer:',
          nativeErr
        );
        // Graceful fallback if running an older APK before rebuilding with NativePrintPlugin
        const fallbackRes = await saveFileCrossPlatform({
          fileName,
          mimeType: 'application/pdf',
          base64Data: base64,
          openAfterSave: true,
        });
        if (fallbackRes.ok) {
          return {
            ok: true,
            mode: 'fallback_download',
            jobName,
          };
        }
        return {
          ok: false,
          mode: 'failed',
          jobName,
          error: nativeErr?.message || 'Unable to launch Android print dialog.',
        };
      }
    }

    // 2. Web / Desktop / Mobile Browser path
    const outBlob =
      blob ||
      (options.base64Data ? base64ToBlob(options.base64Data, 'application/pdf') : undefined);

    if (!outBlob) {
      return {
        ok: false,
        mode: 'failed',
        jobName,
        error: 'Missing PDF content for printing.',
      };
    }

    const printed = await printPdfBlobViaIframe(outBlob);
    if (printed) {
      return {
        ok: true,
        mode: 'web_print',
        jobName,
      };
    }

    // 3. Final fallback: download the PDF if iframe printing is blocked
    const dlRes = await saveFileCrossPlatform({
      fileName,
      mimeType: 'application/pdf',
      blob: outBlob,
      openAfterSave: true,
    });
    if (dlRes.ok) {
      return {
        ok: true,
        mode: 'fallback_download',
        jobName,
      };
    }

    return {
      ok: false,
      mode: 'failed',
      jobName,
      error: 'Printing is unavailable on this browser.',
    };
  } catch (err: any) {
    console.error('[nativePrint] Print failed:', jobName, err);
    return {
      ok: false,
      mode: 'failed',
      jobName,
      error: err?.message || 'Unable to print document on this device.',
    };
  }
}
