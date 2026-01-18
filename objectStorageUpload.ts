import { objectStorageClient } from "./replit_integrations/object_storage";

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;

export interface UploadResult {
  url: string;
  objectPath: string;
  filename: string;
}

export async function uploadBufferToObjectStorage(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string,
  folder: string = "uploads"
): Promise<UploadResult> {
  if (!BUCKET_ID) {
    throw new Error("Object storage not configured - DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
  }

  const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const ext = originalFilename.includes('.') ? originalFilename.substring(originalFilename.lastIndexOf('.')) : '';
  const safeFilename = `${uniqueSuffix}${ext}`;
  const objectName = `public/${folder}/${safeFilename}`;

  console.log(`[Object Storage] Starting upload: ${objectName}`);

  const bucket = objectStorageClient.bucket(BUCKET_ID);
  const file = bucket.file(objectName);

  try {
    await file.save(buffer, {
      contentType: mimeType,
      metadata: {
        cacheControl: "public, max-age=31536000",
      },
    });

    console.log(`[Object Storage] Upload successful: ${objectName}`);

    const servingUrl = `/storage/${folder}/${safeFilename}`;

    return {
      url: servingUrl,
      objectPath: objectName,
      filename: safeFilename,
    };
  } catch (error) {
    console.error(`[Object Storage] Upload failed:`, error);
    throw error;
  }
}

export async function deleteFromObjectStorage(objectPath: string): Promise<void> {
  if (!BUCKET_ID) return;
  
  const bucket = objectStorageClient.bucket(BUCKET_ID);
  
  let objectName = objectPath;
  if (objectPath.startsWith('/storage/')) {
    objectName = `public${objectPath.replace('/storage', '')}`;
  } else if (objectPath.startsWith('/objects/')) {
    objectName = `public${objectPath.replace('/objects', '')}`;
  }
  
  try {
    await bucket.file(objectName).delete();
    console.log(`[Object Storage] Deleted: ${objectName}`);
  } catch (err) {
    console.error("[Object Storage] Failed to delete:", err);
  }
}
