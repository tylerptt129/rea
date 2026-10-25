import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProductCatalog } from '../server/catalog.mjs';
import { WeatherClient } from '../server/http.mjs';
import { DiskCache } from '../server/cache.mjs';
import { GIBS_CAPABILITIES } from '../server/satellite.mjs';
import { GIBS_COLORMAP_ROLE } from '../server/legends.mjs';
import { startServer } from '../server/index.mjs';

const now=Date.parse('2026-10-25T12:00:00Z');
const source='https://gibs.earthdata.nasa.gov/colormaps/v1.3/source-advertised-test.xml';
const infrared='gibs-goes-east_abi_band13_clean_infrared';
const visible='gibs-goes-east_abi_band2_red_visible_1km';
// Deliberately synthetic source values; testing their preservation does not
// establish physical units for a real GOES browse layer.
const colormap=`<ColorMaps><ColorMap title="Source test legend" units="K"><Entries>
 <ColorMapEntry rgb="1,24,250" transparent="false" value="[180,220)" ref="low"/>
 <ColorMapEntry rgb="230,8,4" transparent="false" value="[220,300]" ref="high"/>
 </Entries><Legend type="continuous" minLabel="180" maxLabel="300">
 <LegendEntry rgb="1,24,250" id="low" label="180" tooltip="180 – 220" showLabel="true"/>
 <LegendEntry rgb="230,8,4" id="high" label="300" tooltip="220 – 300" showLabel="true"/>
 </Legend></ColorMap></ColorMaps>`;

function capabilities({role=GIBS_COLORMAP_ROLE,href=source,time='2026-10-25T11:10:00Z',includeVisible=true}={}){
 const layer=(id,title,metadata)=>`<Layer><ows:Title>${title}</ows:Title><ows:Identifier>${id}</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier></Style>${metadata}<Format>image/png</Format><Dimension><ows:Identifier>Time</ows:Identifier><Value>${time}</Value></Dimension><TileMatrixSetLink><TileMatrixSet>VerifiedMercator</TileMatrixSet></TileMatrixSetLink><ResourceURL format="image/png" resourceType="tile" template="https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png"/></Layer>`;
 const half=20037508.342789244,scale=2*half/(256*.00028);
 return `<Capabilities xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xlink="http://www.w3.org/1999/xlink"><Contents>${layer('GOES-East_ABI_Band13_Clean_Infrared','Clean Infrared',role?`<ows:Metadata xlink:role="${role}" xlink:href="${href}"/>`:'')}${includeVisible?layer('GOES-East_ABI_Band2_Red_Visible_1km','Red Visible',''):''}<TileMatrixSet><ows:Identifier>VerifiedMercator</ows:Identifier><ows:SupportedCRS>urn:ogc:def:crs:EPSG::3857</ows:SupportedCRS><TileMatrix><ows:Identifier>matrix-0</ows:Identifier><ScaleDenominator>${scale}</ScaleDenominator><TopLeftCorner>${-half} ${half}</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>1</MatrixWidth><MatrixHeight>1</MatrixHeight></TileMatrix></TileMatrixSet></Contents></Capabilities>`;
}

