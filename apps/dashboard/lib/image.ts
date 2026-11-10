const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export async function shrinkImage(
  file: File,
  { maxSide, limit }: { maxSide: number; limit: number },
): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const fits =
    TYPES.includes(file.type) &&
    file.size <= limit &&
    Math.max(bitmap.width, bitmap.height) <= maxSide;
  if (fits) {
    bitmap.close();
    return file;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.88, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality),
    );
    if (blob && blob.size <= limit) return blob;
  }
  throw new Error('too large');
}

export function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
