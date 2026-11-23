/** Downscale an image file in the browser (max 1600px edge, JPEG) so uploads stay small. GIFs are sent as-is. */
export async function prepareImage(file: File, maxEdge = 1600): Promise<File> {
  if (file.type === "image/gif" || !file.type.startsWith("image/")) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 1_500_000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.86));
  return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}
