/**
 * In-memory current-session markers only.
 * Reset on full page reload. Not persisted to localStorage/sessionStorage.
 * Set only when Media or Pages screens successfully load usable data.
 */
let mediaSessionAvailable = false;
let pagesSessionAvailable = false;

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* isolate */
    }
  });
}

export function markMediaSessionAvailable() {
  if (!mediaSessionAvailable) {
    mediaSessionAvailable = true;
    notify();
  }
}

export function markPagesSessionAvailable() {
  if (!pagesSessionAvailable) {
    pagesSessionAvailable = true;
    notify();
  }
}

export function isMediaSessionAvailable() {
  return mediaSessionAvailable;
}

export function isPagesSessionAvailable() {
  return pagesSessionAvailable;
}

/** Subscribe to marker changes (picker availability). No network. */
export function subscribeSessionMarkers(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test helper only */
export function __resetSessionMarkersForTests() {
  mediaSessionAvailable = false;
  pagesSessionAvailable = false;
  notify();
}
