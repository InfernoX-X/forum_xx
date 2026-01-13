const fs = require('fs');
const path = require('path');

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        // Generate a random index from 0 to i
        const j = Math.floor(Math.random() * (i + 1));
        
        // Swap elements at index i and j
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  
// Convert buffer to Base64 string
const convertToBase64 = (buffer) => buffer.toString('base64');
const noPic_base64Image = convertToBase64(fs.readFileSync(path.join(__dirname, '../public/img/images/no-pic.jpg')));

const getUserProfile = async (connection, userId) => {
  // Function to fetch user profile details
  return new Promise((resolve, reject) => {
    const query = "SELECT id, username, email, bio, bg_pic, profile_pic FROM users WHERE id = ?";
    connection.query(query, [userId], (err, results) => {
      if (err) return reject(err);
      resolve(results[0]);
    });
  });
};

const getUserBalance = async (connection,userId) => {
  // Function to fetch user balance
  return new Promise((resolve, reject) => {
    const query = "SELECT balance FROM currency WHERE user_id = ?";
    connection.query(query, [userId], (err, results) => {
      if (err) return reject(err);
      resolve(results[0].balance);
    });
  });
};

function generateRandomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';

    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }

    return result;
}

module.exports = {convertToBase64,noPic_base64Image,shuffleArray, getUserBalance,getUserProfile,generateRandomString}
