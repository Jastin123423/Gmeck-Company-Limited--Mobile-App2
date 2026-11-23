package com.diocres.hardwaresolutions;

import android.app.Activity;
import android.content.Context;
import android.graphics.pdf.PdfRenderer;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {
    private static final String TAG = "NativePrint";
    private static final String PRINT_CACHE_DIR = "print_jobs";
    private static final long STALE_FILE_AGE_MS = 60L * 60L * 1000L; // 1 hour

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject res = new JSObject();
        res.put("supported", true);
        res.put("platform", "android");
        call.resolve(res);
    }

    @PluginMethod
    public void printPdf(PluginCall call) {
        String base64Data = call.getString("base64Data");
        String rawJobName = call.getString("jobName", "Document");
        String orientation = call.getString("orientation", "portrait");
        String paperSize = call.getString("paperSize", "a4");

        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("Missing PDF data for printing.");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Android Activity is unavailable for printing.");
            return;
        }

        String jobName = sanitizeJobName(rawJobName);
        String fileName = sanitizeFileName(jobName) + ".pdf";

        try {
            String cleanBase64 = base64Data;
            int commaIdx = cleanBase64.indexOf(',');
            if (commaIdx != -1) {
                cleanBase64 = cleanBase64.substring(commaIdx + 1);
            }
            byte[] pdfBytes = Base64.decode(cleanBase64, Base64.DEFAULT);
            if (pdfBytes == null || pdfBytes.length == 0) {
                call.reject("Decoded PDF document is empty.");
                return;
            }

            Context context = getContext();
            File printDir = new File(context.getCacheDir(), PRINT_CACHE_DIR);
            if (!printDir.exists()) {
                //noinspection ResultOfMethodCallIgnored
                printDir.mkdirs();
            }
            cleanupStaleFiles(printDir);

            File tempPdfFile = new File(
                printDir,
                "print_" + System.currentTimeMillis() + "_" + fileName
            );
            try (FileOutputStream fos = new FileOutputStream(tempPdfFile)) {
                fos.write(pdfBytes);
                fos.flush();
            }

            final PrintAttributes attributes = buildPrintAttributes(orientation, paperSize);

            activity.runOnUiThread(() -> {
                try {
                    PrintManager printManager =
                        (PrintManager) activity.getSystemService(Context.PRINT_SERVICE);
                    if (printManager == null) {
                        deleteQuietly(tempPdfFile);
                        call.reject("Android Print service is unavailable on this device.");
                        return;
                    }

                    PdfFilePrintDocumentAdapter adapter =
                        new PdfFilePrintDocumentAdapter(tempPdfFile, fileName);
                    printManager.print(jobName, adapter, attributes);

                    JSObject result = new JSObject();
                    result.put("started", true);
                    result.put("jobName", jobName);
                    call.resolve(result);
                } catch (Exception uiErr) {
                    deleteQuietly(tempPdfFile);
                    Log.e(TAG, "Failed to start Android print job: " + jobName, uiErr);
                    call.reject("Failed to open Android Print dialog: " + uiErr.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Failed to prepare PDF for printing: " + jobName, e);
            call.reject("Failed to prepare document for printing: " + e.getMessage());
        }
    }

    private PrintAttributes buildPrintAttributes(String orientation, String paperSize) {
        PrintAttributes.Builder builder = new PrintAttributes.Builder();
        builder.setColorMode(PrintAttributes.COLOR_MODE_COLOR);
        builder.setMinMargins(PrintAttributes.Margins.NO_MARGINS);

        boolean isLandscape = "landscape".equalsIgnoreCase(orientation);
        boolean isReceipt = "receipt".equalsIgnoreCase(paperSize);

        if (isReceipt) {
            // 80mm thermal receipt roll media size (3150 mils x 11690 mils)
            PrintAttributes.MediaSize receiptSize = new PrintAttributes.MediaSize(
                "POS_RECEIPT_80MM",
                "80mm POS Receipt",
                3150,
                11690
            );
            builder.setMediaSize(receiptSize);
        } else if (isLandscape) {
            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape());
        } else {
            builder.setMediaSize(PrintAttributes.MediaSize.ISO_A4.asPortrait());
        }

        return builder.build();
    }

    private void cleanupStaleFiles(File dir) {
        try {
            File[] files = dir.listFiles();
            if (files == null) return;
            long cutoff = System.currentTimeMillis() - STALE_FILE_AGE_MS;
            for (File f : files) {
                if (f.isFile() && f.lastModified() < cutoff) {
                    deleteQuietly(f);
                }
            }
        } catch (Exception ignored) {
            // Best-effort cache cleanup
        }
    }

    private static void deleteQuietly(File file) {
        if (file != null && file.exists()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private String sanitizeJobName(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return "Document";
        }
        String cleaned = raw.replaceAll("[\\r\\n\\t]+", " ").trim();
        if (cleaned.length() > 80) {
            cleaned = cleaned.substring(0, 80).trim();
        }
        return cleaned.isEmpty() ? "Document" : cleaned;
    }

    private String sanitizeFileName(String raw) {
        String cleaned = raw.replace("\\", "_").replace("/", "_").trim();
        cleaned = cleaned.replaceAll("[^a-zA-Z0-9._-]", "_").replaceAll("_+", "_");
        if (cleaned.isEmpty() || cleaned.equals(".") || cleaned.equals("..")) {
            return "document";
        }
        if (cleaned.toLowerCase().endsWith(".pdf")) {
            cleaned = cleaned.substring(0, cleaned.length() - 4);
        }
        return cleaned;
    }

    /**
     * Streams a pre-rendered PDF file directly to Android's native Print Spooler,
     * supporting Wi-Fi, Bluetooth, USB OTG, thermal print services, and Save as PDF.
     */
    private static class PdfFilePrintDocumentAdapter extends PrintDocumentAdapter {
        private final File pdfFile;
        private final String documentName;

        PdfFilePrintDocumentAdapter(File pdfFile, String documentName) {
            this.pdfFile = pdfFile;
            this.documentName = documentName;
        }

        @Override
        public void onLayout(
            PrintAttributes oldAttributes,
            PrintAttributes newAttributes,
            CancellationSignal cancellationSignal,
            LayoutResultCallback callback,
            Bundle extras
        ) {
            if (cancellationSignal != null && cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }

            if (!pdfFile.exists() || pdfFile.length() == 0) {
                callback.onLayoutFailed("Print document file is no longer available.");
                return;
            }

            int pageCount = PrintDocumentInfo.PAGE_COUNT_UNKNOWN;
            try (
                ParcelFileDescriptor pfd = ParcelFileDescriptor.open(
                    pdfFile,
                    ParcelFileDescriptor.MODE_READ_ONLY
                );
                PdfRenderer renderer = new PdfRenderer(pfd)
            ) {
                int count = renderer.getPageCount();
                if (count > 0) {
                    pageCount = count;
                }
            } catch (Exception e) {
                Log.w(TAG, "Unable to pre-count PDF pages; using PAGE_COUNT_UNKNOWN", e);
            }

            PrintDocumentInfo info = new PrintDocumentInfo.Builder(documentName)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(pageCount)
                .build();

            boolean changed = oldAttributes == null || !oldAttributes.equals(newAttributes);
            callback.onLayoutFinished(info, changed);
        }

        @Override
        public void onWrite(
            PageRange[] pages,
            ParcelFileDescriptor destination,
            CancellationSignal cancellationSignal,
            WriteResultCallback callback
        ) {
            if (cancellationSignal != null && cancellationSignal.isCanceled()) {
                callback.onWriteCancelled();
                return;
            }

            try (
                InputStream in = new FileInputStream(pdfFile);
                OutputStream out = new FileOutputStream(destination.getFileDescriptor())
            ) {
                byte[] buffer = new byte[16384];
                int bytesRead;
                while ((bytesRead = in.read(buffer)) >= 0) {
                    if (cancellationSignal != null && cancellationSignal.isCanceled()) {
                        callback.onWriteCancelled();
                        return;
                    }
                    out.write(buffer, 0, bytesRead);
                }
                out.flush();
                callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (IOException e) {
                Log.e(TAG, "Error writing PDF stream to Android print spooler", e);
                callback.onWriteFailed("Failed to send document to printer: " + e.getMessage());
            }
        }

        @Override
        public void onFinish() {
            super.onFinish();
            deleteQuietly(pdfFile);
        }
    }
}
