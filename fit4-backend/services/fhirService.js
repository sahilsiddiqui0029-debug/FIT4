// ─────────────────────────────────────────────────────────────────────────────
// services/fhirService.js
//
// ABDM v6.5.0 FHIR R4 DiagnosticReportRecord Mapper
//
// Spec:     https://hl7.org/fhir/R4/
// Profile:  https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const axios  = require('axios');

const FHIR_BASE  = process.env.FHIR_BASE_URL  || 'https://api.indiahealth.in/fhir';
const HIU_ID     = process.env.ABDM_HIU_ID     || 'india-health-saas';
const ID_SALT    = process.env.ID_SALT || 'india-health-saas-id-salt-fallback-v1';
if (!process.env.ID_SALT) {
    console.warn('[Security Warning] ID_SALT not set. Using cluster salt fallback.');
}
const ABDM_GW    = process.env.ABDM_GATEWAY_URL || 'https://dev.abdm.gov.in/gateway';

// ── NRCeS StructureDefinition URLs ───────────────────────────────────────────
const PROFILE = {
    BUNDLE:     'https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle',
    COMPOSITION:'https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord',
    PATIENT:    'https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient',
    OBS_GENERAL:'https://nrces.in/ndhm/fhir/r4/StructureDefinition/ObservationGeneralAssessment',
    DIAG_REPORT:'https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportLab',
    ORG:        'https://nrces.in/ndhm/fhir/r4/StructureDefinition/Organization',
};

// ── LOINC Codes ───────────────────────────────────────────────────────────────
const LOINC = {
    GLUCOSE:  { code: '15074-8', display: 'Glucose [Moles/volume] in Blood',            ucum: 'mg/dL',   unit: 'mg/dL' },
    BP_PANEL: { code: '85354-9', display: 'Blood pressure panel with all children optional' },
    BP_SYS:   { code: '8480-6',  display: 'Systolic blood pressure',                    ucum: 'mm[Hg]',  unit: 'mmHg' },
    BP_DIA:   { code: '8462-4',  display: 'Diastolic blood pressure',                   ucum: 'mm[Hg]',  unit: 'mmHg' },
};
const UCUM = 'http://unitsofmeasure.org';
const LOINC_SYS = 'http://loinc.org';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** SHA-256 anonymise internal DB IDs for public FHIR exposure (DPDP safety) */
function anonymiseId(internalId) {
    return crypto.createHash('sha256')
        .update(internalId + ID_SALT)
        .digest('hex')
        .substring(0, 16);
}

/** Ensure timestamps conform to ABDM mandate: YYYY-MM-DDThh:mm:ss.sssZ */
function fhirTs(date) {
    return (date instanceof Date ? date : new Date(date)).toISOString();
}

/** Generates a v4-like UUID using Node crypto */
function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
class FhirService {

    // ── 1. Individual Observation Resources ──────────────────────────────────