async function temporary(t){const directory=await mkdtemp(join(tmpdir(),'teller-colormap-catalog-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
function upstream({caps=capabilities(),legend=()=>colormap,calls=[]}={}){
 return async(url,options)=>{
  calls.push({url,options});
  if(url===GIBS_CAPABILITIES)return new Response(caps,{headers:{'content-type':'application/xml'}});
  if(new URL(url).pathname==='/json/radar')return new Response('{"scans":[]}',{headers:{'content-type':'application/json'}});
  if(url===source)return new Response(await legend(options),{headers:{'content-type':'application/xml'}});
  throw new Error(`Unexpected source request ${url}`);
 };
}

test('catalog renders only the advertised source colormap and keeps its remote descriptor private',async t=>{
 const calls=[],directory=await temporary(t);
 const client=new WeatherClient({directory,attempts:1,fetchImpl:upstream({calls})});t.after(()=>client.close());
 const catalog=new ProductCatalog(client,{now:()=>now});
 const snapshot=await catalog.get(),product=snapshot.products.find(p=>p.id===infrared),unlabelled=snapshot.products.find(p=>p.id===visible);
 assert.ok(product);assert.equal(product.legendUrl,`/api/legend/${infrared}`);assert.equal(unlabelled.legendUrl,undefined);
 assert.equal(product.units,null,'legend units do not make rendered pixels calibrated values');
 for(const key of ['legendRemote','colorMapRemote','wmts'])assert.equal(Object.hasOwn(product,key),false);
 assert.equal(catalog.products.get(infrared).colorMapRemote,source);
 const legend=await catalog.legend(infrared);
 assert.equal(legend.contentType,'image/svg+xml');assert.equal(legend.sourceUrl,source);assert.equal(legend.stale,false);
 assert.match(legend.data.toString(),/Source test legend \(K\)/);assert.match(legend.data.toString(),/fill="rgb\(1,24,250\)"/);assert.match(legend.data.toString(),/fill="rgb\(230,8,4\)"/);
 const requests=calls.filter(call=>call.url===source);assert.equal(requests.length,1);assert.equal(requests[0].options.redirect,'error');
 assert.ok(requests[0].options.signal instanceof AbortSignal);
 const cached=await client.cache.get(source);assert.equal(cached.category,'metadata');assert.equal(cached.contentType,'application/xml');assert.equal(cached.data.toString(),colormap);
 assert.equal(cached.expiresAt-cached.retrievedMs,86400_000);
 await catalog.legend(infrared);assert.equal(calls.filter(call=>call.url===source).length,1,'the source XML is cached; generated SVG is local');
 await assert.rejects(catalog.legend(visible),{status:404});assert.equal(calls.filter(call=>call.url===source).length,1,'missing metadata does not generate a source URL');
});

test('semantically invalid source colormaps retain last accepted stale XML and its original provenance',async t=>{
 const directory=await temporary(t),calls=[];let clock=now;
 const cache=new DiskCache(directory,{now:()=>clock});
 await cache.put(source,Buffer.from(colormap),{ttl:10,contentType:'application/xml',category:'metadata'});clock+=20;
 const client=new WeatherClient({cache,attempts:1,fetchImpl:upstream({calls,legend:()=>'<ColorMaps><ColorMap title="Incomplete"/></ColorMaps>'})});t.after(()=>client.close());
 const catalog=new ProductCatalog(client,{now:()=>now});await catalog.get();
 const legend=await catalog.legend(infrared);
 assert.equal(legend.stale,true);assert.equal(legend.retrievedAt,new Date(now).toISOString());assert.equal(legend.sourceUrl,source);
 assert.match(legend.data.toString(),/Source test legend/);assert.ok(!legend.data.includes(Buffer.from('Incomplete')));
 assert.equal((await cache.get(source,{allowStale:true})).data.toString(),colormap);
 assert.equal(client.stats.staleFallbacks,1);assert.equal(calls.filter(call=>call.url===source).length,1);
});

test('legacy well-formed but invalid colormap cache entries are evicted and fetched again',async t=>{
 const directory=await temporary(t),calls=[],cache=new DiskCache(directory);
 await cache.put(source,Buffer.from('<ColorMaps><ColorMap title="Poisoned"/></ColorMaps>'),{ttl:86400_000,contentType:'application/xml',category:'metadata'});
 const client=new WeatherClient({cache,attempts:1,fetchImpl:upstream({calls})});t.after(()=>client.close());
 const catalog=new ProductCatalog(client,{now:()=>now});await catalog.get();
 const legend=await catalog.legend(infrared);
 assert.equal(legend.stale,false);assert.match(legend.data.toString(),/Source test legend/);assert.equal(calls.filter(call=>call.url===source).length,1);
 assert.equal((await cache.get(source)).data.toString(),colormap);
});

test('catalog does not guess legend endpoints for absent, unrelated or unsafe advertised metadata',async t=>{
 for(const config of [{role:''},{role:GIBS_COLORMAP_ROLE.replace('/1.3','/1.0')},{href:'https://example.com/colormap.xml'},{href:'http://gibs.earthdata.nasa.gov/colormap.xml'}]){
  const calls=[],client=new WeatherClient({directory:await temporary(t),attempts:1,fetchImpl:upstream({calls,caps:capabilities(config)})});t.after(()=>client.close());
  const catalog=new ProductCatalog(client,{now:()=>now}),snapshot=await catalog.get();
  assert.equal(snapshot.products.find(product=>product.id===infrared).legendUrl,undefined);
  await assert.rejects(catalog.legend(infrared),{status:404});
  assert.ok(calls.every(call=>call.url===GIBS_CAPABILITIES||new URL(call.url).pathname==='/json/radar'));
 }
});

test('restored offline source colormap descriptors stay private and invalid remote destinations are rejected',async t=>{
 const directory=await temporary(t),statePath=join(directory,'catalog.json');
 const client=new WeatherClient({directory:join(directory,'cache'),attempts:1,fetchImpl:upstream()});t.after(()=>client.close());
 await new ProductCatalog(client,{now:()=>now,statePath}).get();
 const saved=JSON.parse(await readFile(statePath,'utf8'));assert.equal(saved.products.find(p=>p.id===infrared).colorMapRemote,source);
 const offline={json:async()=>{throw new Error('Offline radar');},bytes:async()=>{throw new Error('Offline metadata');}};
 const restored=await new ProductCatalog(offline,{now:()=>now+120_000,statePath}).get();
 const product=restored.products.find(p=>p.id===infrared);assert.equal(product.stale,true);assert.equal(product.legendUrl,`/api/legend/${infrared}`);assert.equal(Object.hasOwn(product,'colorMapRemote'),false);
 saved.products.find(p=>p.id===infrared).colorMapRemote='https://example.com/attack.xml';await writeFile(statePath,JSON.stringify(saved));
 const rejected=await new ProductCatalog(offline,{now:()=>now+120_000,statePath}).get();assert.equal(rejected.products.some(p=>p.id===infrared),false);
});

test('legend API serves validated SVG and original stale retrieval headers without requesting unadvertised legends',async t=>{
 const directory=await temporary(t),calls=[],clock=Date.now();
 const cache=new DiskCache(join(directory,'cache'),{now:()=>clock});
 await cache.put(source,Buffer.from(colormap),{ttl:-1,contentType:'application/xml',category:'metadata'});
 const recent=new Date(Math.floor((clock-50*60_000)/600_000)*600_000).toISOString();
 const client=new WeatherClient({cache,attempts:1,fetchImpl:upstream({calls,caps:capabilities({time:recent}),legend:()=>'<ColorMaps/>'})});
 const app=await startServer({dataDir:directory,fixture:false,client});t.after(()=>app.close());
 const snapshot=await fetch(`${app.url}/api/catalog`).then(response=>response.json());
 assert.equal(snapshot.products.find(p=>p.id===infrared).legendUrl,`/api/legend/${infrared}`);
 const response=await fetch(`${app.url}/api/legend/${infrared}`),svg=await response.text();
 assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/svg+xml');assert.equal(response.headers.get('content-length'),String(Buffer.byteLength(svg)));
 assert.equal(response.headers.get('x-teller-stale'),'true');assert.equal(response.headers.get('x-teller-retrieved-at'),new Date(clock).toISOString());assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
 assert.match(svg,/Source test legend \(K\)/);assert.match(svg,/fill="rgb\(1,24,250\)"/);
 const count=calls.length;
 for(const id of [visible,'unknown']){
  const absent=await fetch(`${app.url}/api/legend/${id}`);assert.equal(absent.status,404);assert.match(absent.headers.get('content-type'),/application\/json/);assert.match((await absent.json()).error,/unavailable/);
 }
 assert.equal(calls.length,count,'unavailable legend routes do not issue speculative source requests');
});

test('legend API rejects malformed source semantics without caching them and recovers on a valid response',async t=>{
 const directory=await temporary(t),calls=[];let valid=false;
 const recent=new Date(Math.floor((Date.now()-50*60_000)/600_000)*600_000).toISOString();
 const client=new WeatherClient({directory:join(directory,'cache'),attempts:2,fetchImpl:upstream({calls,caps:capabilities({time:recent}),legend:()=>valid?colormap:'<ColorMaps><ColorMap title="Invalid"/></ColorMaps>'})});
 const app=await startServer({dataDir:directory,fixture:false,client});t.after(()=>app.close());
 const rejected=await fetch(`${app.url}/api/legend/${infrared}`);
 assert.equal(rejected.status,502);assert.match(rejected.headers.get('content-type'),/application\/json/);assert.match((await rejected.json()).error,/no visible/);
 assert.equal(await client.cache.get(source,{allowStale:true}),null);assert.equal(calls.filter(call=>call.url===source).length,1,'semantically invalid source content is not retried immediately');
 valid=true;
 const accepted=await fetch(`${app.url}/api/legend/${infrared}`);
 assert.equal(accepted.status,200);assert.equal(accepted.headers.get('content-type'),'image/svg+xml');assert.equal(accepted.headers.get('x-teller-stale'),'false');assert.equal(accepted.headers.get('cache-control'),'public, max-age=3600');assert.match(await accepted.text(),/Source test legend/);
 assert.equal(calls.filter(call=>call.url===source).length,2);assert.equal((await client.cache.get(source)).data.toString(),colormap);
});
