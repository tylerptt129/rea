import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { NativeRadarProbe, parseWorldFile, nativeCell, nativeRadarUrls } from '../server/radar-probe.mjs';
import { WeatherClient } from '../server/http.mjs';
import { DiskCache } from '../server/cache.mjs';
import { validateImage } from '../server/images.mjs';

const frame={id:'202601151830',time:'2026-01-15T18:30:00.000Z'};
const world='0.01\n0\n0\n-0.01\n-105\n39\n';
function crc32(bytes){let n=0xffffffff;for(const b of bytes){n^=b;for(let i=0;i<8;i++)n=n&1?0xedb88320^n>>>1:n>>>1;}return(n^0xffffffff)>>>0;}
function chunk(name,body){const type=Buffer.from(name),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(body.length);tail.writeUInt32BE(crc32(Buffer.concat([type,body])));return Buffer.concat([head,type,body,tail]);}
function png(width,height,pixels,{rgb=false,filters=false}={}){
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=rgb?2:3;
 const channels=rgb?3:1,stride=width*channels,rows=Buffer.alloc((stride+1)*height);
 const paeth=(a,b,c)=>{const p=a+b-c,da=Math.abs(p-a),db=Math.abs(p-b),dc=Math.abs(p-c);return da<=db&&da<=dc?a:db<=dc?b:c;};
 for(let y=0;y<height;y++){
  const filter=filters?y%5:0;rows[y*(stride+1)]=filter;
  for(let x=0;x<stride;x++){
   const i=y*stride+x,v=pixels[i]??0,left=x>=channels?pixels[i-channels]??0:0,up=y?pixels[i-stride]??0:0,ul=y&&x>=channels?pixels[i-stride-channels]??0:0;
   const prediction=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,ul);
   rows[y*(stride+1)+x+1]=(v-prediction)&255;
  }
 }
 // Equal palette colors intentionally prove the numerical result uses original
 // indices, never visual/RGB reverse mapping.
 const palette=Buffer.alloc(256*3);for(let i=0;i<256;i++)palette.set([10,20,30],i*3);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),...(rgb?[]:[chunk('PLTE',palette)]),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
async function setup(t,{image=png(3,2,[1,65,255,0,66,3]),wld=world,fetchImpl,cacheNow}={}){
 const directory=await mkdtemp(join(tmpdir(),'teller-native-probe-'));
 const calls=[];
 const client=new WeatherClient({directory,...(cacheNow?{cache:new DiskCache(directory,{now:cacheNow})}:{}),attempts:1,fetchImpl:fetchImpl??(async(url,options)=>{calls.push(url);return new Response(url.endsWith('.png')?image:wld,{headers:{'content-type':url.endsWith('.png')?'image/png':'text/plain'}});})});
 const probe=new NativeRadarProbe({client});
 t.after(async()=>{await probe.close();await client.close();await rm(directory,{recursive:true,force:true});});
 return{probe,client,calls};
}

test('worldfile inverse uses original pixel centers, full affine rotation and half-open edges',()=>{
 const grid=parseWorldFile(Buffer.from(world));
 const first=nativeCell(grid,3,2,39,-105);assert.equal(first.column,0);assert.equal(first.row,0);assert.deepEqual(first.center,{longitude:-105,latitude:39});
 assert.ok(Math.abs(first.bounds.west-(-105.005))<1e-10);assert.ok(Math.abs(first.bounds.north-39.005)<1e-10);
 const edge=nativeCell(grid,3,2,39.005,-105.005);assert.equal(edge.column,0);assert.equal(edge.row,0);
 assert.equal(nativeCell(grid,3,2,38.985,-104.975),null,'outer south/east edges are excluded');
 assert.equal(nativeCell(grid,3,2,39.01,-105),null);assert.equal(nativeCell(grid,3,2,39,-104.97),null);
 const rotated=parseWorldFile(Buffer.from('0.01\n0.002\n0.001\n-0.01\n-105\n39'));
 const cell=nativeCell(rotated,10,10,39+0.002*3-0.01*4,-105+0.01*3+0.001*4);assert.equal(cell.column,3);assert.equal(cell.row,4);
 for(const bad of ['', '1\n2', '0\n0\n0\n0\n-105\n39', 'Infinity\n0\n0\n-1\n-105\n39','1\n0\n0\n-1\n-999\n39','1\n0\n0\n-1\n-105\n39\n7'])assert.throws(()=>parseWorldFile(Buffer.from(bad)));
});

