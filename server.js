import express from 'express';
import Docker from 'dockerode';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {jwtVerify} from 'jose';

const app=express(); app.use(express.json({limit:'2mb'}));
const server=createServer(app); const wss=new WebSocketServer({noServer:true});
const docker=new Docker({socketPath:process.env.DOCKER_SOCKET||'/var/run/docker.sock'});
const TOKEN=process.env.NODE_AGENT_TOKEN; const INTERNAL=process.env.INTERNAL_API_TOKEN; const DATA_ROOT=process.env.BOT_DATA_ROOT||'/var/lib/botvault/bots';
const CONTROL=process.env.CONTROL_PLANE_URL; const JWT_SECRET=Buffer.from(process.env.WS_SECRET||'', 'utf8');
const s3=process.env.S3_BUCKET?new S3Client({region:process.env.S3_REGION||'auto',endpoint:process.env.S3_ENDPOINT||undefined,forcePathStyle:process.env.S3_FORCE_PATH_STYLE==='true',credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID||'',secretAccessKey:process.env.S3_SECRET_ACCESS_KEY||''}}):null;
function auth(req,res,next){if(!TOKEN||req.header('authorization')!==`Bearer ${TOKEN}`)return res.status(401).json({error:'Unauthorized'});next()}
function safe(p){const x=p.replaceAll('\\','/').replace(/^\/+/, '');if(!x||x.includes('..')||x.split('/').some(s=>!s||s==='.'||s==='..'))throw new Error('Invalid path');return x}
async function logRemote(botId,level,message){try{if(CONTROL&&INTERNAL)await fetch(`${CONTROL}/api/internal/logs`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${INTERNAL}`},body:JSON.stringify({botId,level,message})})}catch{}}
async function download(key,dest){if(!s3)throw new Error('S3 not configured on node');const o=await s3.send(new GetObjectCommand({Bucket:process.env.S3_BUCKET,Key:key}));await fs.mkdir(path.dirname(dest),{recursive:true});const buf=Buffer.from(await o.Body.transformToByteArray());await fs.writeFile(dest,buf)}
async function findContainer(id){return docker.getContainer(id)}
app.get('/health',async(_req,res)=>{try{await docker.info();res.json({status:'online',node:process.env.NODE_NAME||'node'});}catch{res.status(503).json({status:'offline'})}});
app.post('/bots/provision',auth,async(req,res)=>{try{const {botId,runtime,startupCommand,files=[],env={}}=req.body;if(!botId||!['Node.js','Python'].includes(runtime))return res.status(400).json({error:'Invalid provision request'});const dir=path.join(DATA_ROOT,crypto.createHash('sha256').update(botId).digest('hex'));await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir,{recursive:true});for(const f of files){const rel=safe(f.path);await download(f.storageKey,path.join(dir,rel));}
const image=runtime==='Node.js'?'node:22-alpine':'python:3.12-alpine';const cmd=runtime==='Node.js'?`npm install --omit=dev && ${startupCommand||'node index.js'}`:`pip install --no-cache-dir -r requirements.txt && ${startupCommand||'python main.py'}`;
try{await docker.getImage(image).inspect()}catch{await new Promise((resolve,reject)=>docker.pull(image,(err,stream)=>err?reject(err):docker.modem.followProgress(stream,err=>err?reject(err):resolve())))}
const old=(await docker.listContainers({all:true,filters:{label:[`com.botvault.botId=${botId}`]}}))[0]; if(old){try{await docker.getContainer(old.Id).remove({force:true})}catch{}} const c=await docker.createContainer({name:`botvault-${botId}`,Image:image,WorkingDir:'/app',Cmd:['sh','-lc',cmd],Env:Object.entries(env).map(([k,v])=>`${k}=${v}`),HostConfig:{Binds:[`${dir}:/app:rw`],Memory:parseInt(process.env.DEFAULT_MEMORY_MB||'512')*1024*1024,NanoCpus:parseInt(process.env.DEFAULT_CPU_MILLICORES||'500')*1e6,PidsLimit:256,NetworkMode:'bridge',SecurityOpt:['no-new-privileges:true'],CapDrop:['ALL'],ReadonlyRootfs:false,AutoRemove:false},Labels:{'com.botvault.botId':botId}});await c.start();await logRemote(botId,'info','Container provisioned and started');res.json({containerId:c.id,status:'online'});}catch(e){console.error(e);res.status(500).json({error:'Provisioning failed'});}});
for(const a of ['start','stop','restart'])app.post('/containers/:id/'+a,auth,async(req,res)=>{try{const c=await findContainer(req.params.id);if(a==='start')await c.start();if(a==='stop')await c.stop({t:10});if(a==='restart')await c.restart({t:10});res.json({status:a==='stop'?'offline':'online'});}catch(e){res.status(500).json({error:`Container ${a} failed`})}});
app.delete('/containers/:id',auth,async(req,res)=>{try{const c=await findContainer(req.params.id);try{await c.stop({t:5})}catch{}await c.remove({force:true});res.json({ok:true})}catch{res.status(404).json({error:'Container not found'})}});
app.get('/containers/:id/stats',auth,async(req,res)=>{try{const c=await findContainer(req.params.id);const s=await c.stats({stream:false});res.json(s)}catch{res.status(404).json({error:'Container not found'})}});
server.on('upgrade',async(req,socket,head)=>{try{const u=new URL(req.url,'http://localhost');if(u.pathname!=='/ws'){socket.destroy();return}if(!JWT_SECRET.length)throw new Error('WS_SECRET missing');const token=u.searchParams.get('token');const {payload}=await jwtVerify(token,JWT_SECRET);if(!payload.botId)throw new Error('Invalid token');wss.handleUpgrade(req,socket,head,ws=>{ws.botId=String(payload.botId);wss.emit('connection',ws)})}catch{socket.destroy()}});
wss.on('connection',async ws=>{try{const id=ws.botId;const list=await docker.listContainers({all:true,filters:{label:[`com.botvault.botId=${id}`]}});if(!list[0]){ws.close();return}const c=docker.getContainer(list[0].Id);ws.send(JSON.stringify({type:'ready',botId:id}));const stream=await c.logs({follow:true,stdout:true,stderr:true,timestamps:true});stream.on('data',chunk=>{const message=chunk.toString('utf8');ws.send(JSON.stringify({type:'log',message}));logRemote(id,'info',message).catch(()=>{})});stream.on('error',()=>ws.close());ws.on('close',()=>stream.destroy());}catch{ws.close()}});
server.listen(process.env.PORT||4001,()=>console.log(`BotVault node agent listening on ${process.env.PORT||4001}`));
