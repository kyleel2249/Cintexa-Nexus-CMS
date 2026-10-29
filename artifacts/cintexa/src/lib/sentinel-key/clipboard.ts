let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** Copies text and, when requested, clears the clipboard later if it still holds the same value. */
export async function copyText(text: string, clearAfterSeconds = 0): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return false;
  }
  if (clearTimer) clearTimeout(clearTimer);
  if (clearAfterSeconds > 0) {
    clearTimer = setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText("");
      } catch { /* permission denied: leave the clipboard untouched */ }
    }, clearAfterSeconds * 1000);
  }
  return true;
}

/** Downloads text as a file without putting the content in a URL. */
export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
