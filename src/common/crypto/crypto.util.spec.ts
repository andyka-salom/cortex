import { encrypt, decrypt, generateEncKey } from './crypto.util';

describe('crypto.util (AES-256-GCM)', () => {
  const original = process.env.SSH_KEY_ENC_SECRET;

  beforeAll(() => {
    // Kunci deterministik untuk test (bukan untuk produksi).
    process.env.SSH_KEY_ENC_SECRET = 'a'.repeat(64);
  });

  afterAll(() => {
    process.env.SSH_KEY_ENC_SECRET = original;
  });

  it('encrypt lalu decrypt mengembalikan plaintext asli', () => {
    const plain = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END-----';
    const enc = encrypt(plain);
    expect(enc).not.toContain('BEGIN OPENSSH'); // ciphertext, bukan plaintext
    expect(enc.split(':')).toHaveLength(3); // iv:tag:data
    expect(decrypt(enc)).toBe(plain);
  });

  it('ciphertext berbeda tiap enkripsi (IV random)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it('decrypt gagal jika ciphertext dirusak (auth tag GCM)', () => {
    const enc = encrypt('secret');
    const parts = enc.split(':');
    // Rusak byte terakhir data.
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('00') ? 'ff' : '00');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('generateEncKey menghasilkan 64 hex char (32 byte)', () => {
    expect(generateEncKey()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('getKey menolak kunci panjang salah', () => {
    process.env.SSH_KEY_ENC_SECRET = 'tooshort';
    expect(() => encrypt('x')).toThrow(/32 byte/);
    process.env.SSH_KEY_ENC_SECRET = 'a'.repeat(64);
  });
});
