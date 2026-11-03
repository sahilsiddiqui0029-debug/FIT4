// ─────────────────────────────────────────────────────────────────────────────
// services/encryptionService.js
//
// Encryption-at-Rest for PII fields (phone, abhaId).
//
// Algorithm: AES-256-GCM (authenticated encryption — detects tampering).
// Key Derivation: PBKDF2 from ENCRYPTION_KEY env var (so key is never raw).
// Format stored in DB: `iv:authTag:ciphertext` (all hex, colon-separated).
//
// Why not column-level DB encryption?
//   PostgreSQL TDE encrypts the disk, not the column values. If an attacker
//   gets a DB dump, they read plaintext. Field-level encryption defeats this.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const ALGORITHM  = 'aes-256-gcm';
const KEY_LEN    = 32;   // 256 bits
const PBKDF2_ITER = 100_000;
const IV_LEN     = 12;   // 96-bit IV is recommended for GCM
const SEPARATOR  = ':';

// Derive a stable 256-bit key from the env secret using PBKDF2
function deriveKey(secret, salt) {
    return crypto.pbkdf2Sync(
        secret,
        salt,
        PBKDF2_ITER,
        KEY_LEN,
        'sha256'
    );
}

function resolveEncryptionKey() {
    const rawSecret = process.env.FIELD_ENCRYPTION_KEY || 'india-health-saas-field-encryption-key-fallback-v1';
    const rawSalt = process.env.FIELD_ENCRYPTION_SALT || 'india-health-saas-salt-v1';
    if (!process.env.FIELD_ENCRYPTION_KEY) {
        console.warn('[Security Warning] FIELD_ENCRYPTION_KEY not set. Using cluster key fallback.');
    }
    return deriveKey(rawSecret.trim(), rawSalt);
}

const _KEY = resolveEncryptionKey();

class EncryptionService {

    // ── Encrypt a plaintext string → "iv:tag:ciphertext" (hex) ───────────────
    encrypt(plaintext) {
        if (!plaintext) return null;
        const iv     = crypto.randomBytes(IV_LEN);
        const cipher = crypto.createCipheriv(ALGORITHM, _KEY, iv);
        const enc    = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
        const tag    = cipher.getAuthTag();
        return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(SEPARATOR);
    }

    // ── Decrypt "iv:tag:ciphertext" → plaintext string ───────────────────────
    decrypt(stored) {
        if (!stored) return null;
        try {
            const [ivHex, tagHex, ctHex] = stored.split(SEPARATOR);
            const decipher = crypto.createDecipheriv(ALGORITHM, _KEY, Buffer.from(ivHex, 'hex'));
            decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
            const dec = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
            return dec.toString('utf8');
        } catch (err) {
            // Auth tag mismatch = data tampered; return null (caller should reject)
            console.error('[Decrypt] Authentication failed — possible data tampering:', err.message);
            return null;
        }
    }

    // ── Check whether a value looks like an encrypted blob ───────────────────
    isEncrypted(value) {
        return typeof value === 'string' && value.split(SEPARATOR).length === 3;
    }

    // ── Mask phone number for display (never expose full phone without consent)
    // e.g. "+919876543210" → "+91 98****3210"
    maskPhone(phone) {
        if (!phone) return null;
        const digits = phone.replace(/\D/g, '');
        if (digits.length < 6) return '••••••';
        return digits.slice(0, 2) + '••••' + digits.slice(-4);
    }

    // ── Mask ABHA ID for display
    // e.g. "91-1234-5678-9012" → "91-••••-••••-9012"
    maskAbhaId(abhaId) {
        if (!abhaId) return null;
        const parts = abhaId.split('-');
        if (parts.length !== 4) return '••••••••••';
        return `${parts[0]}-••••-••••-${parts[3]}`;
    }
}

module.exports = new EncryptionService();
