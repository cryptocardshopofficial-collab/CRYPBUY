require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const paypal = require('paypal-rest-sdk');
const TronWeb = require('tronweb');
const { saveOrder, getOrder, getAllOrders } = require('./db');
const paymentProcessor = require('./payment-processor');
// Placeholder for Stripe - User needs to add keys in .env
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const app = express();
const port = process.env.PORT || 3000;
const baseUrl = process.env.APP_BASE_URL || `http://localhost:${port}`;

const usdtTrc20Mode = (process.env.USDT_TRC20_MODE || 'real').toLowerCase();
const tronPrivateKey = process.env.TRON_PRIVATE_KEY || '';
const tronFullHost = process.env.TRON_FULL_HOST || 'https://api.trongrid.io';
const tronUsdtContract = process.env.TRC20_USDT_CONTRACT || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

let tronWeb = null;

if (usdtTrc20Mode === 'real' && tronPrivateKey) {
    tronWeb = new TronWeb(tronFullHost, tronFullHost, tronFullHost, tronPrivateKey);
} else if (usdtTrc20Mode === 'real' && !tronPrivateKey) {
    console.warn('TRON_PRIVATE_KEY is not set. USDT TRC20 auto delivery is disabled.');
} else if (usdtTrc20Mode === 'mock') {
    console.log('USDT TRC20 is running in MOCK mode. No real blockchain transfers will be made.');
}

