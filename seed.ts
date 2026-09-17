import { PrismaClient } from '@prisma/client';
const db=new PrismaClient();
async function main(){ for(const p of [{name:'Starter',uniqueKey:'starter',priceCents:0,bots:1,ramMb:512,storageMb:512},{name:'Pro',uniqueKey:'pro',priceCents:500,bots:5,ramMb:2048,storageMb:5120},{name:'Enterprise',uniqueKey:'enterprise',priceCents:0,bots:50,ramMb:16384,storageMb:51200}]) await db.plan.upsert({where:{uniqueKey:p.uniqueKey},update:p,create:p}); }
main().finally(()=>db.$disconnect());
