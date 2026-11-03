// ─────────────────────────────────────────────────────────────────────────────
// middleware/auditLog.js
//
// Audit logging middleware — satisfies CERT-In IS/IEC 27001 and DPDP Act
// Section 8(6) requirements for access logging of health data.
//
// Logs every doctor access to patient trend/history data.
// Writes to: PostgreSQL AuditLog table + stdout (structured JSON for CloudWatch).
// ─────────────────────────────────────────────────────────────────────────────
const { PrismaClient } = require('@prisma/client');

// Share the singleton from server.js via require cache
let _prisma;
function getPrisma() {
    if (!_prisma) _prisma = new PrismaClient();
    return _prisma;
}

// Actions that must be audited per NHA policy
const AUDITED_ACTIONS = {
    VIEW_PATIENT_HISTORY:  'VIEW_PATIENT_HISTORY',
    VIEW_AT_RISK_PATIENTS: 'VIEW_AT_RISK_PATIENTS',
    CONSENT_GRANTED:       'CONSENT_GRANTED',
    CONSENT_DENIED:        'CONSENT_DENIED',
    EMERGENCY_ALERT_SENT:  'EMERGENCY_ALERT_SENT',
    DATA_EXPORT_FHIR:      'DATA_EXPORT_FHIR',
};

// ── Core log writer ───────────────────────────────────────────────────────────
async function writeAuditLog({ actorId, action, targetId, ip, metadata = {} }) {
    const entry = {
        actorId:   actorId    || 'anonymous',
        action,
        targetId:  targetId   || null,
        ip:        ip         || 'unknown',
        timestamp: new Date(),
        metadata:  JSON.stringify(metadata),
    };

    // 1. Structured stdout — picked up by CloudWatch/ECS log driver
    console.log(JSON.stringify({ audit: true, ...entry }));

    // 2. Persist to DB (non-fatal — never block the main response)
    try {
        await getPrisma().auditLog.create({ data: entry });
    } catch (err) {
        console.error('[AuditLog] DB write failed:', err.message);
    }
}

// ── Express middleware factory ────────────────────────────────────────────────
// Usage: router.get('/health-history/:userId', auditMiddleware('VIEW_PATIENT_HISTORY'), handler)
function auditMiddleware(action, getTargetId = (req) => req.params.userId || req.params.patientId) {
    return async (req, res, next) => {
        // Capture response finish to record the outcome
        const originalJson = res.json.bind(res);
        res.json = function (body) {
            const actorId  = req.user?.id || req.user?.userId || 'anonymous';
            const targetId = getTargetId(req);
            const ip       = req.ip || req.headers['x-forwarded-for'] || 'unknown';

            writeAuditLog({
                actorId,
                action,
                targetId,
                ip,
                metadata: {
                    method:     req.method,
                    path:       req.path,
                    statusCode: res.statusCode,
                    actorRole:  req.user?.role || 'unauthenticated',
                    unverifiedDoctorHeader: !req.user?.userId ? req.headers['x-doctor-id'] : undefined,
                },
            }); // fire-and-forget — non-blocking

            return originalJson(body);
        };
        next();
    };
}

module.exports = { writeAuditLog, auditMiddleware, AUDITED_ACTIONS };
