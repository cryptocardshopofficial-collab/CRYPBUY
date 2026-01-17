const axios = require('axios');

async function test() {
    try {
        console.log("Testing Quote for USDT...");
        const res = await axios.post('http://localhost:3000/api/quote', {
            asset: 'USDT',
            fiatAmount: 10,
            fiatCurrency: 'USD'
        });
        console.log("Quote Result:", res.data);

        console.log("\nTesting Order Creation for USDT...");
        const orderRes = await axios.post('http://localhost:3000/api/order', {
            asset: 'USDT',
            fiatAmount: 10,
            walletAddress: 'TEST_WALLET',
            country: 'US'
        });
        console.log("Order Result:", orderRes.data);

    } catch (e) {
        console.error("Error:", e.response ? e.response.data : e.message);
    }
}

test();
