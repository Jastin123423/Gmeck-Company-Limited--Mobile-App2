import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera,
  X,
  RefreshCw,
  Check,
  ImagePlus,
  Loader2,
  AlertTriangle,
  Trash2,
} from 'lucide-react';

export interface CameraCapturedPhoto {
  dataUrl: string;
  sizeKb: number;
}

interface ExistingPhotoPreview {
  id: string;
  dataUrl: string;
  sizeKb: number;
}

interface InAppCameraModalProps {
  isOpen: boolean;
  productName?: string;
  maxPhotos: number;
  existingPhotos: ExistingPhotoPreview[];
  onCapture: (photo: CameraCapturedPhoto) => void;
  onRemovePhoto: (photoId: string) => void;
  onFallbackFilePick: (files: FileList) => void;
  onClose: () => void;
}

const MAX_CAPTURE_DIM = 960;
const PRIMARY_JPEG_QUALITY = 0.62;
const SECONDARY_CAPTURE_DIM = 800;
const SECONDARY_JPEG_QUALITY = 0.5;
const MAX_TARGET_BYTES = 180 * 1024;

function dataUrlByteSize(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  return Math.round((base64.length * 3) / 4);
}

function captureVideoFrameCompressed(video: HTMLVideoElement): CameraCapturedPhoto | null {
  const srcWidth = video.videoWidth || 1280;
  const srcHeight = video.videoHeight || 720;
  if (srcWidth <= 0 || srcHeight <= 0) return null;

  const renderAt = (maxDim: number, quality: number): string | null => {
    let width = srcWidth;
    let height = srcHeight;
    if (width > maxDim || height > maxDim) {
      if (width >= height) {
        height = Math.max(1, Math.round((maxDim / width) * height));
        width = maxDim;
      } else {
        width = Math.max(1, Math.round((maxDim / height) * width));
        height = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    try {
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) return null;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);
      return canvas.toDataURL('image/jpeg', quality);
    } finally {
      // Immediately release native GPU/RAM canvas backing buffer
      canvas.width = 0;
      canvas.height = 0;
    }
  };

  let dataUrl = renderAt(MAX_CAPTURE_DIM, PRIMARY_JPEG_QUALITY);
  if (!dataUrl) return null;

  let bytes = dataUrlByteSize(dataUrl);
  if (bytes > MAX_TARGET_BYTES) {
    const tighter = renderAt(SECONDARY_CAPTURE_DIM, SECONDARY_JPEG_QUALITY);
    if (tighter) {
      const tighterBytes = dataUrlByteSize(tighter);
      if (tighterBytes < bytes) {
        dataUrl = tighter;
        bytes = tighterBytes;
      }
    }
  }

  return {
    dataUrl,
    sizeKb: Math.max(1, Math.round(bytes / 1024)),
  };
}

