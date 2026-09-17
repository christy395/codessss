import { cookies } from 'next/headers';
import { db } from './db';
import { hashToken, randomToken } from './crypto';
const COOKIE='botvault_session';
export async function createSession(userId:string){ const raw=randomToken(); await db.session.create({data:{userId,tokenHash:hashToken(raw),expiresAt:new Date(Date.now()+1000*60*60*24*30)}}); (await cookies()).set(COOKIE,raw,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:60*60*24*30}); }
export async function destroySession(){ const raw=(await cookies()).get(COOKIE)?.value; if(raw) await db.session.deleteMany({where:{tokenHash:hashToken(raw)}}); (await cookies()).delete(COOKIE); }
export async function getUser(){ const raw=(await cookies()).get(COOKIE)?.value; if(!raw) return null; const s=await db.session.findUnique({where:{tokenHash:hashToken(raw)},include:{user:true}}); if(!s||s.expiresAt<new Date()){ if(s) await db.session.delete({where:{id:s.id}}); return null;} return s.user; }
export async function requireUser(){ const u=await getUser(); if(!u) throw new Error('UNAUTHORIZED'); return u; }
export async function requireAdmin(){ const u=await requireUser(); if(u.role!=='ADMIN') throw new Error('FORBIDDEN'); return u; }
