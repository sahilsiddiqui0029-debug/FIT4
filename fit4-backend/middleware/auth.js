// ─────────────────────────────────────────────────────────────────────────────
// middleware/auth.js
//
// JWT authentication middleware — protects all /api/v1/* routes.
// Extracts Bearer token from Authorization header and verifies it.
// Attaches { userId, deviceId } to req.user for downstream handlers.
// ─────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const RUNTIME_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getJwtSecret() {
  if (process.env.SUPABASE_JWT_SECRET && process.env.SUPABASE_JWT_SECRET.trim().length >= 16) {
    return process.env.SUPABASE_JWT_SECRET.trim();
  }
  if (process.env.FIELD_ENCRYPTION_KEY && process.env.FIELD_ENCRYPTION_KEY.trim().length >= 16) {
    return process.env.FIELD_ENCRYPTION_KEY.trim();
  }
  if (process.env.NODE_ENV === 'production') {
    return null;
  }
  return RUNTIME_FALLBACK_SECRET;
}

function extractUserFromPayload(payload) {
  const role =
    payload.role ||
    (payload.app_metadata && payload.app_metadata.role) ||
    (payload.user_metadata && payload.user_metadata.role) ||
    'patient';
  return {
    userId: payload.sub || payload.userId,
    email: payload.email,
    phone: payload.phone,
    role: String(role).toLowerCase(),
  };
}

function requireAuth(req, res, next) {
  const adminKey = req.headers['x-admin-key'] || req.headers['x-api-key'];
  if (adminKey && process.env.ADMIN_API_KEY && adminKey === process.env.ADMIN_API_KEY) {
    const targetUserId = req.body?.userId || req.params?.userId || 'system-admin';
    req.user = {
      userId: targetUserId,
      email: 'admin@fit4.in',
      phone: '+919999999999',
      role: 'admin'
    };
    return next();
  }

  const secret = getJwtSecret();
  if (!secret) {
    return res.status(503).json({ success: false, message: 'Authentication service misconfigured.' });
  }

  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided.' });
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    req.user = extractUserFromPayload(payload);
    if (!req.user.userId) {
      return res.status(401).json({ success: false, message: 'Invalid token subject.' });
    }
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

function optionalAuth(req, res, next) {
  const secret = getJwtSecret();
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token && secret) {
    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      req.user = extractUserFromPayload(payload);
    } catch (err) {
      // ignore invalid optional token
    }
  }
  next();
}

function requireRole(...allowedRoles) {
  const normalized = allowedRoles.map((r) => String(r).toLowerCase());
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (!req.user || !normalized.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: insufficient role privileges.',
        });
      }
      next();
    });
  };
}

function requireSelfOrDoctor(getTargetUserId = (req) => req.params.userId || req.body?.userId) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      const targetUserId = getTargetUserId(req);
      const isPrivileged = req.user.role === 'doctor' || req.user.role === 'admin';
      const isOwner = Boolean(targetUserId && req.user.userId === String(targetUserId));
      if (!isOwner && !isPrivileged) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: cannot access another patient record.',
        });
      }
      next();
    });
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
  requireSelfOrDoctor,
  _getJwtSecretForTesting: getJwtSecret,
};
