const axios = require('axios');

class AbdmService {
    constructor() {
        this.gatewayUrl = process.env.ABDM_GATEWAY_URL || 'https://dev.abdm.gov.in/gateway';
    }

    async searchHealthIdByMobile(data) {
        try {
            // This requires the Bridge ID and Client Secret in headers
            const response = await axios.post(`${this.gatewayUrl}/v1/registration/mobile/search`, {
                mobile: data.mobile,
                gender: data.gender,
                yearOfBirth: data.yearOfBirth,
                name: data.name
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.ABDM_ACCESS_TOKEN}`,
                    'X-CM-ID': 'sbx' // Sandbox ID
                }
            });
            return response.data;
        } catch (error) {
            console.error('ABDM Search Error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new AbdmService();
