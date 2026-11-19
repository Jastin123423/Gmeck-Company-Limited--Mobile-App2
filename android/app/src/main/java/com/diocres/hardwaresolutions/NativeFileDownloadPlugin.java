package com.diocres.hardwaresolutions;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "NativeFileDownload")
public class NativeFileDownloadPlugin extends Plugin {
    private static final String TAG = "NativeFileDownload";
    private static final String DEFAULT_FOLDER = "Gmeck media";

    @PluginMethod
    public void saveAndOpenFile(PluginCall call) {
        String rawFileName = call.getString("fileName", "document.pdf");
        String base64Data = call.getString("base64Data");
        String mimeType = call.getString("mimeType", "application/pdf");
        String rawFolder = call.getString("folder", DEFAULT_FOLDER);
        boolean openAfterSave = Boolean.TRUE.equals(call.getBoolean("openAfterSave", true));

        if (base64Data == null || base64Data.trim().isEmpty()) {
            call.reject("Missing file data.");
            return;
        }

        String fileName = sanitizeFileName(rawFileName);
        String folderName = sanitizeFolderName(rawFolder);

        try {
            String cleanBase64 = base64Data;
            int commaIdx = cleanBase64.indexOf(',');
            if (commaIdx != -1) {
                cleanBase64 = cleanBase64.substring(commaIdx + 1);
            }
            byte[] bytes = Base64.decode(cleanBase64, Base64.DEFAULT);
            if (bytes == null || bytes.length == 0) {
                call.reject("Decoded file is empty.");
                return;
            }

            Context context = getContext();
            Uri savedUri;
            String savedLocation;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = context.getContentResolver();
                String relativePath = Environment.DIRECTORY_DOWNLOADS + File.separator + folderName;
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                savedUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (savedUri == null) {
                    call.reject("Failed to create download entry in " + relativePath + ".");
                    return;
                }

                try (OutputStream out = resolver.openOutputStream(savedUri)) {
                    if (out == null) {
                        resolver.delete(savedUri, null, null);
                        call.reject("Unable to open output stream for download.");
                        return;
                    }
                    out.write(bytes);
                    out.flush();
                } catch (Exception writeErr) {
                    resolver.delete(savedUri, null, null);
                    throw writeErr;
                }

                ContentValues completeValues = new ContentValues();
                completeValues.put(MediaStore.MediaColumns.IS_PENDING, 0);
                resolver.update(savedUri, completeValues, null, null);
                savedLocation = "Downloads/" + folderName + "/" + fileName;
            } else {
                File baseDir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (baseDir == null) {
                    baseDir = new File(context.getCacheDir(), "downloads");
                }
                File dir = new File(baseDir, folderName);
                if (!dir.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                }

                File outFile = new File(dir, fileName);
                try (FileOutputStream fos = new FileOutputStream(outFile)) {
                    fos.write(bytes);
                    fos.flush();
                }

                savedUri = FileProvider.getUriForFile(
                    context,
                    context.getPackageName() + ".fileprovider",
                    outFile
                );
                savedLocation = outFile.getAbsolutePath();
            }

            boolean opened = false;
            if (openAfterSave && savedUri != null) {
                opened = openOrShareUri(context, savedUri, mimeType, fileName);
            }

            JSObject result = new JSObject();
            result.put("saved", true);
            result.put("fileName", fileName);
            result.put("location", savedLocation);
            result.put("uri", savedUri != null ? savedUri.toString() : "");
            result.put("opened", opened);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Failed to save file: " + fileName, e);
            call.reject("Failed to save file on device: " + e.getMessage());
        }
    }

    private boolean openOrShareUri(Context context, Uri uri, String mimeType, String fileName) {
        Activity activity = getActivity();
        try {
            Intent viewIntent = new Intent(Intent.ACTION_VIEW);
            viewIntent.setDataAndType(uri, mimeType);
            viewIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (activity != null) {
                activity.startActivity(viewIntent);
            } else {
                viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(viewIntent);
            }
            return true;
        } catch (ActivityNotFoundException noViewer) {
            try {
                Intent shareIntent = new Intent(Intent.ACTION_SEND);
                shareIntent.setType(mimeType);
                shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                shareIntent.putExtra(Intent.EXTRA_SUBJECT, fileName);
                shareIntent.setClipData(ClipData.newRawUri(fileName, uri));
                shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

                Intent chooser = Intent.createChooser(shareIntent, "Open or Share " + fileName);
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                if (activity != null) {
                    activity.startActivity(chooser);
                } else {
                    chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(chooser);
                }
                return true;
            } catch (Exception shareErr) {
                Log.w(TAG, "No app available to open or share file: " + fileName, shareErr);
                return false;
            }
        } catch (Exception e) {
            Log.w(TAG, "Unable to launch viewer for file: " + fileName, e);
            return false;
        }
    }

    private String sanitizeFileName(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return "document.pdf";
        }
        String cleaned = raw.replace("\\", "_").replace("/", "_").trim();
        cleaned = cleaned.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (cleaned.isEmpty() || cleaned.equals(".") || cleaned.equals("..")) {
            return "document.pdf";
        }
        return cleaned;
    }

    private String sanitizeFolderName(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return DEFAULT_FOLDER;
        }
        String cleaned = raw.replace("\\", " ").replace("/", " ").trim();
        cleaned = cleaned.replaceAll("[^a-zA-Z0-9._ -]", "").replaceAll("\\s+", " ").trim();
        if (cleaned.isEmpty() || cleaned.equals(".") || cleaned.equals("..")) {
            return DEFAULT_FOLDER;
        }
        return cleaned;
    }
}
