import crypto from 'node:crypto';
const key = () => { const raw = process.env.ENCRYPTION_KEY; if (!raw) throw new Error('ENCRYPTION_KEY is not configured'); const k = Buffer.from(raw, 'base64'); if (k.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes base64'); return k; };
export function encryptSecret(value:string){ const iv=crypto.randomBytes(12); const c=crypto.createCipheriv('aes-256-gcm',key(),iv); const encrypted=Buffer.concat([c.update(value,'utf8'),c.final()]); const tag=c.getAuthTag(); return [iv,tag,encrypted].map(x=>x.toString('base64')).join('.'); }
export function decryptSecret(payload:string){ const [ivB,tagB,dataB]=payload.split('.'); if(!ivB||!tagB||!dataB) throw new Error('Invalid secret'); const d=crypto.createDecipheriv('aes-256-gcm',key(),Buffer.from(ivB,'base64')); d.setAuthTag(Buffer.from(tagB,'base64')); return Buffer.concat([d.update(Buffer.from(dataB,'base64')),d.final()]).toString('utf8'); }
export function hashToken(token:string){ return crypto.createHash('sha256').update(token).digest('hex'); }
export function randomToken(){ return crypto.randomBytes(32).toString('hex'); }
