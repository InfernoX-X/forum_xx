const db = require('../db');

const reportToServer = async (userId, action, message) => {
    try {
        await db.execute('INSERT INTO report (user_id, action, message) VALUES (?, ?, ?)', [userId, action, message]);
    } catch (error) {
        console.error('Error inserting report:', error);
        throw new Error('Database operation failed');
    }
}


module.exports = {reportToServer}