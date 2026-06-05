/**
 * HIT Paint — browser file helpers.
 *
 * downloadBlob  — trigger a browser "Save As" download for any Blob.
 * pickFile      — open a native file-picker and resolve with the chosen file's
 *                 ArrayBuffer + name, or null if the user cancels.
 *
 * Both functions require a real browser DOM and should not be called from tests.
 */

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download of `blob` with the given `filename`.
 * Creates a temporary object URL, simulates an <a download> click, then
 * immediately revokes the URL to avoid memory leaks.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    // Append, click, then remove — some browsers require the element to be
    // in the DOM for the click to trigger a download.
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Always revoke, even if click throws.
    URL.revokeObjectURL(url);
  }
}

// ---------------------------------------------------------------------------
// File picker
// ---------------------------------------------------------------------------

/**
 * Open a native file-picker dialog filtered to `accept` (e.g. "image/png,image/jpeg").
 * Resolves with the selected file's ArrayBuffer and original filename, or null
 * if the user dismisses the dialog without choosing a file.
 *
 * The hidden <input> element is removed from the DOM after the interaction
 * completes.
 */
export async function pickFile(
  accept: string,
): Promise<{ buffer: ArrayBuffer; name: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    // Cleanup helper — removes the element regardless of outcome.
    const cleanup = (): void => {
      if (input.parentNode) {
        document.body.removeChild(input);
      }
    };

    input.addEventListener('change', () => {
      // The picker resolved via a real selection: drop the cancellation proxy so
      // it cannot fire spuriously on a later window focus.
      window.removeEventListener('focus', onWindowFocus);
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      file
        .arrayBuffer()
        .then((buffer) => resolve({ buffer, name: file.name }))
        // A genuine read failure is NOT a cancellation — surface it to the caller.
        .catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
    });

    // If the user opens and then closes the picker without selecting anything,
    // no "change" event fires. We use a one-shot "focus" event on the window
    // as a proxy for "picker was dismissed". The focus event fires after the
    // native dialog closes; we defer slightly so the change event (if any) can
    // run first.
    const onWindowFocus = (): void => {
      window.removeEventListener('focus', onWindowFocus);
      // Give the change handler time to fire before concluding cancellation.
      setTimeout(() => {
        if (input.parentNode) {
          // input is still in DOM → change never fired → user cancelled.
          cleanup();
          resolve(null);
        }
      }, 300);
    };
    window.addEventListener('focus', onWindowFocus);

    input.click();
  });
}
