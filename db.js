
// db.js
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Replace with your actual database credentials
const pool = mysql.createPool({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    port: 12479,
    ssl: {
        ca: fs.readFileSync(path.join(__dirname, 'certs/ca.pem')),
    },
    waitForConnections: true,
    connectTimeout: 10000, // 10 seconds
    connectionLimit: 8,
    queueLimit: 0
});

module.exports = pool;