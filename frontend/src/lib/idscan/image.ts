/** Draws a photo (honouring EXIF rotation) or canvas onto a new canvas no larger than maxEdge. */
export async function toCanvas(src: Blob | HTMLCanvasElement, maxEdge: number): Promise<HTMLCanvasElement> {
  const img = src instanceof HTMLCanvasElement ? src : await createImageBitmap(src, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  if (!(src instanceof HTMLCanvasElement)) (img as ImageBitmap).close();
  return c;
}

export function rotate(src: HTMLCanvasElement, degrees: 90 | 180 | 270): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const sideways = degrees !== 180;
  c.width = sideways ? src.height : src.width;
  c.height = sideways ? src.width : src.height;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** The bottom part of an image, where a passport's MRZ sits. */
export function bottom(src: HTMLCanvasElement, fraction: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const h = Math.round(src.height * fraction);
  c.width = src.width;
  c.height = h;
  c.getContext("2d")!.drawImage(src, 0, src.height - h, src.width, h, 0, 0, src.width, h);
  return c;
}

export function imageData(c: HTMLCanvasElement): ImageData {
  return c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
}
