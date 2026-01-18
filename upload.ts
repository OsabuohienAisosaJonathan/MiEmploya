import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "crypto";

const UPLOAD_DIR = path.join(process.cwd(), "client", "public", "uploads");

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function handleFileUpload(
  file: Express.Multer.File
): Promise<{ id: string; filename: string; url: string }> {
  const fileId = uuidv4();
  const ext = path.extname(file.originalname);
  const filename = `${fileId}${ext}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  // Save file to disk
  await fs.promises.writeFile(filepath, file.buffer);

  return {
    id: fileId,
    filename: filename,
    url: `/uploads/${filename}`,
  };
}

export function deleteUploadedFile(filename: string): void {
  const filepath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
  }
}
