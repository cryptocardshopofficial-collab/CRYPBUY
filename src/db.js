const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '..', 'data', 'orders.json');
const DATA_DIR = path.dirname(DB_FILE);

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Ensure db file exists
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
}

function getAllOrders() {
    try {
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

function saveOrder(order) {
    const orders = getAllOrders();
    const existingIndex = orders.findIndex(o => o.orderId === order.orderId);
    
    if (existingIndex >= 0) {
        orders[existingIndex] = order;
    } else {
        orders.push(order);
    }
    
    fs.writeFileSync(DB_FILE, JSON.stringify(orders, null, 2));
    return order;
}

function getOrder(orderId) {
    const orders = getAllOrders();
    return orders.find(o => o.orderId === orderId);
}

module.exports = { saveOrder, getOrder, getAllOrders };
