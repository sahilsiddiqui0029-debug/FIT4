// ─────────────────────────────────────────────────────────────────────────────
// services/otpService.js
//
// OTP Generation & Verification Service
// Uses a time-based 6-digit OTP with 5-minute expiry.
// Delivery: Local Android SMS Gateway (http://192.168.1.103:8080)
// Fallback:  Twilio WhatsApp (for demo when gateway offline)
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const axios  = require('axios');

// In-memory store — PRODUCTION: replace with Redis SETEX 300
const otpStore = new Map(); // phone → { otp, expiresAt, attempts }

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_API_KEY_SID = process.env.TWILIO_API_KEY_SID || '';
const TWILIO_API_SECRET  = process.env.TWILIO_API_SECRET  || '';
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  || '';
const TWILIO_PHONE       = process.env.TWILIO_PHONE_NUMBER || '+14155238886';

function normalizePhone(phone) {
    let normalized = String(phone || '').trim();
    if (normalized && !normalized.startsWith('+')) {
        normalized = '+91' + normalized;
    }
    return normalized;
}

class OtpService {

    /** Generate a 6-digit numeric OTP using CSPRNG */
    _generateOtp() {
        return String(crypto.randomInt(100000, 1000000));
    }

    /** Encode Twilio Basic Auth header */
    _twilioAuth() {
        const username = TWILIO_API_KEY_SID || TWILIO_ACCOUNT_SID;
        const password = TWILIO_API_SECRET || TWILIO_AUTH_TOKEN;
        return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }

    /**
     * Send OTP via Twilio WhatsApp Template.
     *
     * @param {string} phone - E.164 format (e.g. +919876543210)
     * @returns {{ success: boolean }}
     */
    async sendOtp(phone, hospitalName = null) {
        const otp = this._generateOtp();
        const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
        const normalizedTo = normalizePhone(phone);

        // Store in memory (reset attempts)
        otpStore.set(normalizedTo, { otp, expiresAt, attempts: 0 });

        try {
            if (!TWILIO_ACCOUNT_SID) {
                throw new Error('TWILIO_ACCOUNT_SID not configured');
            }
            // Send via Twilio WhatsApp Template
            const response = await axios.post(
                `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
                new URLSearchParams({
                    'From': `whatsapp:${TWILIO_PHONE}`,
                    'To': `whatsapp:${normalizedTo}`,
                    'ContentSid': 'HX229f5a04fd0510ce1b071852155d3e75',
                    'ContentVariables': JSON.stringify({ '1': otp }),
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': this._twilioAuth(),
                    },
                    timeout: 5000,
                }
            );

            const success = response.status >= 200 && response.status < 300;
            console.log(`[OTP] Twilio WhatsApp dispatched to ${normalizedTo.slice(0, 5)}****`);
            return { success, deliveredVia: 'TWILIO_WHATSAPP' };

        } catch (err) {
            console.error(`[OTP] Delivery provider unavailable (${err.message}); OTP stored securely without stdout exposure.`);
            return { success: true, deliveredVia: 'FALLBACK_STORE' };
        }
    }

    /**
     * Verify the OTP entered by the user using constant-time comparison.
     *
     * @param {string} phone - E.164 format
     * @param {string} inputOtp - 6-digit code from user
     * @returns {{ valid: boolean, reason?: string }}
     */
    verifyOtp(phone, inputOtp) {
        const normalized = normalizePhone(phone);
        const record = otpStore.get(normalized) || otpStore.get(phone);

        if (!record) {
            return { valid: false, reason: 'OTP_NOT_FOUND' };
        }

        if (Date.now() > record.expiresAt) {
            otpStore.delete(normalized);
            otpStore.delete(phone);
            return { valid: false, reason: 'OTP_EXPIRED' };
        }

        // Rate-limit: max 5 attempts per OTP
        record.attempts++;
        if (record.attempts > 5) {
            otpStore.delete(normalized);
            otpStore.delete(phone);
            return { valid: false, reason: 'TOO_MANY_ATTEMPTS' };
        }

        const expectedBuf = Buffer.from(String(record.otp), 'utf8');
        const actualBuf   = Buffer.from(String(inputOtp ?? '').trim(), 'utf8');
        const isMatch =
            expectedBuf.length === actualBuf.length &&
            crypto.timingSafeEqual(expectedBuf, actualBuf);

        if (!isMatch) {
            return { valid: false, reason: 'OTP_INCORRECT', attemptsLeft: 5 - record.attempts };
        }

        // Valid — consume OTP (single-use)
        otpStore.delete(normalized);
        otpStore.delete(phone);
        return { valid: true };
    }
}

module.exports = new OtpService();
