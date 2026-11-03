// ─────────────────────────────────────────────────────────────────────────────
// services/authService.js
//
// JWT Authentication Service — 30-day refresh cycle for mobile sessions.
//
// Token architecture:
//   • Access Token:  15 minutes  (short — minimises exposure window)
//   • Refresh Token: 30 days     (matches Indian user behaviour: weekly logins)
//
// Security:
//   • Access tokens stored in memory only (ApiClient class in Flutter).
//   • Refresh tokens stored in flutter_secure_storage (AES/Keychain).
//   • Refresh tokens are rotated on every use (prevents replay attacks).
//   • FCM device token is bound to userId for push delivery.
// ─────────────────────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  || crypto.randomBytes(32).toString('hex');
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || crypto.randomBytes(32).toString('hex');

// In-memory refresh token store.
// PRODUCTION: replace with Redis — `SET refresh:{token} userId EX 2592000`
const refreshTokenStore = new Map(); // token → { userId, deviceId, issuedAt }

class AuthService {

  // ── Issue token pair ────────────────────────────────────────────────────
  issueTokens(userId, deviceId = 'web') {
    const accessToken = jwt.sign(
      { sub: userId, deviceId, type: 'access' },
      ACCESS_SECRET,
      { expiresIn: '15m', algorithm: 'HS256' }
    );

    const refreshToken = jwt.sign(
      { sub: userId, deviceId, type: 'refresh', jti: crypto.randomUUID() },
      REFRESH_SECRET,
      { expiresIn: '30d', algorithm: 'HS256' }
    );

    // Store refresh token (rotate-on-use pattern)
    refreshTokenStore.set(refreshToken, {
      userId,
      deviceId,
      issuedAt: Date.now()
    });

    return { accessToken, refreshToken };
  }

  // ── Verify access token (used in middleware) ────────────────────────────
  verifyAccess(token) {
    try {
      const payload = jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
      if (payload.type !== 'access') throw new Error('Wrong token type');
      return payload;
    } catch (err) {
      return null;
    }
  }

  // ── Refresh — rotate: invalidate old, issue new pair ───────────────────
  rotateRefreshToken(oldRefreshToken) {
    let payload;
    try {
      payload = jwt.verify(oldRefreshToken, REFRESH_SECRET, { algorithms: ['HS256'] });
    } catch {
      throw new Error('INVALID_REFRESH_TOKEN');
    }

    if (payload.type !== 'refresh') throw new Error('INVALID_REFRESH_TOKEN');

    const stored = refreshTokenStore.get(oldRefreshToken);
    if (!stored) throw new Error('REFRESH_TOKEN_REUSE'); // Possible replay attack

    // Invalidate old token immediately (rotation)
    refreshTokenStore.delete(oldRefreshToken);

    // Issue new pair
    return this.issueTokens(stored.userId, stored.deviceId);
  }

  // ── Revoke (logout) ──────────────────────────────────────────────────────
  revokeRefreshToken(token) {
    refreshTokenStore.delete(token);
  }

  // ── Store FCM device token (for ABDM push) ───────────────────────────────
  fcmTokens = new Map(); // userId → Set<fcmToken>

  registerFcmToken(userId, fcmToken) {
    if (!this.fcmTokens.has(userId)) {
      this.fcmTokens.set(userId, new Set());
    }
    this.fcmTokens.get(userId).add(fcmToken);
    console.log(`[FCM] Registered token for ${userId}`);
  }

  getFcmTokens(userId) {
    return [...(this.fcmTokens.get(userId) || [])];
  }
}

module.exports = new AuthService();
