import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from './store';
import type { Asset } from './model';
export const maxImageBytes = 10 * 1024 * 1024;
export function assetPath(id: string, root = dataRoot) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('잘못된 이미지 ID');
  return path.join(root, 'images', `${id}.png`);
}
export async function thumbnail(id: string, root = dataRoot) {
  const original = assetPath(id, root);
  const file = path.join(root, 'thumbnails', `${id}.webp`);
  try { return await readFile(file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const bytes = await sharp(original).resize({ width: 480, height: 360, fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  return bytes;
}
export async function importImage(file: File, library: boolean, root = dataRoot): Promise<Asset> {
  if (!file.size || file.size > maxImageBytes) throw new Error('사진은 장당 10MB 이하로 선택하세요.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const decoded = sharp(bytes, { limitInputPixels: 40_000_000, animated: false });
  const meta = await decoded.metadata();
  const formats: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
  if (!meta.format || !formats[meta.format] || file.type !== formats[meta.format] || (meta.pages || 1) > 1) throw new Error('실제 PNG·JPEG·WebP 사진만 지원합니다.');
  // Re-encode to remove metadata and reject malformed input, never preserve user paths.
  const clean = await decoded.rotate().png().toBuffer();
  if (clean.length > 20 * 1024 * 1024) throw new Error('변환된 사진이 너무 큽니다. 해상도를 줄여주세요.');
  const id = randomUUID(); await mkdir(path.join(root, 'images'), { recursive: true });
  await writeFile(assetPath(id, root), clean, { flag: 'wx' });
  const dimensions = await sharp(clean).metadata();
  return { id, name: file.name.normalize('NFC').split(/[\\/]/).at(-1)!.replace(/[\u0000-\u001f<>:"|?*]/g, '_').slice(0, 150) || '사진', mime: 'image/png', size: clean.length, library, sha256: createHash('sha256').update(clean).digest('hex'), width: dimensions.width, height: dimensions.height };
}
