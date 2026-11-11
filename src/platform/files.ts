/**
 * Dateien ausgeben und einlesen – ohne Netzwerk. Auf Android über das Teilen-Menü
 * (Web Share API mit Datei), sonst als Download.
 */
const JSON_TYPE = 'application/json';

export function downloadText(fileName: string, text: string, type: string = JSON_TYPE): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  // Erst später freigeben, damit der Download sicher startet.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFiles(): boolean {
  try {
    if (typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
    const probe = new File(['{}'], 'live.json', { type: JSON_TYPE });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** `cancelled`, wenn das Teilen-Menü ohne Auswahl geschlossen wurde. Andere Fehler werden geworfen. */
export async function shareText(fileName: string, text: string): Promise<'shared' | 'cancelled'> {
  const file = new File([text], fileName, { type: JSON_TYPE });
  try {
    await navigator.share({ files: [file], title: fileName });
    return 'shared';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    throw error;
  }
}

export interface PickedFile {
  name: string;
  size: number;
  text: () => Promise<string>;
}

export function pickedFile(file: File): PickedFile {
  return { name: file.name, size: file.size, text: () => file.text() };
}
