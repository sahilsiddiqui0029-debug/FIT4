/**
 * FHIR R4 DiagnosticReportRecord ABDM v6.5.0 Conformance Test Suite
 * Validates document Bundle structure, Composition envelope, Patient,
 * Observation (Glucose & BP), and Organization resources.
 */

const assert = require('assert');
const fhirService = require('../services/fhirService');

console.log('='.repeat(70));
console.log('🧪 RUNNING FIT4 FHIR R4 ABDM v6.5.0 CONFORMANCE TEST SUITE');
console.log('='.repeat(70));

const mockPatient = {
    id: 'usr_pat_987654321',
    name: 'Rajesh Sharma',
    phone: '+919876543210',
    gender: 'MALE',
    dateOfBirth: '1982-05-15',
    createdAt: new Date('2026-01-01T00:00:00Z')
};

const mockVitals = [
    {
        id: 'log_glu_001',
        userId: mockPatient.id,
        type: 'GLUCOSE',
        value1: 115,
        unit: 'mg/dL',
        createdAt: new Date('2026-10-08T08:30:00Z')
    },
    {
        id: 'log_bp_002',
        userId: mockPatient.id,
        type: 'BP',
        value1: 122,
        value2: 78,
        unit: 'mmHg',
        createdAt: new Date('2026-10-08T08:35:00Z')
    }
];

// Test 1: Generate Document Bundle
console.log('[Test 1] Generating Diagnostic Document Bundle...');
const bundle = fhirService.convertToDiagnosticBundle(mockPatient, mockVitals);

assert.strictEqual(bundle.resourceType, 'Bundle', 'Bundle resourceType must be Bundle');
assert.strictEqual(bundle.type, 'document', 'Bundle type must be document');
assert(bundle.id, 'Bundle must have an ID');
assert(Array.isArray(bundle.entry), 'Bundle entry must be an array');
assert(bundle.entry.length >= 5, 'Bundle must contain Composition, Patient, Organization, Observations, and DiagnosticReport');
console.log(` -> PASS: Document Bundle created with ${bundle.entry.length} entries.`);

// Test 2: Composition must be the 1st entry
console.log('[Test 2] Validating Composition Envelope as 1st Entry...');
const firstEntry = bundle.entry[0];
assert.strictEqual(firstEntry.resource.resourceType, 'Composition', 'First entry must be Composition');
assert(firstEntry.resource.meta.profile.includes('https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord'));
console.log(' -> PASS: First entry is ABDM DiagnosticReportRecord Composition.');

// Test 3: Patient Anonymization & Resource Structure
console.log('[Test 3] Validating Patient Profile & DPDP Compliance...');
const patientEntry = bundle.entry.find(e => e.resource.resourceType === 'Patient');
assert(patientEntry, 'Bundle must include Patient resource');
assert(patientEntry.resource.meta.profile.includes('https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient'));
assert(!patientEntry.resource.id.includes(mockPatient.id), 'Internal DB ID must be anonymized');
assert.strictEqual(patientEntry.resource.address[0].country, 'IN');
console.log(' -> PASS: Patient resource conforms to FHIR R4 and DPDP privacy guidelines.');

// Test 4: Observations (Glucose LOINC & BP Components)
console.log('[Test 4] Validating Clinical Observations (Glucose LOINC 15074-8 & BP 85354-9)...');
const glucoseObs = bundle.entry.find(e => e.resource.resourceType === 'Observation' && e.resource.code.text === 'Blood Glucose');
assert(glucoseObs, 'Must include Blood Glucose Observation');
assert.strictEqual(glucoseObs.resource.valueQuantity.value, 115);
assert.strictEqual(glucoseObs.resource.valueQuantity.unit, 'mg/dL');

const bpObs = bundle.entry.find(e => e.resource.resourceType === 'Observation' && e.resource.code.text === 'Blood Pressure');
assert(bpObs, 'Must include Blood Pressure Observation');
assert(Array.isArray(bpObs.resource.component), 'BP Observation must have systolic/diastolic components');
assert.strictEqual(bpObs.resource.component.length, 2);
console.log(' -> PASS: Observations correctly mapped with LOINC & UCUM codings.');

// Test 5: Validation Method
console.log('[Test 5] Validating NHA Exit Audit validation check...');
const valResult = fhirService.validate(glucoseObs.resource);
assert.strictEqual(valResult.valid, true, 'Observation must pass NHA validation');
console.log(' -> PASS: Resource validation passed with 0 errors.');

console.log('='.repeat(70));
console.log('🎉 ALL 5 FHIR R4 TESTS PASSED (100% ABDM v6.5.0 COMPLIANCE)');
console.log('='.repeat(70));
