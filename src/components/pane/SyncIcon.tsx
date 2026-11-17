// The cloud state of an item under a sync root. Spec: docs/spec/listing.md「詳細の列」

import type { Entry } from "../../presenters/list";

export function SyncIcon({ state }: { state: NonNullable<Entry["syncState"]> }) {
  if (state === "pinned") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-label="常に利用可能">
        <circle cx="8" cy="8" r="7" fill="#2e9c3a" />
        <path d="M4.5 8.3l2.4 2.4 4.6-4.9" fill="none" stroke="#fff" strokeWidth="1.8" />
      </svg>
    );
  }
  if (state === "available") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-label="利用可能">
        <circle cx="8" cy="8" r="6.5" fill="none" stroke="#2e9c3a" strokeWidth="1.2" />
        <path d="M4.8 8.3l2.2 2.2 4.2-4.5" fill="none" stroke="#2e9c3a" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-label="オンラインのみ">
      <path
        d="M4.6 12.5h6.9a2.9 2.9 0 0 0 .4-5.77A4 4 0 0 0 4.2 7.1a2.7 2.7 0 0 0 .4 5.4z"
        fill="none"
        stroke="#1f6fd0"
        strokeWidth="1.2"
      />
    </svg>
  );
}