test('archive URLs are derived only from a matching source mosaic identifier/time',()=>{
 const urls=nativeRadarUrls(frame);assert.equal(urls.image,'https://mesonet.agron.iastate.edu/archive/data/2026/01/15/GIS/uscomp/n0q_202601151830.png');assert.equal(urls.worldfile,urls.image.replace('.png','.wld'));
 for(const bad of [{id:'../../else',time:frame.time},{id:frame.id,time:'2026-01-15T18:31:00Z'},{id:frame.id,time:'invalid'},{id:'202602301830',time:'2026-02-30T18:30:00Z'}])assert.throws(()=>nativeRadarUrls(bad));
 assert.throws(()=>nativeRadarUrls({id:'209901010000',time:'2099-01-01T00:00:00Z'}));
});

test('native probe returns quantized source indices with original grid registration, not palette RGB values',async t=>{
 const{probe,calls}=await setup(t);
 const low=await probe.sample({frame,latitude:39,longitude:-105});assert.equal(low.available,true);assert.equal(low.nativeIndex,1);assert.equal(low.value,-32);assert.equal(low.units,'dBZ');assert.equal(low.quantizationDbz,.5);assert.equal(low.cell.column,0);assert.equal(low.cell.row,0);assert.equal(low.observationTime,frame.time);assert.ok(low.retrievedAt);
 const zero=await probe.sample({frame,latitude:39,longitude:-104.99});assert.equal(zero.nativeIndex,65);assert.equal(zero.value,0,'valid0dBZ differs from missing native index0');
 const high=await probe.sample({frame,latitude:39,longitude:-104.98});assert.equal(high.nativeIndex,255);assert.equal(high.value,95);
 assert.equal(calls.length,2,'subsequent points reuse validated immutable PNG/worldfile bytes');
 assert.ok(high.limitations.some(note=>note.includes('not raw single-site')));
});

test('native index0 and outside-grid points remain explicitly unavailable, never zero/clear weather',async t=>{
 const{probe}=await setup(t);
 const missing=await probe.sample({frame,latitude:38.99,longitude:-105});assert.equal(missing.available,false);assert.equal(missing.nativeIndex,0);assert.equal(missing.value,null);assert.match(missing.reason,/missing coverage and no echo cannot be distinguished/);
 const outside=await probe.sample({frame,latitude:40,longitude:-105});assert.equal(outside.available,false);assert.equal(outside.cell,null);assert.match(outside.reason,/outside/);
});

test('all PNG filter types are reversed in the worker before reading native indices',async t=>{
 const width=5,height=5,indices=Array.from({length:25},(_,i)=>i*7%256);
 const{probe}=await setup(t,{image:png(width,height,indices,{filters:true})});
 for(let row=0;row<height;row++)for(let column=0;column<width;column++){
  const result=await probe.sample({frame,latitude:39-row*.01,longitude:-105+column*.01});assert.equal(result.nativeIndex,indices[row*width+column]);
 }
});

test('100x100 RGB placeholders and normal rendered RGBA imagery cannot become numerical probes',async t=>{
 const{probe,client}=await setup(t,{image:png(100,100,Buffer.alloc(30000),{rgb:true})});
 const result=await probe.sample({frame,latitude:39,longitude:-105});assert.equal(result.available,false);assert.equal(result.value,null);assert.match(result.reason,/indexed PNG|RGB/);
 assert.equal(await client.cache.get(nativeRadarUrls(frame).image),null,'unsupported imagery is rejected before persistent admission');
});

test('large native data has an explicit worker-only resource profile; ordinary images retain their4MP bound',async t=>{
 const image=png(2100,2100,Buffer.alloc(2100*2100,65));
 assert.throws(()=>validateImage(image,'image/png'),/resource limits/);
 const{probe}=await setup(t,{image});
 const result=await probe.sample({frame,latitude:39,longitude:-105});assert.equal(result.available,true);assert.equal(result.value,0);assert.equal(result.cell.width,2100);
});

test('bad worldfile and oversized native geometry fail without caching rejected source data',async t=>{
 const first=await setup(t,{wld:'0\n0\n0\n0\n-105\n39'});
 const badWorld=await first.probe.sample({frame,latitude:39,longitude:-105});assert.equal(badWorld.available,false);assert.match(badWorld.reason,/singular/);assert.equal(await first.client.cache.get(nativeRadarUrls(frame).worldfile),null);
 const image=png(14001,1,[]);const second=await setup(t,{image});
 const tooWide=await second.probe.sample({frame,latitude:39,longitude:-105});assert.equal(tooWide.available,false);assert.match(tooWide.reason,/resource limits/);assert.equal(await second.client.cache.get(nativeRadarUrls(frame).image),null);
});

