import {randomBytes,scrypt as scryptCallback,createHash,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback), digest=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw Error(code);};
const usernameOK=v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(v);
const decode=value=>{
 if(typeof value!=='string'||!/^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(value))fail('invalid_password_hash');
 const [,salt,hash]=value.split('$');return {salt:Buffer.from(salt,'hex'),hash:Buffer.from(hash,'hex')};
};
export class CloudSecurity {
 static async hashPassword(password){
  if(typeof password!=='string'||password.length<12||password.length>256)fail('invalid_password');
  const salt=randomBytes(16),hash=await scrypt(password,salt,32);
  return 'scrypt-v1$'+salt.toString('hex')+'$'+hash.toString('hex');
 }
 constructor({users,now=Date.now,ttlMs=30*60*1000,maxSessions=1000}={}){
  if(!Array.isArray(users)||users.length<1||users.length>100||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>86400000||!Number.isSafeInteger(maxSessions)||maxSessions<1||maxSessions>10000)fail('invalid_security_config');
  this.users=new Map();for(const user of users){if(!usernameOK(user.username)||!['admin','viewer'].includes(user.role)||this.users.has(user.username))fail('invalid_security_user');decode(user.passwordHash);this.users.set(user.username,{username:user.username,role:user.role,passwordHash:user.passwordHash});}
  this.now=now;this.ttlMs=ttlMs;this.maxSessions=maxSessions;this.sessions=new Map();this.attempts=new Map();
 }
 prune(){const now=this.now();for(const [key,s]of this.sessions)if(now>=s.expiresAt||now<s.createdAt)this.sessions.delete(key);for(const [key,r]of this.attempts)if(now-r.at>=60000||now<r.at)this.attempts.delete(key);}
 async login(username,password,{ip=''}={}){
  this.prune();const now=this.now(),account=this.users.get(username),buckets=['ip:'+String(ip).slice(0,128),'user:'+(account?username:'unknown')];
  for(const key of buckets){let row=this.attempts.get(key);if(!row){if(this.attempts.size>=4096)fail('login_rate_limited');row={at:now,count:0};this.attempts.set(key,row);}if(row.count>=5)fail('login_rate_limited');}
  for(const key of buckets)this.attempts.get(key).count++;
  const spec=account?decode(account.passwordHash):{salt:Buffer.alloc(16),hash:Buffer.alloc(32)};
  const candidate=await scrypt(typeof password==='string'&&password.length<=256?password:'',spec.salt,32);
  if(!account||typeof password!=='string'||password.length>256||!timingSafeEqual(candidate,spec.hash))fail('login_failed');
  this.prune();if(this.sessions.size>=this.maxSessions)fail('session_capacity_reached');
  const token=randomBytes(32).toString('base64url'),csrfToken=randomBytes(32).toString('base64url'),user={username:account.username,role:account.role};
  this.sessions.set(digest(token),{user,csrfToken,createdAt:this.now(),expiresAt:this.now()+this.ttlMs});return {token,user:{...user},csrfToken};
 }
 authenticate(token){this.prune();if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))fail('admin_unauthorized');const session=this.sessions.get(digest(token));if(!session)fail('admin_unauthorized');return {user:{...session.user},csrfToken:session.csrfToken};}
 logout(token){if(typeof token==='string')this.sessions.delete(digest(token));}
 requireRole(session,role){if(!session?.user||!['admin','viewer'].includes(role)||!(session.user.role==='admin'||role==='viewer'&&session.user.role==='viewer'))fail('admin_forbidden');}
 requireCsrf(session,token){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token)||!session?.csrfToken||!timingSafeEqual(Buffer.from(token),Buffer.from(session.csrfToken)))fail('csrf_required');}
}
