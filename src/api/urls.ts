// URLs of icons and thumbnails, served by the backend's `icon` and `thumb` URI schemes.
// Only text is built here: views may use these, unlike the backend calls.

/** URL of the icon for `location`. */
export function iconUrl(location: string, size = 16, item?: IconItem): string {
  return `http://icon.localhost/?loc=${encodeURIComponent(location)}&size=${size}${item ? itemQuery(item) : ""}`;
}

/** What is known about a listed item; part of the URL so a changed item gets a new icon. */
export interface IconItem {
  isFolder: boolean;
  modified: number | null;
}

/** `&k=d|f&m=<modified>`: a folder and a file of the same name (or a replaced file) get different URLs. */
function itemQuery(item: IconItem): string {
  return `&k=${item.isFolder ? "d" : "f"}&m=${item.modified ?? 0}`;
}

/** URL of the thumbnail for `location`. */
export function thumbUrl(location: string, size: number, item: IconItem): string {
  return `http://thumb.localhost/?loc=${encodeURIComponent(location)}&size=${size}${itemQuery(item)}`;
}
