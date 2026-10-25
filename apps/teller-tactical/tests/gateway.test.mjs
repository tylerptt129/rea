import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { DiskCache } from '../server/cache.mjs';
import { WeatherClient, validateRemoteUrl } from '../server/http.mjs';
import { ProductCatalog, validFrames } from '../server/catalog.mjs';
import { startServer, validateTile } from '../server/index.mjs';

async function temporary(t) { const dir = await mkdtemp(join(tmpdir(), 'teller-gateway-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
const png = Buffer.from([137,80,78,71,13,10,26,10]);

test('cache preserves retrieval time, detects expiry, persists, and bounds bytes with LRU', async t => {
  const dir = await temporary(t); let now = 1000;
  const cache = new DiskCache(dir, { maxBytes: 10, now: () => now });
  await cache.put('a', Buffer.from('123456'), { ttl: 20, category: 'metadata' });
  assert.equal((await cache.get('a')).retrievedAt, new Date(1000).toISOString());
  now = 1030; assert.equal(await cache.get('a'), null); assert.equal((await cache.get('a', { allowStale: true })).stale, true);
  await cache.put('b', Buffer.from('789012'), { ttl: 20 });
  assert.equal(await cache.get('a', { allowStale: true }), null);
  assert.equal(cache.diagnostics().bytes, 6);
  const restored = new DiskCache(dir, { maxBytes: 10, now: () => now });
  assert.equal((await restored.get('b')).data.toString(), '789012');
});

test('metadata refresh expires current data without discarding last-known outage fallback', async t => {
  const cache = new DiskCache(await temporary(t));
  await cache.put('metadata', Buffer.from('{}'), { category: 'metadata' });
  await cache.put('tile', png, { category: 'image' });
  await cache.expireMetadata();
  assert.equal(await cache.get('metadata'), null);
  assert.equal((await cache.get('metadata', { allowStale: true })).stale, true);
  assert.ok(await cache.get('tile'));
});

test('remote network boundary rejects credentials, arbitrary hosts, insecure URLs, and ports', () => {
  for (const url of ['http://api.weather.gov/points/0,0','https://evil.example/','https://name:secret@api.weather.gov/','https://api.weather.gov:8443/','https://api.weather.gov/#x']) assert.throws(() => validateRemoteUrl(url));
  assert.equal(validateRemoteUrl('https://api.weather.gov/alerts/active').hostname, 'api.weather.gov');
  for (const tile of [[0,1,0],[-1,0,0],[15,0,0],[2,1.5,0],['2','2e0','1']]) assert.throws(() => validateTile(...tile));
  assert.deepEqual(validateTile('8','53','98'), [8,53,98]);
});

test('request deduplication and disk cache avoid duplicate source fetches', async t => {
  let calls = 0;
  const client = new WeatherClient({ directory: await temporary(t), fetchImpl: async () => { calls++; await new Promise(r => setTimeout(r,20)); return new Response('{"value":7}', { headers: { 'content-type': 'application/json' } }); } });
  t.after(() => client.close());
  const [a,b] = await Promise.all([client.json('https://api.weather.gov/test'), client.json('https://api.weather.gov/test')]);
  assert.equal(a.data.value,7); assert.equal(b.data.value,7); assert.equal(calls,1);
  await client.json('https://api.weather.gov/test'); assert.equal(calls,1);
});

test('interrupted source falls back to stale bytes with original retrieval time', async t => {
  const directory = await temporary(t); let now = 1000, offline = false;
  const cache = new DiskCache(directory, { now: () => now });
  const client = new WeatherClient({ cache, attempts: 1, fetchImpl: async () => { if (offline) throw new Error('Offline'); return new Response('{"real":true}', { headers: { 'content-type': 'application/json' } }); } });
  t.after(() => client.close());
  await client.json('https://api.weather.gov/fixture', { ttl: 10 });
  offline = true; now = 5000;
  const result = await client.json('https://api.weather.gov/fixture');
  assert.equal(result.stale,true); assert.equal(result.data.real,true); assert.equal(result.retrievedAt,new Date(1000).toISOString());
});

test('malformed input and oversized responses fail without entering the accepted cache', async t => {
  const client = new WeatherClient({ directory: await temporary(t), attempts: 1, fetchImpl: async () => new Response('not-json', { headers: { 'content-type': 'application/json' } }) });
  t.after(() => client.close());
  await assert.rejects(client.json('https://api.weather.gov/bad'), /Malformed JSON/);
  assert.equal(await client.cache.get('https://api.weather.gov/bad'),null);
  await assert.rejects(client.bytes('https://api.weather.gov/big',{ maxBytes: 2, category:'metadata' }), /byte limit/);
});

test('HTTP 403 is not retried, and source concurrency stays bounded', async t => {
  let active = 0, max = 0, calls = 0;
  const client = new WeatherClient({ directory: await temporary(t), maxConcurrent: 2, fetchImpl: async url => { calls++; if (url.endsWith('/denied')) return new Response('Denied',{status:403}); active++; max=Math.max(max,active); await new Promise(r=>setTimeout(r,10)); active--; return new Response('{}',{headers:{'content-type':'application/json'}}); } });
  t.after(()=>client.close());
  await assert.rejects(client.json('https://api.weather.gov/denied'), /HTTP 403/); assert.equal(calls,1);
  await Promise.all(Array.from({length:8},(_,i)=>client.json(`https://api.weather.gov/${i}`)));
  assert.equal(max,2);
});

test('consumer cancellation does not cancel a concurrent subscriber', async t => {
  const client = new WeatherClient({ directory: await temporary(t), fetchImpl: async () => { await new Promise(r=>setTimeout(r,25)); return new Response('{}',{headers:{'content-type':'application/json'}}); } });
  t.after(()=>client.close());
  const abort = new AbortController();
  const a=client.json('https://api.weather.gov/shared',{signal:abort.signal});
  const b=client.json('https://api.weather.gov/shared');
  setTimeout(()=>abort.abort(new Error('cancelled')),5);
  await assert.rejects(a,/cancelled/); assert.deepEqual((await b).data,{});
});

test('radar scan availability uses real listed times, rejects future/invalid/old scans, deduplicates', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const frames = validFrames([{ts:'2026-10-25T11:55Z'},{ts:'2026-10-25T11:55Z'},{ts:'invalid'},{ts:'2026-10-25T13:00Z'},{ts:'2026-10-24T12:00Z'}],now);
  assert.deepEqual(frames,[{id:'202610251155',time:'2026-10-25T11:55:00.000Z',verified:true}]);
});

test('catalog persists actual source times for explicitly stale offline startup', async t => {
  const statePath=join(await temporary(t),'last.json'); let now=Date.parse('2026-10-25T12:00:00Z');
  const client={json:async()=>({data:{scans:[{ts:'2026-10-25T11:55Z'}]},stale:false,retrievedAt:new Date(now).toISOString()})};
  const first=new ProductCatalog(client,{statePath,now:()=>now}); assert.equal((await first.get()).products[0].frames.length,1);
  now+=86400_000;
  const restored=new ProductCatalog({json:async()=>{throw new Error('Offline');}},{statePath,now:()=>now});
  const stale=await restored.get(); assert.equal(stale.stale,true); assert.equal(stale.products[0].stale,true); assert.equal(stale.products[0].frames[0].time,'2026-10-25T11:55:00.000Z');
});

test('fixture HTTP application serves georeferenced images, persistence and provenance without remote calls', async t => {
  const dir=await temporary(t), dist=join(dir,'dist'); await mkdir(dist); await writeFile(join(dist,'index.html'),'<html>Teller</html>');
  const instance=await startServer({fixture:true,dataDir:join(dir,'state'),distDir:dist}); t.after(()=>instance.close());
  const health=await fetch(`${instance.url}/api/health`).then(r=>r.json()); assert.equal(health.fixture,true);
  const catalog=await fetch(`${instance.url}/api/catalog`).then(r=>r.json()); assert.equal(catalog.fixture,true); assert.equal(catalog.products.length,4); assert.equal(catalog.products[0].frames[0].verified,false);
  const product=catalog.products[0], frame=product.frames[0];
  const tile=await fetch(`${instance.url}/api/tiles/${product.id}/${frame.id}/8/53/98.png`); assert.equal(tile.status,200); assert.equal(tile.headers.get('content-type'),'image/png'); assert.equal(tile.headers.get('x-teller-observation-time'),frame.time); assert.deepEqual(Buffer.from(await tile.arrayBuffer()).subarray(0,8),png);
  const saved=await fetch(`${instance.url}/api/settings`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({theme:'light',elevationFt:9200})}); assert.equal(saved.status,200); assert.equal(JSON.parse(await readFile(join(dir,'state','settings.json'),'utf8')).elevationFt,9200);
  assert.equal((await fetch(`${instance.url}/api/settings`).then(r=>r.json())).theme,'light');
  assert.equal((await fetch(`${instance.url}/api/point?lat=38.8&lon=-104.8`).then(r=>r.json())).fixture,true);
  const probe=await fetch(`${instance.url}/api/probe?lat=38&lon=-105`).then(r=>r.json()); assert.equal(probe.available,false); assert.equal(probe.value,null);
  assert.equal((await fetch(`${instance.url}/api/point?lat=&lon=`,{headers:{Origin:'http://evil.example'}})).status,403);
  for (const route of ['point', 'probe']) {
    for (const query of ['', '?lon=0', '?lat=&lon=', '?lat=%20%20&lon=-105', '?lat=38&lon=%09', '?lat=NaN&lon=0', '?lat=Infinity&lon=0', '?lat=91&lon=0', '?lat=0&lon=-181']) {
      const invalid = await fetch(`${instance.url}/api/${route}${query}`);
      assert.equal(invalid.status, 400, `${route}${query} must not invent a geographic point`);
      const failure = await invalid.json();
      assert.equal(typeof failure.error, 'string');
      assert.equal(Object.hasOwn(failure, 'latitude'), false);
    }
    const zero = await fetch(`${instance.url}/api/${route}?lat=0&lon=0`);
    assert.equal(zero.status, 200, 'An explicitly entered zero coordinate remains valid');
  }
  assert.equal((await fetch(`${instance.url}/api/tiles/nope/bad/1/0/0.png`)).status,404);
  const page=await fetch(instance.url); assert.match(page.headers.get('content-security-policy'),/default-src 'self'/); assert.match(await page.text(),/Teller/);
  const invalidHostStatus = await new Promise((resolve,reject) => { const r=httpRequest(`${instance.url}/api/health`,{headers:{Host:'evil.example'}},response=>{response.resume();resolve(response.statusCode);}); r.on('error',reject);r.end(); });
  assert.equal(invalidHostStatus,403);
});
