import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.mjs';
import {WeatherClient} from '../server/http.mjs';

test('native probe route binds to actual product/frame catalog and closes its owned sampler',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'teller-probe-api-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const time=new Date(Math.floor(Date.now()/300000)*300000).toISOString(),frameId=time.replace(/[-:TZ.]/g,'').slice(0,12);
 const client=new WeatherClient({directory:join(directory,'bytes'),attempts:1,fetchImpl:async url=>url.includes('/json/radar')?new Response(JSON.stringify({scans:[{ts:time}]}),{headers:{'content-type':'application/json'}}):new Response('<Capabilities/>',{headers:{'content-type':'text/xml'}})});
 const calls=[];let closed=false;
 const native={sample:async input=>{calls.push(input);return {available:true,value:47.5,units:'dBZ',nativeIndex:160,quantizationDbz:0.5,observationTime:input.frame.time};},close:async()=>{closed=true;}};
 const app=await startServer({fixture:false,dataDir:directory,client,radarProbe:native});t.after(async()=>{if(!closed)await app.close();});
 let response=await fetch(`${app.url}/api/probe?lat=38.95&lon=-105.1&productId=iem-n0q&frameId=${frameId}`);assert.equal(response.status,200);
 const value=await response.json();assert.equal(value.fixture,false);assert.equal(value.value,47.5);assert.equal(value.observationTime,time);assert.equal(calls.length,1);assert.equal(calls[0].frame.id,frameId);assert.ok(calls[0].signal instanceof AbortSignal);
 response=await fetch(`${app.url}/api/probe?lat=38.95&lon=-105.1&productId=iem-n0q&frameId=unknown`);assert.equal(response.status,404);assert.equal(calls.length,1);
 response=await fetch(`${app.url}/api/probe?lat=38.95&lon=-105.1&productId=unsupported&frameId=${frameId}`);assert.equal((await response.json()).available,false);assert.equal(calls.length,1);
 await app.close();assert.equal(closed,true);
});

test('synthetic fixture numeric requests never masquerade as real provider samples',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'teller-probe-fixture-'));t.after(()=>rm(directory,{recursive:true,force:true}));let called=false;
 const app=await startServer({fixture:true,dataDir:directory,radarProbe:{sample:async()=>{called=true;throw new Error('Must not sample fixturecolors');},close:async()=>{}}});t.after(()=>app.close());
 const response=await fetch(`${app.url}/api/probe?lat=0&lon=0&productId=iem-n0q&frameId=202610250000`);const value=await response.json();assert.equal(value.available,false);assert.equal(value.fixture,true);assert.equal(called,false);assert.match(value.reason,/synthetic/i);
});
