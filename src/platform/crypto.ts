import {
  ENCRYPTED_BACKUP_FORMAT,
  ENCRYPTED_FORMAT_VERSION,
  type EncryptedBackupFile,
} from '../domain/backup-schema';

/**
 * Optionale Verschlüsselung der Exportdatei mit WebCrypto (Abschnitt 7):
 * PBKDF2 (SHA-256) leitet aus dem Passwort einen AES-GCM-Schlüssel (256 Bit) ab.
 * Ohne Passwort lässt sich die Datei nicht wieder lesen – es gibt keine Hintertür.
 */
export const PBKDF2_ITERATIONS = 600_000;

export class DecryptError extends Error {
  constructor() {
    super('Entschlüsselung fehlgeschlagen');
    this.name = 'DecryptError';
  }
}

export async function encryptText(
  plain: string,
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<EncryptedBackupFile> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return {
    format: ENCRYPTED_BACKUP_FORMAT,
    formatVersion: ENCRYPTED_FORMAT_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    ciphertext: toBase64(new Uint8Array(cipher)),
  };
}

/** Wirft `DecryptError`, wenn das Passwort falsch oder die Datei verändert ist. */
export async function decryptText(envelope: EncryptedBackupFile, password: string): Promise<string> {
  try {
    const key = await deriveKey(password, fromBase64(envelope.kdf.salt), envelope.kdf.iterations);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(envelope.cipher.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    throw new DecryptError();
  }
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