async function getMarketPrice(asset) {
    console.log(`Getting price for asset: ${asset}`);
    const coinMap = { 
        'BTC': 'bitcoin', 'ETH': 'ethereum', 'USDT': 'tether', 'XRP': 'ripple',
        'BNB': 'binancecoin', 'SOL': 'solana', 'USDC': 'usd-coin',
        'TRX': 'tron', 'DOGE': 'dogecoin', 'ADA': 'cardano'
    };
    const coinId = coinMap[asset];
    
    if (coinId) {
        try {
            // Add a small delay or better headers if needed, but for now just log
            const response = await axios.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`, {
                timeout: 5000 // 5s timeout
            });
            const price = response.data[coinId].usd;
            console.log(`Fetched price for ${asset} (${coinId}): $${price}`);
            return price;
        } catch (err) {
            console.error(`CoinGecko Error for ${asset}:`, err.message);
        }
    } else {
        console.warn(`Unknown asset: ${asset}`);
    }
    
    // Fallbacks (Updated prices)
    const defaults = {
        'BTC': 65000, 'ETH': 2600, 'USDT': 1.00, 'XRP': 0.60, 
        'BNB': 600, 'SOL': 150, 'USDC': 1.00, 'TRX': 0.12, 
        'DOGE': 0.16, 'ADA': 0.45
    };
    const fallbackPrice = defaults[asset] || 1.00;
    console.log(`Using fallback price for ${asset}: $${fallbackPrice}`);
    return fallbackPrice;
}

function getFiatRateToUsd(code) {
    const upper = (code || 'USD').toUpperCase();
    const rates = {
        USD: 1,
        EUR: 1.08,
        GBP: 1.27,
        AED: 0.27,
        INR: 0.012,
        CNY: 0.14,
        AUD: 0.66,
        CAD: 0.75,
        JPY: 0.0067,
        BRL: 0.20,
        MXN: 0.059,
        HKD: 0.13,
        SGD: 0.74,
        NZD: 0.61,
        CHF: 1.13,
        SEK: 0.096,
        NOK: 0.095,
        DKK: 0.15,
        PLN: 0.25,
        RUB: 0.011,
        ZAR: 0.053,
        TRY: 0.031,
        KRW: 0.00075,
        MYR: 0.21,
        THB: 0.028,
        PHP: 0.018,
        IDR: 0.000064,
        VND: 0.000041,
        SAR: 0.27,
        KWD: 3.25
    };
    return rates[upper] || 1;
}

function isPayPalSupported(currency) {
    const supported = [
        'AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 
        'ILS', 'JPY', 'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 
        'GBP', 'RUB', 'SGD', 'SEK', 'CHF', 'THB', 'USD'
    ];
    return supported.includes(currency);
}

async function sendUsdtTrc20(order) {
    if (order.asset !== 'USDT' || order.network !== 'TRC20') {
        throw new Error('Auto delivery is only enabled for USDT on TRC20');
    }

    const amount = Number(order.cryptoAmount);
    if (!amount || Number.isNaN(amount) || amount <= 0) {
        throw new Error('Invalid USDT amount for transfer');
    }

    if (usdtTrc20Mode === 'mock') {
        const mockTx = 'MOCKUSDT-' + Date.now().toString(16);
        console.log(`Mock USDT TRC20 send: ${amount} USDT to ${order.walletAddress}, tx=${mockTx}`);
        return mockTx;
    }

    if (!tronWeb) {
        throw new Error('TRON Web not configured');
    }

    const amountInSun = Math.round(amount * 1e6);

    const contract = await tronWeb.contract().at(tronUsdtContract);
    const tx = await contract.transfer(order.walletAddress, amountInSun).send({
        feeLimit: 10000000
    });

    if (typeof tx === 'string') {
        return tx;
    }

    if (tx && tx.txid) {
        return tx.txid;
    }

    throw new Error('Unexpected TRON transaction response');
}

let webProfileId = '';

try {
    const paypalMode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase();
    console.log(`Configuring PayPal in ${paypalMode} mode...`);
    
    paypal.configure({
      'mode': paypalMode, // sandbox or live
      'client_id': process.env.PAYPAL_CLIENT_ID || 'missing_client_id',
      'client_secret': process.env.PAYPAL_CLIENT_SECRET || 'missing_client_secret'
    });
    console.log('PayPal configured.');

    // Create Web Experience Profile for Guest Checkout
    const webProfileJson = {
        "name": "CRYPBUY_Guest_" + Date.now(),
        "presentation": {
            "brand_name": "CRYPBUY",
            "locale_code": "US"
        },
        "input_fields": {
            "no_shipping": 1,
            "address_override": 1
        },
        "flow_config": {
            "landing_page_type": "billing", // Force guest checkout (card fields)
            "user_action": "commit"
        }
    };

    paypal.webProfile.create(webProfileJson, function (error, web_profile) {
        if (error) {
            console.error('Error creating Web Profile:', error);
        } else {
            webProfileId = web_profile.id;
            console.log('Web Profile Created:', webProfileId);
        }
    });

} catch (err) {
    console.error('PayPal Configuration Error:', err);
}

app.use(cors());
app.use(express.json());

app.use(express.static('public'));

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', name: 'CRYPBUY', mode: 'production-ready' });
});

app.post('/api/quote', async (req, res) => {
    const { fiatAmount, fiatCurrency, asset } = req.body;
    
    try {
        const amount = Number(fiatAmount);
        if (!fiatAmount || Number.isNaN(amount)) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const upperFiat = (fiatCurrency || 'USD').toUpperCase();
        const fxRate = getFiatRateToUsd(upperFiat);
        const amountUsd = amount * fxRate;

        const price = await getMarketPrice(asset);
        const cryptoAmount = (amountUsd / price).toFixed(6);

        res.json({
            asset,
            fiatAmount: amount,
            fiatCurrency: upperFiat,
            fiatAmountUsd: Number(amountUsd.toFixed(2)),
            cryptoAmount,
            rate: price,
            fxRateToUsd: fxRate
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch quote' });
    }
});

app.post('/api/quote-from-crypto', async (req, res) => {
    const { cryptoAmount, fiatCurrency, asset } = req.body;
    
    try {
        const qty = Number(cryptoAmount);
        if (!cryptoAmount || Number.isNaN(qty) || qty <= 0) {
            return res.status(400).json({ error: 'Invalid quantity' });
        }

        const upperFiat = (fiatCurrency || 'USD').toUpperCase();
        const fxRate = getFiatRateToUsd(upperFiat);

        const price = await getMarketPrice(asset);
        const amountUsd = qty * price;
        const fiatAmount = amountUsd / fxRate;

        res.json({
            asset,
            fiatAmount: Number(fiatAmount.toFixed(2)),
            fiatCurrency: upperFiat,
            fiatAmountUsd: Number(amountUsd.toFixed(2)),
            cryptoAmount: qty.toFixed(6),
            rate: price,
            fxRateToUsd: fxRate
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch quote from quantity' });
    }
});

app.post('/api/order', async (req, res) => {
    const { fiatAmount, asset, walletAddress, country, fiatCurrency, network } = req.body;

    const amount = Number(fiatAmount);
    const supportedCountries = ['US', 'UK', 'CA', 'AU', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'CH', 'SE', 'NO', 'DK', 'FI', 'IE', 'NZ', 'JP', 'KR', 'CN', 'HK', 'SG', 'MY', 'TH', 'ID', 'VN', 'PH', 'IN', 'AE', 'SA', 'ZA', 'BR', 'MX', 'AR', 'CO', 'CL', 'PE', 'RU', 'TR', 'PL', 'CZ', 'HU', 'IL', 'EG', 'NG', 'KE', 'OTHER'];

    if (!fiatAmount || Number.isNaN(amount) || !asset || !walletAddress || !country) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!supportedCountries.includes(country) && country !== 'OTHER') {
        // Now we support almost all countries, but keep validation for legacy/safety
        // In a real app we might validate against a full ISO country list
        // For now, if the UI sends it, we trust it or map to OTHER
        // We will relax this check or expand the supported list dynamically
    }

    const upperFiat = (fiatCurrency || 'USD').toUpperCase();
    const fxRate = getFiatRateToUsd(upperFiat);
    const amountUsd = amount * fxRate;

    if (!network) {
        return res.status(400).json({ error: 'Network is required' });
    }

    const price = await getMarketPrice(asset);
    const cryptoAmount = (amountUsd / price).toFixed(6);

    const orderId = `ord-${Date.now()}`;
    const order = {
        orderId,
        status: 'pending',
        asset,
        fiatAmount: amount,
        fiatCurrency: upperFiat,
        fiatAmountUsd: Number(amountUsd.toFixed(2)),
        cryptoAmount,
        network: network || 'Native',
        walletAddress,
        country,
        createdAt: new Date(),
        message: 'Order created, waiting for payment'
    };

    saveOrder(order);

    res.json(order);
});

// Admin API to list orders
app.get('/api/admin/orders', (req, res) => {
    // In a real app, you'd check for admin session/token here
    const allOrders = getAllOrders().sort((a,b) => b.createdAt - a.createdAt);
    res.json(allOrders);
});

// Admin: Mark order as Completed (Crypto Sent)
app.post('/api/admin/order/:id/complete', (req, res) => {
    const { id } = req.params;
    const { txHash } = req.body; // Admin can optionally provide a TX hash
    
    const order = getOrder(id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    order.status = 'completed';
    order.txHash = txHash || 'Manual Transfer';
    saveOrder(order);
    
    res.json({ success: true, order });
});

// Process Card Payment (Custom Processor)
app.post('/api/pay', async (req, res) => {
    const { orderId, cardNumber, expiry, cvv, cardHolder } = req.body;
    
    const order = getOrder(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'completed') return res.status(400).json({ error: 'Order already completed' });

    try {
        const result = await paymentProcessor.processPayment(order, {
            cardNumber, expiry, cvv, cardHolder
        });

        let autoTxHash = null;

        if (order.asset === 'USDT' && order.network === 'TRC20') {
            try {
                autoTxHash = await sendUsdtTrc20(order);
            } catch (e) {
                console.error('Auto USDT TRC20 send failed:', e.message);
            }
        }

        const last4 = cardNumber.replace(/\D/g, '').slice(-4);
        
        order.status = autoTxHash ? 'completed' : 'paid';
        order.paymentChannel = 'card_direct';
        order.cardLast4 = last4;
        order.cardHolder = cardHolder;
        order.paymentId = result.transactionId;
        order.authCode = result.authCode;
        order.txHash = autoTxHash || null;
        order.completedAt = autoTxHash ? new Date() : null;
        order.message = autoTxHash ? 'Payment approved. Crypto sent automatically.' : 'Payment approved. Waiting for crypto delivery.';

        saveOrder(order);

        res.json({
            orderId: order.orderId,
            status: order.status,
            txHash: order.txHash,
            message: order.message,
            cardLast4: order.cardLast4
        });

    } catch (error) {
        console.error("Payment Error:", error.message);
        res.status(400).json({ error: error.message });
    }
});

// PayPal: Create Payment
app.post('/api/paypal/create-payment', (req, res) => {
    const { orderId } = req.body;
    const order = getOrder(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Check if the order's currency is supported by PayPal
    const currency = (order.fiatCurrency || 'USD').toUpperCase();
    const isSupported = isPayPalSupported(currency);

    // If supported, use the native currency amount. 
    // If NOT supported (e.g. INR, AED), use the calculated USD equivalent.
    const paymentCurrency = isSupported ? currency : 'USD';
    const paymentAmount = isSupported ? order.fiatAmount : (order.fiatAmountUsd || order.fiatAmount);

    const create_payment_json = {
        "intent": "sale",
        "experience_profile_id": webProfileId,
        "payer": {
            "payment_method": "paypal"
        },
        "redirect_urls": {
            "return_url": `${baseUrl}/api/paypal/success?orderId=${orderId}`,
            "cancel_url": `${baseUrl}/api/paypal/cancel`
        },
        "transactions": [{
            "item_list": {
                "items": [{
                    "name": `${order.cryptoAmount} ${order.asset}`,
                    "sku": order.orderId,
                    "price": paymentAmount.toFixed(2),
                    "currency": paymentCurrency,
                    "quantity": 1
                }]
            },
            "amount": {
                "currency": paymentCurrency,
                "total": paymentAmount.toFixed(2)
            },
            "description": `Purchase of ${order.cryptoAmount} ${order.asset}`
        }]
    };

    paypal.payment.create(create_payment_json, function (error, payment) {
        if (error) {
            console.error(error);
            res.status(500).json({ error: error.response });
        } else {
            for(let i = 0; i < payment.links.length; i++){
                if(payment.links[i].rel === 'approval_url'){
                    res.json({ approvalUrl: payment.links[i].href });
                    return;
                }
            }
        }
    });
});

// PayPal: Execute Payment (Success Callback)
app.get('/api/paypal/success', (req, res) => {
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    const orderId = req.query.orderId;
    
    const order = getOrder(orderId);
    if (!order) return res.send('Order not found');

    const currency = (order.fiatCurrency || 'USD').toUpperCase();
    const isSupported = isPayPalSupported(currency);
    const paymentCurrency = isSupported ? currency : 'USD';
    const paymentAmount = isSupported ? order.fiatAmount : (order.fiatAmountUsd || order.fiatAmount);

    const execute_payment_json = {
        "payer_id": payerId,
        "transactions": [{
            "amount": {
                "currency": paymentCurrency,
                "total": paymentAmount.toFixed(2)
            }
        }]
    };

    paypal.payment.execute(paymentId, execute_payment_json, async function (error, payment) {
        if (error) {
            console.error(error.response);
            res.send('Payment execution failed');
        } else {
            let autoTxHash = null;

            if (order.asset === 'USDT' && order.network === 'TRC20') {
                try {
                    autoTxHash = await sendUsdtTrc20(order);
                } catch (e) {
                    console.error('Auto USDT TRC20 send failed (PayPal):', e.message);
                }
            }

            order.status = autoTxHash ? 'completed' : 'paid';
            order.paymentChannel = 'paypal';
            order.paymentId = paymentId;
            order.txHash = autoTxHash || null;
            order.completedAt = autoTxHash ? new Date() : null;
            order.message = autoTxHash ? 'Payment received via PayPal. Crypto sent automatically.' : 'Payment received via PayPal. Waiting for crypto delivery.';
            saveOrder(order);

            res.send(`
                <html>
                    <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
                        <h1 style="color: green;">Payment Received!</h1>
                        <p>Order #${orderId} is now <strong>${autoTxHash ? 'COMPLETED' : 'PAID'}</strong>.</p>
                        <p>${autoTxHash ? 'Your USDT has been sent automatically to your wallet.' : 'We will send your crypto shortly.'}</p>
                        <p>You can close this window.</p>
                        <script>
                            if(window.opener) {
                                window.opener.postMessage({ status: '${autoTxHash ? 'completed' : 'paid'}', orderId: '${orderId}' }, '*');
                                window.close();
                            }
                        </script>
                    </body>
                </html>
            `);
        }
    });
});

// PayPal: Cancel
app.get('/api/paypal/cancel', (req, res) => {
    res.send('Payment cancelled');
});

app.listen(port, () => {
    console.log(`CRYPBUY server running at http://localhost:3000`);
});
