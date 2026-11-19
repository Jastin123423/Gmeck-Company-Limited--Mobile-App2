import { Capacitor, registerPlugin } from '@capacitor/core';

export const DEFAULT_DOWNLOAD_FOLDER = 'Gmeck media';

interface NativeFileDownloadPluginInterface {
  saveAndOpenFile(options: {
    fileName: string;
    base64Data: string;
    mimeType: string;
    folder?: string;
    openAfterSave?: boolean;
  }): Promise<{
    saved: boolean;
    fileName: string;
    location: string;
    uri?: string;
    opened?: boolean;
  }>;
}

const NativeFileDownload =
  registerPlugin<NativeFileDownloadPluginInterface>('NativeFileDownload');

export interface FileDownloadResult {
  ok: boolean;
  fileName: string;
  location?: string;
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

function triggerWebBlobDownload(blob: Blob, fileName: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return false;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    if (link.parentNode) link.parentNode.removeChild(link);
    URL.revokeObjectURL(url);
  }, 5000);
  return true;
}

/**
 * Cross-platform file downloader:
 * - On Android / iOS Capacitor APK: writes directly to native Downloads via
 *   NativeFileDownloadPlugin (MediaStore on Android 10+, FileProvider on Android 7-9)
 *   and opens the file in the device viewer/share sheet.
 * - On Web / AI Studio preview / Desktop: triggers an instant Blob <a download>.
 */
export async function saveFileCrossPlatform(options: {
  fileName: string;
  mimeType: string;
  blob?: Blob;
  base64Data?: string;
  folder?: string;
  openAfterSave?: boolean;
}): Promise<FileDownloadResult> {
  const {
    fileName,
    mimeType,
    blob,
    folder = DEFAULT_DOWNLOAD_FOLDER,
    openAfterSave = true,
  } = options;

  try {
    if (Capacitor.isNativePlatform()) {
      let base64 = options.base64Data || '';
      if (!base64 && blob) {
        base64 = await blobToBase64(blob);
      }
      if (!base64) {
        return { ok: false, fileName, error: 'Missing file content.' };
      }

      const res = await NativeFileDownload.saveAndOpenFile({
        fileName,
        base64Data: base64,
        mimeType,
        folder,
        openAfterSave,
      });

      if (res && res.saved) {
        return {
          ok: true,
          fileName: res.fileName || fileName,
          location: res.location || `Downloads/${folder}/${fileName}`,
        };
      }
      return { ok: false, fileName, error: 'Device did not confirm file save.' };
    }

    // Web / Browser path
    let outBlob = blob;
    if (!outBlob && options.base64Data) {
      const clean = options.base64Data.includes(',')
        ? options.base64Data.split(',')[1]
        : options.base64Data;
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      outBlob = new Blob([bytes], { type: mimeType });
    }

    if (!outBlob) {
      return { ok: false, fileName, error: 'Missing file content.' };
    }

    const ok = triggerWebBlobDownload(outBlob, fileName);
    return ok
      ? { ok: true, fileName, location: fileName }
      : { ok: false, fileName, error: 'Browser download unavailable.' };
  } catch (err: any) {
    console.error('[nativeDownload] Failed to save file:', fileName, err);
    return {
      ok: false,
      fileName,
      error: err?.message || 'Unable to save file on this device.',
    };
  }
}

export async function saveTextFileCrossPlatform(
  text: string,
  fileName: string,
  mimeType: string = 'text/plain;charset=utf-8'
): Promise<FileDownloadResult> {
  const blob = new Blob([text], { type: mimeType });
  return saveFileCrossPlatform({
    fileName,
    mimeType: mimeType.split(';')[0],
    blob,
    openAfterSave: true,
  });
}
