const buckets=new Map<string,{count:number;reset:number}>();
export function rateLimit(key:string,limit=20,windowMs=60_000){ const now=Date.now(); const b=buckets.get(key); if(!b||b.reset<now){buckets.set(key,{count:1,reset:now+windowMs});return true;} if(b.count>=limit)return false; b.count++; return true; }