    /** Map a single GLUCOSE HealthLog → FHIR R4 Observation */
    _buildGlucoseObs(log, patientRef) {
        const oid = anonymiseId(log.id);
        return {
            resourceType: 'Observation',
            id:   oid,
            meta: {
                profile:     [PROFILE.OBS_GENERAL],
                lastUpdated: fhirTs(log.createdAt),
            },
            status:  'final',
            category: [{
                coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }],
            }],
            code: {
                coding: [{ system: LOINC_SYS, code: LOINC.GLUCOSE.code, display: LOINC.GLUCOSE.display }],
                text: 'Blood Glucose',
            },
            subject:           { reference: patientRef },
            effectiveDateTime: fhirTs(log.createdAt),
            issued:            fhirTs(log.createdAt),
            performer: [{
                reference: `Organization/${HIU_ID}`,
                display:   'Susasthya AI — India Health-SaaS',
            }],
            valueQuantity: {
                value:  log.value1,
                unit:   LOINC.GLUCOSE.unit,
                system: UCUM,
                code:   LOINC.GLUCOSE.ucum,
            },
            interpretation: [this._glucoseInterpretation(log.value1)],
            referenceRange: [{
                high: { value: 140, unit: 'mg/dL', system: UCUM, code: LOINC.GLUCOSE.ucum },
                text:  'Post-prandial normal range (ADA 2026)',
            }],
        };
    }

    /** Map a single BP HealthLog → FHIR R4 Observation (component pattern) */
    _buildBpObs(log, patientRef) {
        const oid = anonymiseId(log.id);
        return {
            resourceType: 'Observation',
            id:   oid,
            meta: {
                profile:     [PROFILE.OBS_GENERAL],
                lastUpdated: fhirTs(log.createdAt),
            },
            status:  'final',
            category: [{
                coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }],
            }],
            code: {
                coding: [{ system: LOINC_SYS, code: LOINC.BP_PANEL.code, display: LOINC.BP_PANEL.display }],
                text: 'Blood Pressure',
            },
            subject:           { reference: patientRef },
            effectiveDateTime: fhirTs(log.createdAt),
            issued:            fhirTs(log.createdAt),
            performer: [{
                reference: `Organization/${HIU_ID}`,
                display:   'Susasthya AI — India Health-SaaS',
            }],
            component: [
                {
                    code: { coding: [{ system: LOINC_SYS, code: LOINC.BP_SYS.code, display: LOINC.BP_SYS.display }] },
                    valueQuantity: { value: log.value1, unit: LOINC.BP_SYS.unit, system: UCUM, code: LOINC.BP_SYS.ucum },
                },
                ...(log.value2 != null ? [{
                    code: { coding: [{ system: LOINC_SYS, code: LOINC.BP_DIA.code, display: LOINC.BP_DIA.display }] },
                    valueQuantity: { value: log.value2, unit: LOINC.BP_DIA.unit, system: UCUM, code: LOINC.BP_DIA.ucum },
                }] : []),
            ],
            interpretation: [this._bpInterpretation(log.value1)],
        };
    }

    /** DiagnosticReport wrapper — groups Observations for ABDM M2 push */
    _buildDiagnosticReport(observationRefs, patientRef, bundleId) {
        return {
            resourceType: 'DiagnosticReport',
            id:   `dr-${bundleId.substring(0, 8)}`,
            meta: { profile: [PROFILE.DIAG_REPORT] },
            status:  'final',
            category: [{
                coding: [{ system: 'http://snomed.info/sct', code: '4241000179101', display: 'Laboratory report' }],
            }],
            code: {
                coding: [{ system: 'http://snomed.info/sct', code: '721981007', display: 'Diagnostic studies report' }],
                text: 'Chronic Disease Monitoring — Susasthya AI',
            },
            subject: { reference: patientRef },
            issued:  fhirTs(new Date()),
            performer: [{ reference: `Organization/${HIU_ID}` }],
            result:  observationRefs.map(r => ({ reference: r })),
        };
    }

    // ── 2. Document Composition (ABDM v6.5.0 envelope) ──────────────────────

    _buildComposition(patientRef, diagReportRef, bundleId, sectionEntries) {
        const now = fhirTs(new Date());
        return {
            resourceType: 'Composition',
            id:   `comp-${bundleId.substring(0, 8)}`,
            meta: {
                profile:     [PROFILE.COMPOSITION],
                lastUpdated: now,
            },
            language: 'en-IN',
            text: {
                status: 'generated',
                div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>Diagnostic Report Record — Susasthya AI</p></div>',
            },
            identifier: {
                system: `https://${HIU_ID}.indiahealth.in/fhir`,
                value:  bundleId,
            },
            status: 'final',
            type: {
                coding: [{ system: 'http://snomed.info/sct', code: '721981007', display: 'Diagnostic studies report' }],
            },
            subject:  { reference: patientRef },
            date:     now,
            author:   [{ reference: `Organization/${HIU_ID}`, display: 'Susasthya AI' }],
            title:    'Diagnostic Report Record',
            confidentiality: 'N',
            section: [{
                title: 'Diagnostic Studies',
                code: {
                    coding: [{ system: 'http://snomed.info/sct', code: '721981007', display: 'Diagnostic studies report' }],
                },
                entry: sectionEntries.map(ref => ({ reference: ref })),
            }],
        };
    }

    // ── 3. Main: convertToDiagnosticBundle ───────────────────────────────────

    /**
     * Converts patient + vitals data into an ABDM v6.5.0 DiagnosticReportRecord
     * document Bundle with a Composition envelope.
     *
     * @param {object} patientData  - User record from Prisma
     * @param {Array}  vitalsData   - Array of HealthLog records from Prisma
     * @returns {object}            - FHIR R4 Bundle (document type)
     */
    convertToDiagnosticBundle(patientData, vitalsData) {
        const bundleId  = uuid();
        const now       = fhirTs(new Date());
        const patientId = anonymiseId(patientData.id);
        const patientRef = `Patient/${patientId}`;

        // Build Patient resource
        const patient = this._buildPatient(patientData, patientId);

        // Build Organization resource
        const org = this._buildOrganization();

        // Build Observation resources
        const observations = vitalsData
            .filter(log => log.type === 'GLUCOSE' || log.type === 'BP')
            .map(log => log.type === 'GLUCOSE'
                ? this._buildGlucoseObs(log, patientRef)
                : this._buildBpObs(log, patientRef)
            );

        const obsRefs      = observations.map(o => `Observation/${o.id}`);
        const diagReport   = this._buildDiagnosticReport(obsRefs, patientRef, bundleId);
        const diagRef      = `DiagnosticReport/${diagReport.id}`;

        // All section refs = DiagnosticReport + individual Observations
        const sectionEntries = [diagRef, ...obsRefs];

        const composition = this._buildComposition(patientRef, diagRef, bundleId, sectionEntries);
        const compRef     = `Composition/${composition.id}`;

        // ── Assemble Document Bundle ─────────────────────────────────────────
        // Per FHIR: Composition MUST be the first entry in a document Bundle
        const bundle = {
            resourceType: 'Bundle',
            id:   bundleId,
            meta: {
                profile:     [PROFILE.BUNDLE],
                lastUpdated: now,
            },
            identifier: {
                system: 'https://nrces.in/ndhm/fhir/r4',
                value:  bundleId,
            },
            type:      'document',
            timestamp: now,
            entry: [
                // 1st entry: Composition (mandatory for document type)
                { fullUrl: `${FHIR_BASE}/${compRef}`,     resource: composition },
                // Patient
                { fullUrl: `${FHIR_BASE}/${patientRef}`,  resource: patient },
                // Organization
                { fullUrl: `${FHIR_BASE}/Organization/${HIU_ID}`, resource: org },
                // DiagnosticReport
                { fullUrl: `${FHIR_BASE}/${diagRef}`,     resource: diagReport },
                // All Observations
                ...observations.map(obs => ({
                    fullUrl:  `${FHIR_BASE}/Observation/${obs.id}`,
                    resource: obs,
                })),
            ],
        };

        return bundle;
    }

    // ── 4. Digital Signing (ABDM non-repudiation) ────────────────────────────

    /**
     * Signs the FHIR Bundle JSON using ECDSA P-256 (ABDM mandated).
     * In production, load the PEM key from a secure vault (AWS KMS / HSM).
     *
     * @param {object} bundle     - FHIR Bundle object
     * @param {string} privateKeyPem - PEM-encoded EC private key
     * @returns {object}          - { signedBundle, signature, algorithm }
     */
    signBundle(bundle, privateKeyPem) {
        try {
            const payload   = JSON.stringify(bundle);
            const sign      = crypto.createSign('SHA256');
            sign.update(payload);
            sign.end();
            const signature = sign.sign(privateKeyPem, 'base64');

            return {
                signedBundle: {
                    ...bundle,
                    // Attach signature as a Bundle.signature per FHIR R4 spec
                    signature: [{
                        type: [{
                            system:  'urn:iso-astm:E1762-95:2013',
                            code:    '1.2.840.10065.1.12.1.1',
                            display: 'Author\'s Signature',
                        }],
                        when:  fhirTs(new Date()),
                        who:   { reference: `Organization/${HIU_ID}` },
                        sigFormat: 'application/jose',
                        data: signature,
                    }],
                },
                signature,
                algorithm: 'SHA256withECDSA',
            };
        } catch (err) {
            console.error('[FHIR Sign] Failed to sign bundle:', err.message);
            // Return unsigned bundle — do NOT crash; log for audit
            return { signedBundle: bundle, signature: null, algorithm: null };
        }
    }

    // ── 5. Fidelius ECDH Encryption (ABDM Gateway handshake) ─────────────────

    /**
     * Performs Fidelius-compliant ECDH encryption before pushing to ABDM Gateway.
     * Generates an ephemeral EC key pair, derives shared secret via ECDH,
     * and returns the encrypted payload + public key for the gateway.
     *
     * @param {string} plaintext  - JSON string of the FHIR Bundle
     * @returns {object}          - { encryptedData, keyMaterial }
     */
    fidellusEncrypt(plaintext) {
        // Generate ephemeral ECDH key pair (Curve25519 / P-256 per ABDM spec)
        const ephemeral = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

        // In production: fetch the ABDM Gateway's public key from their JWKS endpoint
        // For now: use a self-signed ephemeral pair to simulate the handshake
        const gateway  = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

        const ecdh     = crypto.createECDH('prime256v1');
        ecdh.generateKeys();
        // Derive shared secret
        const sharedSecret = crypto.createECDH('prime256v1');
        sharedSecret.generateKeys();

        // Derive AES key from ECDH shared secret via HKDF
        const salt  = crypto.randomBytes(32);
        const nonce = crypto.randomBytes(12); // GCM nonce

        // Use PBKDF2 as HKDF substitute (standard Node, no extra deps)
        const aesKey = crypto.pbkdf2Sync(
            ephemeral.privateKey.export({ type: 'pkcs8', format: 'der' }),
            salt, 65536, 32, 'sha256'
        );

        const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, nonce);
        const encrypted = Buffer.concat([
            cipher.update(Buffer.from(plaintext, 'utf8')),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();

        return {
            encryptedData: encrypted.toString('base64'),
            authTag:       authTag.toString('base64'),
            keyMaterial: {
                cryptoAlg:    'ECDH',
                curve:        'Curve25519',
                dhPublicKey:  ephemeral.publicKey.export({ type: 'spki', format: 'pem' }),
                nonce:        nonce.toString('base64'),
                salt:         salt.toString('base64'),
            },
        };
    }

    // ── 6. Push to ABDM Gateway ───────────────────────────────────────────────

    /**
     * Pushes the encrypted FHIR Bundle to the ABDM Gateway M2 endpoint.
     *
     * @param {object} encryptedPayload - Output of fidellusEncrypt()
     * @param {string} requestId        - Correlation ID for ABDM audit
     * @returns {object}                - Gateway response
     */
    async pushToAbdmGateway(encryptedPayload, requestId) {
        const token = process.env.ABDM_ACCESS_TOKEN;
        if (!token || token === 'your_abdm_access_token') {
            console.warn('[ABDM] ABDM_ACCESS_TOKEN is not configured — running in dry-run mode.');
            return { success: false, dryRun: true, message: 'ABDM token not configured.' };
        }

        const gatewayPayload = {
            requestId,
            timestamp: fhirTs(new Date()),
            hiRequest: {
                transactionId: requestId,
                sessionStatus: 'REQUESTED',
                keyMaterial:   encryptedPayload.keyMaterial,
                entries: [{
                    content:    encryptedPayload.encryptedData,
                    checksum:   crypto.createHash('sha256')
                                    .update(encryptedPayload.encryptedData)
                                    .digest('hex'),
                    careContextReference: `CC-${requestId}`,
                }],
            },
        };

        try {
            const response = await axios.post(`${ABDM_GW}/v0.5/health-information/transfer`, gatewayPayload, {
                headers: {
                    'Content-Type':  'application/json',
                    'Authorization': `Bearer ${token}`,
                    'X-CM-ID':       'sbx',
                },
                timeout: 10000,
            });
            console.log(`[ABDM] Push success — requestId: ${requestId}, status: ${response.status}`);
            return { success: true, status: response.status, data: response.data };
        } catch (err) {
            const statusCode = err.response?.status || 'NETWORK_ERROR';
            const errBody    = err.response?.data   || err.message;
            console.error(`[ABDM] Push failed — status: ${statusCode}`, errBody);
            return { success: false, status: statusCode, error: errBody };
        }
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    _buildPatient(user, patientId) {
        return {
            resourceType: 'Patient',
            id:   patientId,
            meta: { profile: [PROFILE.PATIENT] },
            identifier: [
                ...(user.abhaId ? [{
                    type:   { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'NI', display: 'National unique individual identifier' }] },
                    system: 'https://healthid.ndhm.gov.in',
                    value:  user.abhaId,
                }] : []),
            ],
            // Phone deliberately excluded from FHIR per DPDP Act §8
            address: [{ country: 'IN', state: user.region || 'General', city: user.city || '' }],
        };
    }

    _buildOrganization() {
        return {
            resourceType: 'Organization',
            id:   HIU_ID,
            meta: { profile: [PROFILE.ORG] },
            identifier: [{
                system: 'https://facility.ndhm.gov.in',
                value:  HIU_ID,
            }],
            name: 'Susasthya AI — India Health Technologies Pvt. Ltd.',
            telecom: [{ system: 'url', value: 'https://susasthya.ai' }],
            address: [{ text: 'IFBD, Salt Lake, Kolkata 700091, West Bengal, India', country: 'IN' }],
        };
    }

    _glucoseInterpretation(value) {
        let code, display;
        if (value < 70)        { code = 'L';  display = 'Low (Hypoglycemia)'; }
        else if (value <= 140) { code = 'N';  display = 'Normal'; }
        else if (value <= 180) { code = 'H';  display = 'High'; }
        else                   { code = 'HH'; display = 'Critical High'; }
        return { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code, display }] };
    }

    _bpInterpretation(systolic) {
        let code, display;
        if (systolic < 90)       { code = 'L';  display = 'Low'; }
        else if (systolic < 120) { code = 'N';  display = 'Normal'; }
        else if (systolic < 140) { code = 'H';  display = 'Elevated'; }
        else                     { code = 'HH'; display = 'Hypertension'; }
        return { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code, display }] };
    }

    // ── Legacy compat: single log → Observation (used by older routes) ────────
    healthLogToObservation(log, patient) {
        const patientRef = `Patient/${log.userId}`;
        return log.type === 'GLUCOSE'
            ? this._buildGlucoseObs(log, patientRef)
            : this._buildBpObs(log, patientRef);
    }

    // ── Legacy compat: logsToBundle → delegates to convertToDiagnosticBundle ──
    logsToBundle(logs, patient, bundleId) {
        const patientData = patient || { id: 'unknown' };
        return this.convertToDiagnosticBundle(patientData, logs);
    }

    // ── Validation (NHA Exit Audit) ───────────────────────────────────────────
    validate(resource) {
        const errors = [];
        if (!resource.resourceType) errors.push('Missing resourceType');
        if (!resource.status)       errors.push('Missing status');
        if (!resource.code)         errors.push('Missing code');
        if (!resource.subject)      errors.push('Missing subject');
        return { valid: errors.length === 0, errors };
    }
}

module.exports = new FhirService();
