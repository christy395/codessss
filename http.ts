import { NextResponse } from 'next/server';
export function apiError(message:string,status=400){ return NextResponse.json({error:message},{status}); }
export function handleApiError(e:unknown){ const m=e instanceof Error?e.message:'Request failed'; if(m==='UNAUTHORIZED') return apiError('Unauthorized',401); if(m==='FORBIDDEN') return apiError('Forbidden',403); console.error(e); return apiError('Request failed',500); }
