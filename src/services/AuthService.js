const bcrypt=require('bcryptjs');const crypto=require('crypto');const User=require('../models/User');
class AuthService {constructor(repo){this.repo=repo;}
 async register(email,password){email=String(email||'').trim().toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('Enter a valid email address.');if(typeof password!=='string'||password.length<8)throw Error('Password must contain at least 8 characters.');if(this.repo.findByEmail(email))throw Error('This email is already registered.');const user=new User({id:crypto.randomUUID(),email,passwordHash:await bcrypt.hash(password,10)});this.repo.save(user);return user;}
 async login(email,password){const user=this.repo.findByEmail(String(email||'').trim().toLowerCase());if(!user||!(await bcrypt.compare(String(password||''),user.passwordHash)))throw Error('Invalid email or password.');return user;}
 savePreferences(id,preferences){const user=this.repo.findById(id);if(!user)throw Error('User not found.');const allowed=new Set(['zip','insurerId','planId']);user.preferences=Object.fromEntries(Object.entries({...user.preferences,...preferences}).filter(([key])=>allowed.has(key)));this.repo.save(user);return user.preferences;}
}
module.exports=AuthService;