export const InAppCameraModal: React.FC<InAppCameraModalProps> = ({
  isOpen,
  productName,
  maxPhotos,
  existingPhotos,
  onCapture,
  onRemovePhoto,
  onFallbackFilePick,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fallbackInputRef = useRef<HTMLInputElement | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isStarting, setIsStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const stopStream = useCallback(() => {
    const current = streamRef.current;
    if (current) {
      current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch {
        // ignore
      }
    }
  }, []);

  const startCamera = useCallback(
    async (requestedFacing: 'environment' | 'user') => {
      stopStream();
      setIsStarting(true);
      setCameraError(null);

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        setIsStarting(false);
        setCameraError(
          'Kamera ya ndani ya app haipatikani kwenye kifaa hiki. Tumia kitufe cha Chagua Picha hapa chini.'
        );
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: requestedFacing },
              width: { ideal: 1280, max: 1600 },
              height: { ideal: 720, max: 1200 },
            },
            audio: false,
          });
        } catch {
          // Retry with minimal constraints for broad Android WebView compatibility
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch {
            // autoPlay handles playback once metadata loads
          }
        }
      } catch (err: any) {
        const msg = String(err?.name || err?.message || '');
        if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
          setCameraError(
            'Ruhusa ya kamera imekataliwa. Tafadhali ruhusu kamera kwenye mipangilio ya simu au chagua picha kutoka galari.'
          );
        } else {
          setCameraError(
            'Imeshindwa kufungua kamera ya moja kwa moja. Unaweza kuchagua picha kutoka galari hapa chini.'
          );
        }
      } finally {
        setIsStarting(false);
      }
    },
    [stopStream]
  );

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      setCameraError(null);
      return;
    }
    startCamera(facingMode);
    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, startCamera, stopStream]);

  if (!isOpen) return null;

  const isLimitReached = existingPhotos.length >= maxPhotos;

  const handleSnap = () => {
    if (isLimitReached || isCapturing || isStarting || cameraError) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    setIsCapturing(true);
    setIsFlashing(true);
    window.setTimeout(() => setIsFlashing(false), 120);

    try {
      const snapped = captureVideoFrameCompressed(video);
      if (snapped) {
        onCapture(snapped);
      }
    } finally {
      window.setTimeout(() => setIsCapturing(false), 150);
    }
  };

  const handleToggleFacing = () => {
    setFacingMode(prev => (prev === 'environment' ? 'user' : 'environment'));
  };

  return (
    <div
      id="in-app-camera-modal"
      className="fixed inset-0 z-[70] bg-black flex flex-col select-none"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-950/90 border-b border-slate-800/80 safe-top">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-400 shrink-0" />
            <h3 className="text-sm font-bold text-white truncate">
              {productName ? productName : 'Piga Picha ya Bidhaa'}
            </h3>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Picha {existingPhotos.length}/{maxPhotos} • Zinawekwa kwa ukubwa mdogo kuokoa bando
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleFacing}
            disabled={isStarting}
            title="Badilisha kamera (Mbele / Nyuma)"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 transition disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Funga kamera"
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Live Viewfinder Area */}
      <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center">
        {!cameraError ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {isStarting && (
              <div className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center gap-2 text-slate-200">
                <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
                <span className="text-xs font-medium">Inafungua kamera...</span>
              </div>
            )}
            {isFlashing && (
              <div className="absolute inset-0 bg-white/75 pointer-events-none transition-opacity" />
            )}
            {isLimitReached && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-emerald-600/95 text-white text-xs font-bold shadow-lg flex items-center gap-1.5">
                <Check className="w-4 h-4" />
                <span>Picha {maxPhotos}/{maxPhotos} zimekamilika! Bonyeza Maliza.</span>
              </div>
            )}
          </>
        ) : (
          <div className="max-w-sm mx-auto px-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7 text-amber-400" />
            </div>
            <p className="text-sm text-slate-200 leading-relaxed">{cameraError}</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => fallbackInputRef.current?.click()}
                disabled={isLimitReached}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition disabled:opacity-50"
              >
                <ImagePlus className="w-4 h-4" />
                <span>Chagua Picha kutoka Galari</span>
              </button>
              <button
                type="button"
                onClick={() => startCamera(facingMode)}
                className="w-full py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
              >
                Jaribu Kamera Tena
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls & Captured Strip */}
      <div className="bg-slate-950/95 border-t border-slate-800 px-4 py-3 space-y-3 safe-bottom">
        {/* Captured Photos Strip for this product */}
        {existingPhotos.length > 0 && (
          <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
            {existingPhotos.map((photo, idx) => (
              <div key={photo.id} className="relative shrink-0">
                <img
                  src={photo.dataUrl}
                  alt={`Picha ${idx + 1}`}
                  className="w-14 h-14 rounded-xl object-cover border-2 border-emerald-500/60"
                />
                <span className="absolute bottom-0.5 left-0.5 px-1 rounded bg-black/75 text-[9px] font-mono text-emerald-300">
                  {photo.sizeKb}KB
                </span>
                <button
                  type="button"
                  onClick={() => onRemovePhoto(photo.id)}
                  aria-label={`Futa picha ${idx + 1}`}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Hidden Gallery / File Fallback Input (no forced capture attribute so Android won't kill WebView on 2nd photo) */}
        <input
          ref={fallbackInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={e => {
            if (e.target.files && e.target.files.length > 0) {
              onFallbackFilePick(e.target.files);
            }
            e.target.value = '';
          }}
          className="hidden"
        />

        {/* Action Row: Gallery | Shutter | Done */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => fallbackInputRef.current?.click()}
            disabled={isLimitReached}
            className="flex flex-col items-center justify-center px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-semibold transition min-w-[76px] disabled:opacity-40"
          >
            <ImagePlus className="w-4 h-4 text-sky-400 mb-0.5" />
            <span>Galari</span>
          </button>

          {/* Big Center Shutter Button */}
          <button
            id="in-app-camera-shutter-btn"
            type="button"
            onClick={handleSnap}
            disabled={isLimitReached || isStarting || Boolean(cameraError) || isCapturing}
            aria-label="Piga picha"
            className="w-16 h-16 rounded-full border-4 border-white bg-emerald-500 hover:bg-emerald-400 active:scale-90 flex items-center justify-center shadow-xl shadow-emerald-900/50 transition disabled:opacity-35 disabled:bg-slate-700"
          >
            <Camera className="w-7 h-7 text-white" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className={`flex flex-col items-center justify-center px-3 py-2 rounded-xl border text-[11px] font-bold transition min-w-[76px] ${
              existingPhotos.length > 0
                ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
            }`}
          >
            <Check className="w-4 h-4 mb-0.5" />
            <span>Maliza ({existingPhotos.length}/{maxPhotos})</span>
          </button>
        </div>
      </div>
    </div>
  );
};
