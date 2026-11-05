/** Stabile IDs aus dem Browser (bzw. Node in Tests). */
export function newId(): string {
  return crypto.randomUUID();
}