test('abort cancels active native decoding and close releases its worker without closing the shared source client',async t=>{
 const image=png(3000,3000,Buffer.alloc(9_000_000,65));const{probe,client}=await setup(t,{image});
 const controller=new AbortController();const pending=probe.sample({frame,latitude:39,longitude:-105,signal:controller.signal});
 const failed=assert.rejects(pending,/cancelled/);setTimeout(()=>controller.abort(new Error('cancelled by point selection')),5);await failed;
 await probe.close();assert.equal(probe.worker.worker,null);assert.equal(probe.worker.stopping,null);
 const response=await client.bytes('https://mesonet.agron.iastate.edu/another.wld',{category:'metadata'});assert.ok(response.data.length,'probeclose leaves the shared client usable');
 await assert.rejects(probe.sample({frame,latitude:39,longitude:-105}),/closed/);
});

test('native profile cannot bypass generic image validation without its explicit source validator',async t=>{
 const{client}=await setup(t);
 await assert.rejects(client.bytes(nativeRadarUrls(frame).image,{image:{profile:'iem-native-indexed'}}),/worker-backed source admission/);
});

test('native operation queue stays bounded and queued cancellation never starts another source fetch',async t=>{
 const entered=Promise.withResolvers(),gate=Promise.withResolvers();let calls=0;
 const image=png(3,2,[1,65,255,0,66,3]);
 const{probe}=await setup(t,{fetchImpl:async(url,{signal})=>{
  calls++;
  if(url.endsWith('.wld')){
   entered.resolve();await new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
    gate.promise.then(()=>{signal.removeEventListener('abort',abort);resolve();});
   });
  }
  return new Response(url.endsWith('.png')?image:world,{headers:{'content-type':url.endsWith('.png')?'image/png':'text/plain'}});
 }});
 const one=probe.sample({frame,latitude:39,longitude:-105});await entered.promise;
 const controller=new AbortController();
 const two=probe.sample({frame,latitude:39,longitude:-104.99,signal:controller.signal});const cancelled=assert.rejects(two,/queued cancellation/);
 const three=probe.sample({frame,latitude:39,longitude:-104.98});
 const overflow=await probe.sample({frame,latitude:39,longitude:-105});assert.equal(overflow.available,false);assert.match(overflow.reason,/busy/);assert.equal(probe.waiters.length,2);
 controller.abort(new Error('queued cancellation'));await cancelled;assert.equal(probe.waiters.length,1);
 gate.resolve();const results=await Promise.all([one,three]);assert.equal(results[0].nativeIndex,1);assert.equal(results[1].nativeIndex,255);assert.equal(calls,2);
 assert.equal(probe.busy,false);assert.equal(probe.waiters.length,0);assert.equal(probe.worker.active,null);
});

test('corrupt replacement native data keeps accepted stale indices and original retrieval metadata',async t=>{
 let now=Date.now(),corrupt=false;
 const valid=png(3,2,[1,65,255,0,66,3]);const broken=Buffer.from(valid);broken[broken.length-1]^=1;
 const{probe,client}=await setup(t,{cacheNow:()=>now,fetchImpl:async url=>new Response(url.endsWith('.png')?(corrupt?broken:valid):world,{headers:{'content-type':url.endsWith('.png')?'image/png':'text/plain'}})});
 const first=await probe.sample({frame,latitude:39,longitude:-104.99});assert.equal(first.available,true);
 const original=(await client.cache.get(nativeRadarUrls(frame).image)).retrievedAt;
 now+=8*86400_000;corrupt=true;
 const old=await probe.sample({frame,latitude:39,longitude:-104.99});assert.equal(old.available,true);assert.equal(old.value,0);assert.equal(old.stale,true);assert.equal(old.retrievedAt,original);
});

test('the documented12200x5400 native mosaic grid decodes in its worker and registers a Colorado point',async t=>{
 const width=12200,height=5400;
 const image=png(width,height,Buffer.alloc(width*height,65));
 const wld='0.005\n0\n0\n-0.005\n-125.9975\n49.9975';
 const{probe}=await setup(t,{image,wld});
 const result=await probe.sample({frame,latitude:38.8339,longitude:-104.8214});
 assert.equal(result.available,true);assert.equal(result.value,0);assert.equal(result.nativeIndex,65);assert.equal(result.cell.width,width);assert.equal(result.cell.height,height);
 assert.equal(result.cell.column,4235);assert.equal(result.cell.row,2233);
 assert.ok(Math.abs(result.cell.center.longitude-(-104.8225))<1e-9);assert.ok(Math.abs(result.cell.center.latitude-38.8325)<1e-9);
 assert.equal(probe.worker.active,null);assert.equal(probe.worker.queue.length,0);
});
