const axios = require('axios');

async function verifyPayPalFlow() {
    try {
        console.log("1. Creating Order...");
        const orderRes = await axios.post('http://localhost:3000/api/order', {
            asset: 'USDT',
            fiatAmount: 10,
            walletAddress: 'TEST_WALLET_PAYPAL',
            country: 'US'
        });
        const order = orderRes.data;
        console.log("Order Created:", order);

        if (!order.cryptoAmount) {
            console.error("FAILED: cryptoAmount is missing in order!");
            return;
        }

        console.log("2. Initiating PayPal Payment...");
        // This simulates the request the frontend makes
        // Note: This might fail if PayPal credentials are invalid, but we want to see if it crashes the server
        const paypalRes = await axios.post('http://localhost:3000/api/paypal/create-payment', {
            orderId: order.orderId
        });
        
        console.log("PayPal Response:", paypalRes.data);
        if (paypalRes.data.approvalUrl) {
            console.log("SUCCESS: PayPal Approval URL received.");
        } else {
            console.log("WARNING: No approval URL (might be due to credentials/validation).");
        }

    } catch (e) {
        if (e.response) {
            console.error("Server Error:", e.response.status, e.response.data);
        } else {
            console.error("Error:", e.message);
        }
    }
}

verifyPayPalFlow();
