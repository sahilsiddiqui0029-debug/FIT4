const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const TEST_JWT_SECRET = 'fit4-test-jwt-secret-key-for-verification-2026';
process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
process.env.FIELD_ENCRYPTION_KEY = 'fit4-test-encryption-master-key-2026';
process.env.ID_SALT = 'fit4-test-fhir-pseudonymization-salt-2026';

const { requireAuth, requireRole, requireSelfOrDoctor } = require('../middleware/auth');
const encryptionService = require('../services/encryptionService');
const fhirService = require('../services/fhirService');
const otpService = require('../services/otpService');

const ROOT_DIR = path.resolve(__dirname, '../..');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('FIT4-VULN-001: JWT Auth middleware rejects missing/forged tokens and fails closed in production without SUPABASE_JWT_SECRET', () => {
  // 1. Missing token -> 401
  const reqNoToken = { headers: {} };
  const resNoToken = createMockRes();
  let nextCalled = false;
  requireAuth(reqNoToken, resNoToken, () => { nextCalled = true; });
  assert.equal(resNoToken.statusCode, 401);
  assert.equal(nextCalled, false);

  // 2. Token signed with legacy hardcoded fallback 'your-supabase-jwt-secret' -> 401
  const forgedToken = jwt.sign({ sub: 'attacker-1', role: 'admin' }, 'your-supabase-jwt-secret');
  const reqForged = { headers: { authorization: `Bearer ${forgedToken}` } };
  const resForged = createMockRes();
  requireAuth(reqForged, resForged, () => { nextCalled = true; });
  assert.equal(resForged.statusCode, 401);
  assert.equal(nextCalled, false);

  // 3. Valid token signed with configured secret -> passes and attaches user
  const validToken = jwt.sign({ sub: 'patient-101', email: 'patient@fit4.in', role: 'patient' }, TEST_JWT_SECRET);
  const reqValid = { headers: { authorization: `Bearer ${validToken}` } };
  const resValid = createMockRes();
  requireAuth(reqValid, resValid, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(reqValid.user.userId, 'patient-101');
  assert.equal(reqValid.user.role, 'patient');

  // 4. Production fail-closed check when SUPABASE_JWT_SECRET is missing
  const savedSecret = process.env.SUPABASE_JWT_SECRET;
  const savedEnv = process.env.NODE_ENV;
  try {
    delete process.env.SUPABASE_JWT_SECRET;
    process.env.NODE_ENV = 'production';
    const resProd = createMockRes();
    let prodNext = false;
    requireAuth({ headers: { authorization: `Bearer ${validToken}` } }, resProd, () => { prodNext = true; });
    assert.equal(resProd.statusCode, 503);
    assert.equal(prodNext, false);
  } finally {
    process.env.SUPABASE_JWT_SECRET = savedSecret;
    process.env.NODE_ENV = savedEnv;
  }
});

test('FIT4-VULN-002: RBAC and BOLA/IDOR guards block cross-patient PHI access and privilege escalation', () => {
  const doctorOnly = requireRole('doctor', 'admin');
  const selfOrDoctor = requireSelfOrDoctor((req) => req.params.userId);

  const patientToken = jwt.sign({ sub: 'patient-101', role: 'patient' }, TEST_JWT_SECRET);
  const doctorToken = jwt.sign({ sub: 'doc-1', role: 'doctor' }, TEST_JWT_SECRET);

  // Patient attempting to access doctor-only route -> 403
  const reqPatientOnDoctorRoute = { headers: { authorization: `Bearer ${patientToken}` }, params: {} };
  const resRoleDenied = createMockRes();
  let nextRole = false;
  doctorOnly(reqPatientOnDoctorRoute, resRoleDenied, () => { nextRole = true; });
  assert.equal(resRoleDenied.statusCode, 403);
  assert.equal(nextRole, false);

  // Patient A attempting to read Patient B's PHI (IDOR) -> 403
  const reqCrossPatient = { headers: { authorization: `Bearer ${patientToken}` }, params: { userId: 'patient-999' } };
  const resIdorDenied = createMockRes();
  let nextIdor = false;
  selfOrDoctor(reqCrossPatient, resIdorDenied, () => { nextIdor = true; });
  assert.equal(resIdorDenied.statusCode, 403);
  assert.equal(nextIdor, false);

  // Patient A accessing own PHI -> allowed
  const reqSelf = { headers: { authorization: `Bearer ${patientToken}` }, params: { userId: 'patient-101' } };
  const resSelf = createMockRes();
  let nextSelf = false;
  selfOrDoctor(reqSelf, resSelf, () => { nextSelf = true; });
  assert.equal(nextSelf, true);

  // Verified Doctor accessing Patient B's PHI -> allowed
  const reqDoctor = { headers: { authorization: `Bearer ${doctorToken}` }, params: { userId: 'patient-999' } };
  const resDoc = createMockRes();
  let nextDoc = false;
  selfOrDoctor(reqDoctor, resDoc, () => { nextDoc = true; });
  assert.equal(nextDoc, true);
});

test('FIT4-VULN-003: Server.js enforces timing-safe Razorpay webhook HMAC, 2MB JSON cap, and strict CSP', () => {
  const serverSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/server.js'), 'utf8');
  assert.match(serverSrc, /crypto\.timingSafeEqual\(sigBuf,\s*expBuf\)/);
  assert.match(serverSrc, /express\.json\(\{\s*limit:\s*['"]2mb['"]\s*\}\)/);
  assert.match(serverSrc, /contentSecurityPolicy:\s*\{/);
  assert.doesNotMatch(serverSrc, /contentSecurityPolicy:\s*false/);
});

test('FIT4-VULN-004: AES-256-GCM encryption and FHIR pseudonymization eliminate hardcoded keys and round-trip PHI', () => {
  const encSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/services/encryptionService.js'), 'utf8');
  const fhirSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/services/fhirService.js'), 'utf8');
  assert.doesNotMatch(encSrc, /dev-only-insecure-key-change-in-prod/);
  assert.doesNotMatch(fhirSrc, /fhir-salt-2026/);

  const plaintextPhi = JSON.stringify({ fastingGlucose: 118, notes: 'Post-meal walk' });
  const encrypted = encryptionService.encrypt(plaintextPhi);
  assert.ok(encrypted && encrypted !== plaintextPhi);
  const decrypted = encryptionService.decrypt(encrypted);
  assert.equal(decrypted, plaintextPhi);

  // Tampered authTag must fail GCM authentication and return null
  const parts = encrypted.split(':');
  parts[1] = '00'.repeat(16);
  const tampered = parts.join(':');
  assert.equal(encryptionService.decrypt(tampered), null);

  // FHIR pseudonymization must hash raw user ID
  const bundle = fhirService.convertToDiagnosticBundle(
    { id: 'raw-user-id-123', region: 'WB', city: 'Kolkata' },
    [{ id: 'log-1', type: 'GLUCOSE', value1: 110, createdAt: new Date() }]
  );
  const serialized = JSON.stringify(bundle);
  assert.ok(!serialized.includes('raw-user-id-123'));
  assert.match(bundle.entry[1].resource.id, /^[a-f0-9]{16}$/);
});

test('FIT4-VULN-005: OTP service uses CSPRNG, constant-time comparison, and never logs plaintext OTPs or hardcoded Twilio SIDs', async () => {
  const otpSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/services/otpService.js'), 'utf8');
  const nudgeSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/services/nudgeService.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/server.js'), 'utf8');

  assert.doesNotMatch(otpSrc, /AC[0-9a-fA-F]{32}/);
  assert.doesNotMatch(nudgeSrc, /AC[0-9a-fA-F]{32}/);
  assert.doesNotMatch(serverSrc, /'apikey':\s*'helloworld'/);
  assert.match(otpSrc, /crypto\.randomInt\(100000,\s*1000000\)/);
  assert.match(otpSrc, /crypto\.timingSafeEqual/);

  // Capture stdout during sendOtp to prove no plaintext OTP is printed
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const res = await otpService.sendOtp('+919876543210');
    assert.equal(res.success, true);
  } finally {
    console.log = origLog;
  }
  const combinedLogs = logs.join('\n');
  assert.doesNotMatch(combinedLogs, /\b\d{6}\b/, 'Plaintext 6-digit OTP must never be logged to stdout');
  assert.equal(otpService.verifyOtp('+919876543210', '000000').valid, false);
});

test('FIT4-VULN-006: Audit log middleware blocks x-doctor-id header spoofing and /api/approve requires HMAC token', () => {
  const auditSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/middleware/auditLog.js'), 'utf8');
  assert.doesNotMatch(auditSrc, /actorId\s*=\s*req\.user\?\.userId\s*\|\|\s*req\.headers\['x-doctor-id'\]/);
  assert.match(auditSrc, /const actorId\s*=\s*req\.user\?\.id\s*\|\|\s*req\.user\?\.userId\s*\|\|\s*'anonymous'/);

  const approveSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-web/marketing-site/app/api/approve/route.ts'), 'utf8');
  assert.match(approveSrc, /APPROVAL_SECRET/);
  assert.match(approveSrc, /crypto\.timingSafeEqual/);
  assert.match(approveSrc, /escapeHtml/);
});

test('FIT4-VULN-007: Marketing site and emailService eliminate hardcoded API keys and HTML injection', () => {
  const scanLabelSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-web/marketing-site/app/api/scan-label/route.ts'), 'utf8');
  const supabaseSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-web/marketing-site/lib/supabase.ts'), 'utf8');
  const emailSrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/src/services/emailService.js'), 'utf8');

  assert.doesNotMatch(scanLabelSrc, /sk-or-v1-/);
  assert.doesNotMatch(supabaseSrc, /placeholder-anon-key/);
  assert.match(emailSrc, /function escapeHtml/);
  assert.match(emailSrc, /escapeHtml\(userName/);
});

test('FIT4-VULN-008: Doctor portal and marketing widget sanitize untrusted DOM inputs against XSS', () => {
  const doctorJs = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/public/doctor.js'), 'utf8');
  const widgetJs = fs.readFileSync(path.join(ROOT_DIR, 'fit4-web/marketing-site/public/widget.js'), 'utf8');

  assert.match(doctorJs, /function escapeHtml/);
  assert.doesNotMatch(doctorJs, /onclick="selectPatient/);
  assert.match(widgetJs, /function escapeHtml/);
  assert.match(widgetJs, /escapeHtml\(rawItem\)/);
});

test('FIT4-VULN-009: Dockerfile runs as non-root node user, Terraform encrypts RDS without hardcoded password, and RLS SQL is present', () => {
  const dockerfile = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/Dockerfile'), 'utf8');
  const tfMain = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/infra/terraform/main.tf'), 'utf8');
  const rlsSql = fs.readFileSync(path.join(ROOT_DIR, 'fit4-backend/prisma/migrations/rls_policies.sql'), 'utf8');

  assert.match(dockerfile, /USER node/);
  assert.doesNotMatch(tfMain, /CHANGE_ME_IN_SECRETS_MANAGER/);
  assert.match(tfMain, /storage_encrypted\s*=\s*true/);
  assert.match(tfMain, /scan_on_push\s*=\s*true/);
  assert.match(rlsSql, /ALTER TABLE "HealthLog" ENABLE ROW LEVEL SECURITY/);
  assert.match(rlsSql, /ALTER TABLE "HealthLog" FORCE ROW LEVEL SECURITY/);
});

test('FIT4-VULN-010: Python Agent Admin Dashboard enforces bearer/CSRF auth, HTML escaping, and restricted CORS', () => {
  const pySrc = fs.readFileSync(path.join(ROOT_DIR, 'fit4-agents/admin_dashboard.py'), 'utf8');
  assert.match(pySrc, /html\.escape/);
  assert.match(pySrc, /hmac\.compare_digest/);
  assert.doesNotMatch(pySrc, /Access-Control-Allow-Origin",\s*"\*"/);
});

test('FIT4-VULN-011 & FIT4-VULN-012: Flutter Android mobile app enforces RECEIVER_NOT_EXPORTED, disables cleartext/backup, removes hardcoded keys, and uses Random.secure()', () => {
  const manifest = fs.readFileSync(path.join(ROOT_DIR, 'fit4-frontend/mobile-app/android/app/src/main/AndroidManifest.xml'), 'utf8');
  const mainActivity = fs.readFileSync(path.join(ROOT_DIR, 'fit4-frontend/mobile-app/android/app/src/main/kotlin/in/fit4/MainActivity.kt'), 'utf8');
  const visionDart = fs.readFileSync(path.join(ROOT_DIR, 'fit4-frontend/mobile-app/lib/services/ai_vision_service.dart'), 'utf8');
  const providerDart = fs.readFileSync(path.join(ROOT_DIR, 'fit4-frontend/mobile-app/lib/services/app_provider.dart'), 'utf8');
  const twilioDart = fs.readFileSync(path.join(ROOT_DIR, 'fit4-frontend/mobile-app/lib/services/twilio_service.dart'), 'utf8');

  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
  assert.match(mainActivity, /Context\.RECEIVER_NOT_EXPORTED/);
  assert.doesNotMatch(mainActivity, /Context\.RECEIVER_EXPORTED/);
  assert.doesNotMatch(visionDart, /sk-or-v1-/);
  assert.doesNotMatch(providerDart, /sk-or-v1-/);
  assert.match(twilioDart, /Random\.secure\(\)/);
  assert.doesNotMatch(twilioDart, /DateTime\.now\(\)\.millisecond/);
});
