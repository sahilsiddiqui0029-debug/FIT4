const twilio = require('twilio');

class NudgeService {
    constructor() {
        this.client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
        this.whatsappNumber = 'whatsapp:+14155238886'; // Twilio Sandbox Number

        this.REGIONAL_TIPS = {
            'West Bengal': "Shubho Sakal! Shorkora komiye, protidin bhora pete macher jhol ar duli bhat er poriborte kichu shobji khan.",
            'Punjab': "Sat Sri Akal! Paranthe 'ch makkhan ghat karo te protein layi dal te dahi zaroor shamil karo.",
            'General': "Good morning! Consistent logging is the first step to beating chronic illness."
        };
    }

    getRegionalAdvice(city, condition) {
        const today = new Date();
        const month = today.getMonth(); // 0-11
        const day = today.getDate();
        
        let language = 'English';
        let adviceString = "Hydrate well and manage your sugar intake. Stick to complex carbs.";
        
        const isDurgaPuja = (month === 9); // October approx
        const isPongal = (month === 0 && day >= 14 && day <= 16); // Mid Jan
        const isEkadashi = (day % 15 === 11); // Approximation
        const isSummer = (month >= 3 && month <= 5); // Apr-Jun

        let seasonAdvice = "";
        let milletAdvice = "";
        
        if (city === 'Kolkata') {
            language = 'Bengali';
            milletAdvice = "Shada bhater poriborte Kaon ba onnano low-GI chal khan.";
            if (isDurgaPuja) {
                adviceString = "Shubho Sharodiya! Pujo te ekta sandesh khele kono byapar na, kintu bhat ta aaj egiye cholun.";
            } else {
                adviceString = "Shubho din! " + milletAdvice;
            }
        } else if (city === 'Mumbai' || city === 'Pune') {
            language = 'Marathi';
            milletAdvice = "Gahvachya poli aivaji Jwarichi bhakri khawa, tyane sugar control madhye rahil.";
            if (isSummer) {
                seasonAdvice = "Khup unh ahe! Cold drinks aivaji taak (Buttermilk) pyaychya savay theva.";
            }
            if (isEkadashi) {
                seasonAdvice = "Ekadashicha upwas ahe? Keli sarke god phal talave, tyacha aivaji bhajlele makhana khawa.";
            }
            adviceString = `Namaskar! ${milletAdvice} ${seasonAdvice}`;
        } else if (city === 'Chennai') {
            language = 'Tamil';
            milletAdvice = "Sadharana arikku pathilaga Varagu (Kodo millet) saapidavum, idhu sugar-ai kuraikkum.";
            if (isPongal) {
                adviceString = "Iniya Pongal Nalvazhthukkal! Oru chiriya alavu sர்க்கரை pongal saapidalaam, aanaal inru sadharana arisiyai thavirkkavum.";
            } else if (isSummer) {
                adviceString = "Vanakam! Veyil kaalathil sarkarai kabanangalai thavirthu, Neer Mor (spiced buttermilk) kudikkavum. " + milletAdvice;
            } else {
                adviceString = "Vanakam! " + milletAdvice;
            }
        } else if (city === 'Jaipur') {
            language = 'Hindi';
            adviceString = "Namaste! Rajasthan mein apni paramparik Bajra roti par dhyan de. Iska Glycemic Index kam hota hai aur yeh swasthya ke liye acchi hai.";
        } else if (city === 'Dehradun') {
            language = 'Hindi';
            adviceString = "Namaste! Apne aahar mein sthaniya Mandua (Finger Millet) shamil kare. Yeh madhumeh (diabetes) control karne mein madad karta hai.";
        } else {
            if (isEkadashi) {
                adviceString = "If you are fasting for Ekadashi today, remember to avoid breaking the fast with high-sugar foods.";
            } else if (isSummer) {
                adviceString = "Following Ritucharya, summer calls for hydrating Buttermilk (Chaas) instead of sugary juices.";
            }
        }
        
        return { city, language, condition, advice: adviceString.trim() };
    }


    async sendWhatsAppNudge(phone, region) {
        try {
            const message = this.REGIONAL_TIPS[region] || this.REGIONAL_TIPS['General'];
            const response = await this.client.messages.create({
                from: this.whatsappNumber,
                to: `whatsapp:${phone}`,
                body: message
            });
            return response.sid;
        } catch (error) {
            console.error('WhatsApp Nudge Error:', error.message);
            return null;
        }
    }

    /**
     * sendEmergencyAlert — fires immediately when a patient reading crosses the
     * critical threshold (Glucose > 180 or BP > 140). Notifies the registered
     * family member via WhatsApp so they can act fast.
     *
     * @param {string} familyPhone  - E.164 number of the family contact (e.g. '919876543211')
     * @param {string} patientName  - Display name of the patient
     * @param {number} patientValue - The critical reading value
     * @param {string} type         - 'GLUCOSE' | 'BP'
     */
    async sendEmergencyAlert(familyPhone, patientName, patientValue, type) {
        try {
            const unit    = type === 'GLUCOSE' ? 'mg/dL (Blood Sugar)' : 'mmHg (Blood Pressure)';
            const emoji   = type === 'GLUCOSE' ? '🩸' : '❤️';
            const advice  = type === 'GLUCOSE'
                ? 'Please ensure they drink water, avoid sweets, and check with their doctor immediately.'
                : 'Please ensure they rest, reduce salt intake, and seek medical attention if above 160.';

            const body = [
                `${emoji} *HEALTH ALERT — India Health-SaaS*`,
                ``,
                `Your family member *${patientName}* just logged a critical reading:`,
                `📊 *${patientValue} ${unit}*`,
                ``,
                `⚠️ This is above the safe threshold.`,
                advice,
                ``,
                `_This is an automated alert from their health monitoring app._`
            ].join('\n');

            const response = await this.client.messages.create({
                from: this.whatsappNumber,
                to:   `whatsapp:${familyPhone}`,
                body
            });

            const maskedPhone = String(familyPhone || '').slice(0, 4) + '****';
            console.log(`[EmergencyAlert] Sent to ${maskedPhone} — SID: ${response.sid}`);
            return response.sid;
        } catch (error) {
            // Non-fatal: log but never crash the main health-log endpoint
            console.error('[EmergencyAlert] WhatsApp failed:', error.message);
            return null;
        }
    }
}

module.exports = new NudgeService();
