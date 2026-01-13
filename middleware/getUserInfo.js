const db = require('../db');

const getUserInfo = async (req, res, next) => {
  const userId = req.user.userId;
  
  try {
    const [users] = await db.execute('SELECT id, username,bio,nsfw, email, profile_pic, bg_pic FROM users WHERE id = ?', [userId]);
    
    if (users.length === 0) {
      return next(new Error('User not found'));
    }
    
    const user = users[0];
    
    const [balances] = await db.execute('SELECT balance FROM currency WHERE user_id = ?', [user.id]);
    
    const balance = balances.length > 0 ? balances[0].balance : 0;
    
    user.balance = balance;
    
    res.userInfo = user;
    
    next();
    
  } catch (err) {
    next(err);
  }
};


module.exports = getUserInfo;