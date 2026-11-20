"use node";
/**
 * BYOK credential crypto: AES-256-GCM with per-workspace derived keys.
 *
 * Master key: env AGHARTA_CREDENTIAL_KEY (32 bytes base64). Per-workspace key:
 * HKDF-style derivation master → HMAC(master, workspaceId) → 32-byte key.
 * Ciphertext bundle: base64({iv, tag, ct}). Authenticated encryption: any
 * tampering or wrong-workspace decryption fails loudly.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function masterKey(): Buffer {
  const raw = process.env.AGHARTA_CREDENTIAL_KEY;
  if (!raw) {
    throw new Error(
      'AGHARTA_CREDENTIAL_KEY not set — BYOK credential storage is disabled. ' +
      'Set it to 32 bytes base64 (e.g. `openssl rand -base64 32`).'
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('AGHARTA_CREDENTIAL_KEY must be exactly 32 bytes base64');
  }
  return key;
}

/** Derive the per-workspace encryption key (HKDF-extract/expand style). */
export function workspaceKey(workspaceId: string): Buffer {
  const master = masterKey();
  // extract: HMAC(master, workspaceId)
  const prk = createHmac('sha256', master).update(`agharta/ws/${workspaceId}`).digest();
  // expand: HMAC(prk, info)
  return createHmac('sha256', prk).update('agharta/byok-credential/v1').digest();
}

/** Non-secret fingerprint so the UI can warn about key rotation. */
export function keyFingerprint(): string {
  const master = masterKey();
  const fp = createHmac('sha256', 'agharta/fingerprint').update(master).digest('base64url');
  return fp.slice(0, 16);
}

export function encryptCredential(env: Record<string, string>, workspaceId: string): string {
  const key = workspaceKey(workspaceId);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(env), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptCredential(bundle: string, workspaceId: string): Record<string, string> {
  const key = workspaceKey(workspaceId);
  const buf = Buffer.from(bundle, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

/** Constant-time token hash for MCP tokens (existing pattern). */
export function hashToken(token: string): string {
  return createHmac('sha256', 'agharta/token-hash')
    .update(token)
    .digest('base64url');
}

export function verifyTokenHash(token: string, storedHash: string): boolean {
  return timingSafeEqual(Buffer.from(hashToken(token)), Buffer.from(storedHash));
}
