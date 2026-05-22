import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { saveFile as saveFileToDB } from './db.js';

const FILES_DIR = process.env.FILES_DIR
  ? process.env.FILES_DIR
  : join(process.cwd(), 'data', 'files');

mkdirSync(FILES_DIR, { recursive: true });

export function storeFile(dataUrl, name = 'upload') {
  let base64, mimeType;

  if (dataUrl.startsWith('data:')) {
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, comma);
    base64 = dataUrl.slice(comma + 1);
    mimeType = header.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  } else {
    base64 = dataUrl;
    mimeType = 'application/octet-stream';
  }

  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
  const fileId = randomUUID();
  const filename = `${fileId}.${ext}`;
  const filePath = join(FILES_DIR, filename);

  writeFileSync(filePath, Buffer.from(base64, 'base64'));

  const url = `/files/${filename}`;

  saveFileToDB({ name, path: filePath, url, mimeType });

  return { fileId, path: filePath, url, mimeType };
}
