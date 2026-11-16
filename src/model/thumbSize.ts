// Thumbnail size steps for Ctrl+wheel. Spec: docs/spec/listing.md「表示モード」

export const THUMB_MIN = 96;
export const THUMB_MAX = 512;
export const THUMB_STEP = 32;

/** Next size one wheel notch up (`dir` 1, larger) or down (-1): snapped to 32px steps within 96..512. */
export function stepThumbnailSize(size: number, dir: 1 | -1): number {
  const snapped = dir > 0 ? Math.floor(size / THUMB_STEP) * THUMB_STEP : Math.ceil(size / THUMB_STEP) * THUMB_STEP;
  return Math.min(THUMB_MAX, Math.max(THUMB_MIN, snapped + dir * THUMB_STEP));
}
