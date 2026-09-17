import { NextResponse } from 'next/server'; import { listBots } from '../../../../lib/store';
export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;const b=listBots().find(x=>x.id===id);return b?NextResponse.json(b):NextResponse.json({error:'Bot not found'},{status:404})}
