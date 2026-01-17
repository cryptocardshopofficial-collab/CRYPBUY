
const axios = require('axios');

class PaymentProcessor {
    constructor() {
        // CONFIGURE YOUR REAL GATEWAY HERE
        // Since you don't want Stripe/PayPal, you will likely use NMI, Authorize.Net, or a High-Risk Processor.
        this.config = {
            mode: 'simulation', // Change to 'live' when you have API keys
            gatewayUrl: 'https://api.nmi.com/api/transact.php', // Example endpoint
            apiKey: 'INSERT_YOUR_REAL_API_KEY_HERE'
        };
    }

    // Luhn Algorithm to validate real credit card numbers
    isValidCardNumber(number) {
        // Remove spaces and dashes
        const sanitized = number.replace(/[\s-]/g, '');
        if (!/^\d+$/.test(sanitized)) return false;

        let sum = 0;
        let shouldDouble = false;

        // Loop from right to left
        for (let i = sanitized.length - 1; i >= 0; i--) {
            let digit = parseInt(sanitized.charAt(i));

            if (shouldDouble) {
                if ((digit *= 2) > 9) digit -= 9;
            }

            sum += digit;
            shouldDouble = !shouldDouble;
        }

        return (sum % 10) === 0;
    }

    async processPayment(order, cardDetails) {
        const { cardNumber, expiry, cvv, cardHolder } = cardDetails;

        // 1. Validate Card Number (Luhn Check)
        if (!this.isValidCardNumber(cardNumber)) {
            throw new Error('Invalid card number. Please check your digits.');
        }

        // 2. Validate Expiry (Simple check)
        const [expMonth, expYear] = expiry.split('/');
        if (!expMonth || !expYear) throw new Error('Invalid expiry date format (MM/YY)');
        
        const now = new Date();
        const currentYear = parseInt(now.getFullYear().toString().substr(-2));
        const currentMonth = now.getMonth() + 1;

        if (parseInt(expYear) < currentYear || (parseInt(expYear) === currentYear && parseInt(expMonth) < currentMonth)) {
            throw new Error('Card has expired');
        }

        // 3. PROCESS PAYMENT
        if (this.config.mode === 'live') {
            // REAL MONEY MODE
            // This code will run when you insert your API Key in the constructor
            try {
                // Example of how a real direct post works (pseudocode):
                /*
                const response = await axios.post(this.config.gatewayUrl, {
                    security_key: this.config.apiKey,
                    ccnumber: cardNumber,
                    ccexp: expiry,
                    amount: order.amount,
                    type: 'sale'
                });
                return response.data;
                */
                throw new Error('Live Gateway API Key missing. Please update src/payment-processor.js');
            } catch (error) {
                throw error;
            }
        } else {
            // SIMULATION MODE (For Testing Flow)
            // Simulates a realistic bank authorization delay
            await new Promise(resolve => setTimeout(resolve, 2500));
            
            // 4. Generate Transaction Result
            const success = true; // Simulating 100% approval for now
            
            if (success) {
                return {
                    success: true,
                    transactionId: 'tx_' + Math.random().toString(36).substr(2, 12).toUpperCase(),
                    authCode: Math.floor(100000 + Math.random() * 900000).toString(),
                    message: 'Approved',
                    timestamp: new Date().toISOString()
                };
            } else {
                throw new Error('Transaction declined by issuer');
            }
        }
    }
}

module.exports = new PaymentProcessor();
