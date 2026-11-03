const Razorpay = require('razorpay');

class PaymentService {
    constructor() {
        this.razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID || 'dummy_key_id_to_prevent_crash',
            key_secret: process.env.RAZORPAY_KEY_SECRET || 'dummy_secret',
        });
    }

    async createProSubscription(userId) {
        try {
            // Plan ID should be created in the Razorpay dashboard for ₹299
            const planId = process.env.RAZORPAY_PRO_PLAN_ID;
            if (!planId) {
                console.warn('[Razorpay] Warning: RAZORPAY_PRO_PLAN_ID not found in env, using test fallback');
            }
            
            const subscription = await this.razorpay.subscriptions.create({
                plan_id: planId || 'plan_test_123',
                customer_notify: 1,
                total_count: 12, // For a yearly cycle
                addons: [],
                notes: {
                    tier: 'PRO',
                    userId: userId // Essential for webhook mapping
                }
            });

            return subscription.short_url; // Direct link to send to the user
        } catch (error) {
            console.error('Razorpay Error:', error);
            throw new Error('Could not generate subscription link');
        }
    }
}

module.exports = new PaymentService();
