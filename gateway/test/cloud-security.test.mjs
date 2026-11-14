import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CloudSecurity} from '../cloud-security.mjs';
const password='test-only-password-1234';
const hash=await CloudSecurity.hashPassword(password);
const users=[{username:'admin',role:'admin',passwordHash:hash},{username:'reader',role:'viewer',passwordHash:hash}];
test('scrypt hashes use random salt and sessions retain only token digest',async()=>{
 assert.notEqual(await CloudSecurity.hashPassword(password),hash);assert.ok(!hash.includes(password));
 const security=new CloudSecurity({users}),login=await security.login('admin',password,{ip:'loopback'});
 assert.equal(login.token.length,43);assert.equal(security.sessions.has(login.token),false);
 const session=security.authenticate(login.token);security.requireRole(session,'admin');security.requireCsrf(session,login.csrfToken);
 session.user.role='viewer';assert.equal(security.authenticate(login.token).user.role,'admin');
 security.logout(login.token);assert.throws(()=>security.authenticate(login.token),/unauthorized/);
});
test('viewer cannot mutate; invalid csrf and session credentials rejected',async()=>{
 const security=new CloudSecurity({users}),login=await security.login('reader',password);
 const session=security.authenticate(login.token);security.requireRole(session,'viewer');
 assert.throws(()=>security.requireRole(session,'admin'),/forbidden/);
 for(const value of ['', 'x'.repeat(43), '你'.repeat(43)])assert.throws(()=>security.requireCsrf(session,value),/csrf_required/);
 assert.throws(()=>security.authenticate('fake'),/unauthorized/);
});
test('session expiry, clock rollback, restart and maximum capacity fail closed',async()=>{
 let now=10000;const security=new CloudSecurity({users,now:()=>now,ttlMs:1000,maxSessions:1});
 const first=await security.login('admin',password);await assert.rejects(security.login('reader',password),/capacity/);
 now+=1000;assert.throws(()=>security.authenticate(first.token),/unauthorized/);
 const next=await security.login('reader',password);now--;assert.throws(()=>security.authenticate(next.token),/unauthorized/);
 assert.throws(()=>new CloudSecurity({users}).authenticate(next.token),/unauthorized/);
});
test('incorrect passwords and unknown accounts share generic failure; parallel attempts bounded',async()=>{
 const security=new CloudSecurity({users});
 await assert.rejects(security.login('admin','incorrect'),/login_failed/);await assert.rejects(security.login('missing','incorrect'),/login_failed/);
 const results=await Promise.allSettled(Array.from({length:10},()=>security.login('admin','incorrect',{ip:'same'})));
 assert.ok(results.some(r=>r.reason?.message==='login_rate_limited'));assert.ok(results.every(r=>r.status==='rejected'));
});
