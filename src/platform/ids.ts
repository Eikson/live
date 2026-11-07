/**
 * Stabile IDs aus dem Browser (bzw. Node in Tests). `crypto.randomUUID` gibt es nur in sicheren
 * Kontexten (https, localhost); über http im WLAN fehlt es, `getRandomValues` aber nicht.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return uuidV4(crypto.getRandomValues(new Uint8Array(16)));
}

/** Formatiert 16 Zufallsbytes als UUID Version 4 (RFC 9562). */
export function uuidV4(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
