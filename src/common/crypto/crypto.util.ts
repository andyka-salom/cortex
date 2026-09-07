import * as crypto from 'crypto';

/**
 * AES-256-GCM helper untuk enkripsi SSH private key at-rest.
 *
 * ATURAN (CLAUDE.md #1):
 *  - Private key TIDAK PERNAH disimpan plaintext di DB.
 *  - Selalu encrypt() sebelum masuk DB, decrypt() hanya saat dipakai di memory.
 *  - JANGAN pernah log hasil decrypt.
 *
 * Format ciphertext tersimpan: `iv:authTag:data` (semua hex).
 *  - iv       : 12 byte random (GCM nonce)
 *  - authTag  : 16 byte tag integritas GCM
 *  - data     : ciphertext
 */

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM recommended nonce size
const KEY_LENGTH = 32; // 256-bit
const ENV_KEY = 'SSH_KEY_ENC_SECRET';

/** Ambil & validasi kunci enkripsi dari env (hex 64 char = 32 byte). */
function getKey(): Buffer {
  const hex = process.env[ENV_KEY];
  if (!hex) {
    throw new Error(
      `${ENV_KEY} belum di-set. Wajib ada untuk enkripsi SSH key.`,
    );
  }
  const key = Buffer.from(hex, 'hex');
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `${ENV_KEY} harus 32 byte (64 hex chars), dapat ${key.length} byte.`,
    );
  }
  return key;
}

/** Enkripsi plaintext (mis. SSH private key). Return string `iv:tag:data` hex. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

/** Dekripsi string `iv:tag:data` hex → plaintext. Hanya untuk pakai in-memory. */
export function decrypt(payload: string): string {
  const key = getKey();
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('Format ciphertext tidak valid (expect iv:tag:data).');
  }
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** Utility dev: generate kunci 32-byte hex baru untuk SSH_KEY_ENC_SECRET. */
export function generateEncKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}
