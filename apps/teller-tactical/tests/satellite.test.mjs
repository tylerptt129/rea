import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseGibsCapabilities, observationFrames, webMercatorMatrices, satelliteTileUrl, safeGibsUrl, discoverSatellite, GIBS_CAPABILITIES, describeDomainsUrl, parseDescribeDomains, discoverDomainFrames } from '../server/satellite.mjs';
import { ProductCatalog } from '../server/catalog.mjs';
const now=Date.parse('2026-10-25T12:00:00Z');
const HALF=20037508.342789244;
const matrix=(z, overrides={})=>({Identifier:`matrix-${z}`,SupportedCRS:'urn:ogc:def:crs:EPSG::3857',ScaleDenominator:String(2*HALF/(256*2**z*0.00028)),TopLeftCorner:`${-HALF} ${HALF}`,TileWidth:'256',TileHeight:'256',MatrixWidth:String(2**z),MatrixHeight:String(2**z),...overrides});
function capabilities({time='2026-10-25T11:10:00Z,2026-10-25T11:20:00Z', crs='urn:ogc:def:crs:EPSG::3857',template='https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/GOES-East_ABI_Band13_Clean_Infrared/default/{Time}/{TileMatrixSet}/{TileMatrix}/{TileRow}/{TileCol}.png', id='GOES-East_ABI_Band13_Clean_Infrared', title='Clean Infrared',extraLayers=''}={}) {
 const xmlMatrix=z=>{const m=matrix(z);return `<TileMatrix><ows:Identifier>${m.Identifier}</ows:Identifier><ScaleDenominator>${m.ScaleDenominator}</ScaleDenominator><TopLeftCorner>${m.TopLeftCorner}</TopLeftCorner><TileWidth>256</TileWidth><TileHeight>256</TileHeight><MatrixWidth>${m.MatrixWidth}</MatrixWidth><MatrixHeight>${m.MatrixHeight}</MatrixHeight></TileMatrix>`};
 return `<?xml version="1.0"?><Capabilities xmlns:ows="http://www.opengis.net/ows/1.1"><Contents><Layer><ows:Title>${title}</ows:Title><ows:Identifier>${id}</ows:Identifier><Style isDefault="true"><ows:Identifier>default</ows:Identifier><LegendURL format="image/png" xlink:href="https://gibs.earthdata.nasa.gov/legends/test.png" /></Style><Format>image/png</Format><Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-10-25</Default><Current>true</Current><Value>${time}</Value></Dimension><TileMatrixSetLink><TileMatrixSet>VerifiedMercator</TileMatrixSet></TileMatrixSetLink><ResourceURL format="image/png" resourceType="tile" template="${template}" /></Layer>${extraLayers}<TileMatrixSet><ows:Identifier>VerifiedMercator</ows:Identifier><ows:SupportedCRS>${crs}</ows:SupportedCRS>${xmlMatrix(0)}${xmlMatrix(1)}</TileMatrixSet></Contents></Capabilities>`;
}

test('WMTS satellite parser verifies projection/matrix geometry and keeps source timing and latency',()=>{
 const result=parseGibsCapabilities(capabilities(),{now,retrievedAt:'2026-10-25T12:00:00Z'});
 assert.equal(result.products.length,1);assert.equal(result.errors.length,0);
 const product=result.products[0];assert.equal(product.projection,'EPSG:3857');assert.equal(product.maxZoom,1);assert.equal(product.expectedLatencyMinutes,40);assert.equal(product.deliveredResolutionKm,2);assert.equal(product.units,null);assert.equal(product.numericalProbe,false);assert.equal(product.frames.length,2);assert.equal(product.frames[1].time,'2026-10-25T11:20:00.000Z');assert.equal(product.frames[1].retrievedAt,'2026-10-25T12:00:00Z');
 assert.equal(product.legendRemote,'https://gibs.earthdata.nasa.gov/legends/test.png');
 const url=satelliteTileUrl(product,product.frames[1],1,1,0);assert.equal(new URL(url).hostname,'gibs.earthdata.nasa.gov');assert.match(decodeURIComponent(url),/\/VerifiedMercator\/matrix-1\/0\/1\.png$/);assert.match(decodeURIComponent(url),/2026-10-25T11:20:00.000Z/);
});

test('satellite temporal parser rejects nominal calendar/static/future/default-only availability',()=>{
 for(const value of ['2011-01-01/2026-12-31/PT10M','2026-10-25/2026-10-25/P1D','2026-01-01T00:00:00Z/2026-10-25T11:20:00Z/PT10M','2026-10-25T11:00:00Z/2026-10-25T12:10:00Z/PT10M']) assert.equal(observationFrames({Value:value,Default:'2026-10-25T11:20:00Z',Current:true},{now}).length,0);
 assert.equal(observationFrames({Default:'2026-10-25T11:20:00Z',Current:true},{now}).length,0);
 const interval=observationFrames({Value:'2026-10-25T10:00:00Z/2026-10-25T11:20:00Z/PT10M'},{now});assert.equal(interval.length,9);assert.equal(interval[8].availability,'source-published-bounded-10-minute-window');
 assert.equal(parseGibsCapabilities(capabilities({time:'2026-10-25/2026-10-25/P1D'}),{now}).products.length,0);
});

test('geographic or misregistered tile grids never masquerade as Web Mercator',()=>{
 assert.equal(parseGibsCapabilities(capabilities({crs:'urn:ogc:def:crs:EPSG::4326'}),{now}).products.length,0);
 for(const change of [{TileWidth:'512'},{TopLeftCorner:'-180 90'},{MatrixHeight:'2'},{ScaleDenominator:'100'}]) assert.equal(webMercatorMatrices({SupportedCRS:'EPSG:3857',TileMatrix:matrix(0,change)}),null);
 const sets=webMercatorMatrices({SupportedCRS:'http://www.opengis.net/def/crs/EPSG/0/3857',TileMatrix:[matrix(0),matrix(1)]});assert.equal(sets[1].id,'matrix-1');
});

test('satellite resources and legends cannot escape provider host or use unknown dimensions',()=>{
 for(const template of ['https://evil.example/{Time}/{TileMatrix}/{TileRow}/{TileCol}.png','http://gibs.earthdata.nasa.gov/{Time}/{TileMatrix}/{TileRow}/{TileCol}.png','https://gibs.earthdata.nasa.gov/{Elevation}/{Time}/{TileMatrix}/{TileRow}/{TileCol}.png']) assert.equal(parseGibsCapabilities(capabilities({template}),{now}).products.length,0);
 assert.throws(()=>safeGibsUrl('https://secret@gibs.earthdata.nasa.gov/legend.png'));
 assert.throws(()=>safeGibsUrl('https://gibs.earthdata.nasa.gov:8443/legend.png'));
 const product=parseGibsCapabilities(capabilities(),{now}).products[0];assert.throws(()=>satelliteTileUrl(product,product.frames[0],2,0,0),/zoom/);assert.throws(()=>satelliteTileUrl(product,product.frames[0],1,2,0),/coverage/);
});

test('visible channel is source-identified and water vapor is admitted only when explicit source metadata agrees',()=>{
 const visible=parseGibsCapabilities(capabilities({id:'GOES-East_ABI_Band2_Red_Visible_1km',title:'Red visible'}),{now}).products[0];assert.equal(visible.deliveredResolutionKm,1);assert.ok(visible.notes.some(n=>n.includes('daylight')));
 assert.equal(parseGibsCapabilities(capabilities({id:'GOES-East_ABI_Band9_Imagery',title:'Unknown channel'}),{now}).products.length,0);
 const vapor=parseGibsCapabilities(capabilities({id:'GOES-East_ABI_Band9_Mid_Level_Water_Vapor',title:'Water Vapor (ABI band9)'}),{now}).products[0];assert.equal(vapor.deliveredResolutionKm,null);assert.match(vapor.channel,/9/);
});

test('satellite discovery keeps exact catalog response provenance and requests metadata safely',async()=>{
 let observed;
 const result=await discoverSatellite({bytes:async(url,options)=>{observed={url,options};return {data:Buffer.from(capabilities()),retrievedAt:'2026-10-25T11:59:00Z',stale:true};}},{now});
 assert.equal(observed.url,GIBS_CAPABILITIES);assert.equal(observed.options.category,'metadata');assert.equal(result.products[0].stale,true);assert.equal(result.products[0].retrievedAt,'2026-10-25T11:59:00Z');
});

test('catalog integrates satellite pixels and authentic WMS legends without losing cached radar descriptors',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'teller-satellite-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let offline=false,current=now;const requests=[];
 const client={json:async()=>{if(offline)throw new Error('Offline radar');return{data:{scans:[{ts:'2026-10-25T11:55Z'}]},stale:false,retrievedAt:new Date(now).toISOString()};},bytes:async(url,options)=>{requests.push({url,options});if(url===GIBS_CAPABILITIES){if(offline)throw new Error('Offline satellite');return{data:Buffer.from(capabilities()),retrievedAt:new Date(now).toISOString(),stale:false};}return{data:Buffer.from('PNG'),contentType:'image/png',retrievedAt:new Date(now).toISOString(),stale:false};}};
 const catalog=new ProductCatalog(client,{statePath:join(directory,'catalog.json'),now:()=>current});
 const first=await catalog.get();assert.equal(first.products.length,2);const radar=first.products.find(p=>p.id==='iem-n0q');assert.equal(radar.range,undefined);assert.equal(radar.colors,undefined);assert.equal(radar.legendUrl,'/api/legend/iem-n0q');
 const satellite=first.products.find(p=>p.kind==='satellite');assert.equal(satellite.wmts,undefined);await catalog.tile(satellite.id,satellite.frames[0].id,1,0,0);assert.match(requests.at(-1).url,/gibs/);
 await catalog.legend('iem-n0q');assert.equal(new URL(requests.at(-1).url).searchParams.get('REQUEST'),'GetLegendGraphic');
 await catalog.legend(satellite.id);assert.equal(requests.at(-1).url,'https://gibs.earthdata.nasa.gov/legends/test.png');
 offline=true;current+=120_000;const stale=await catalog.get({force:true});assert.equal(stale.products.length,2);assert.equal(stale.products.every(p=>p.stale),true);
 await catalog.tile('iem-n0q',radar.frames[0].id,0,0,0);assert.equal(new URL(requests.at(-1).url).searchParams.get('LAYERS'),'nexrad-n0q-wmst');
 const restored=new ProductCatalog(client,{statePath:join(directory,'catalog.json'),now:()=>current});const snapshot=await restored.get();assert.equal(snapshot.products.length,2);assert.equal(snapshot.stale,true);
});

const domains = (value, next = '') => `<?xml version="1.0"?><Domains><DimensionDomain><Domain>${value}</Domain>${next ? `<NextPage>${next}</NextPage>` : ''}</DimensionDomain></Domains>`;
const layerId = 'GOES-East_ABI_Band13_Clean_Infrared';

test('actual DescribeDomains ranges establish source-anchored subdaily times without using a nominal calendar', () => {
 const start=Date.parse('2026-10-25T09:00:00Z'),end=Date.parse('2026-10-25T12:00:00Z');
 const parsed=parseDescribeDomains(domains('2026-10-25T10:00:00Z/2026-10-25T10:20:00Z/PT10M,2026-10-25T11:00:00Z/2026-10-25T11:00:00Z/PT10M'),{start,end,now});
 assert.deepEqual(parsed.frames.map(f=>f.time),['2026-10-25T10:00:00.000Z','2026-10-25T10:10:00.000Z','2026-10-25T10:20:00.000Z','2026-10-25T11:00:00.000Z']);
 assert.equal(parsed.frames.some(f=>f.time.includes('10:30')),false,'source gaps are not filled');
 assert.equal(parsed.frames.every(f=>f.verified&&f.availability==='provider-described-observation-times'),true);
 const broad='2026-07-01T00:00:00Z/2026-10-25T11:20:00Z/PT10M';
 assert.equal(observationFrames({Value:broad},{now}).length,0,'nominal broad capabilities never authenticate availability');
 const described=parseDescribeDomains(domains(broad),{start,end,now});
 assert.equal(described.frames.length,15,'the actual provider-described range is clipped to requested observations');
 assert.equal(described.frames.at(-1).time,'2026-10-25T11:20:00.000Z');
});

test('DescribeDomains rejects malformed/non-subdaily/future metadata rather than fabricating latest frames', () => {
 const options={start:now-4*3600_000,end:now,now};
 assert.throws(()=>parseDescribeDomains('<Domains><DimensionDomain>',options),/malformed XML/);
 assert.throws(()=>parseDescribeDomains('<Capabilities/>',options),/DescribeDomains/);
 for(const input of ['2026-01-01/2026-10-25/P1D','2026-10-25T11:00:00Z/2026-10-25T12:10:00Z/PT10M','2026-02-30T11:00:00Z','invalid','2026-10-25T11:00:00Z/2026-10-25T11:20:00Z/PT0S']) assert.equal(parseDescribeDomains(domains(input),options).frames.length,0,input);
 const singleton=parseDescribeDomains(domains('2026-10-25T11:20:00Z/2026-10-25T11:20:00Z/PT10M'),options);
 assert.equal(singleton.frames.length,1,'a single source granule does not imply another frame at plus one cadence');
});

test('satellite discovery uses bounded official DescribeDomains when WMTS only advertises a calendar', async () => {
 const requests=[];
 const calendar=capabilities({time:'2026-07-01/2026-10-25/P1D'});
 const result=await discoverSatellite({bytes:async(url,options)=>{
  requests.push({url,options});
  return {data:Buffer.from(url===GIBS_CAPABILITIES?calendar:domains('2026-10-25T11:10:00Z/2026-10-25T11:20:00Z/PT10M')),retrievedAt:url===GIBS_CAPABILITIES?'2026-10-25T11:59:00Z':'2026-10-25T12:00:00Z',stale:false};
 }},{now});
 assert.equal(requests.length,2);
 assert.equal(requests[1].url,`https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/${layerId}/default/250m/all/2026-10-25T08:00:00Z--2026-10-25T12:00:00Z.xml`);
 assert.equal(requests[1].options.category,'metadata');assert.equal(requests[1].options.maxBytes,2*1024*1024);
 assert.equal(result.products.length,1);assert.equal(result.products[0].frames.length,2);assert.equal(result.products[0].frames[1].retrievedAt,'2026-10-25T12:00:00Z');
 assert.equal(result.products[0].projection,'EPSG:3857','geographic time metadata never changes the verified pixel projection');
 assert.equal(result.products[0].temporalMetadataUrl,requests[1].url);
 const unsupported=await discoverSatellite({bytes:async(url)=>({data:Buffer.from(url===GIBS_CAPABILITIES?capabilities({time:'2026-07-01/2026-10-25/P1D',crs:'EPSG:4326'}):domains('2026-10-25T11:20:00Z')),stale:false})},{now});
 assert.equal(unsupported.products.length,0,'real timestamps cannot authorize an unsupported geographic pixel grid');
});

test('time-domain paging is bounded, same-provider and same-layer, and retains actual missing scans', async () => {
 const end=now,start=now-4*3600_000,first=describeDomainsUrl(layerId,{start,end}),next=first+'?page=2';
 let calls=0;
 await assert.rejects(discoverDomainFrames({bytes:async()=>{calls++;}},'../../other-layer',{now}),/Invalid bounded/);
 assert.equal(calls,0,'invalid layer identifiers cannot initiate metadata requests');
 const paged=await discoverDomainFrames({bytes:async(url)=>({data:Buffer.from(url===first?domains('2026-10-25T11:00:00Z',next):domains('2026-10-25T11:20:00Z')),retrievedAt:new Date(now).toISOString(),stale:url!==first})},layerId,{now});
 assert.deepEqual(paged.frames.map(f=>f.time),['2026-10-25T11:00:00.000Z','2026-10-25T11:20:00.000Z']);assert.equal(paged.stale,true);
 for(const link of ['https://evil.example/metadata.xml',first.replace(layerId,'OTHER_LAYER')]) await assert.rejects(discoverDomainFrames({bytes:async()=>({data:Buffer.from(domains('2026-10-25T11:00:00Z',link)),stale:false})},layerId,{now}),/provider host|changed layer/);
 await assert.rejects(discoverDomainFrames({bytes:async()=>({data:Buffer.from(domains('2026-10-25T11:00:00Z',first)),stale:false})},layerId,{now}),/repeated a page/);
 let pages=0;await assert.rejects(discoverDomainFrames({bytes:async()=>({data:Buffer.from(domains('2026-10-25T11:00:00Z',first+`?page=${++pages}`)),stale:false})},layerId,{now}),/four-page budget/);assert.equal(pages,4);
});

test('unavailable observation metadata keeps satellite unavailable without converting retrieval time to observation time', async () => {
 const output=await discoverSatellite({bytes:async(url)=>{if(url!==GIBS_CAPABILITIES)throw new Error('Source offline');return {data:Buffer.from(capabilities({time:'2026-07-01/2026-10-25/P1D'})),stale:false,retrievedAt:new Date(now).toISOString()};}},{now});
 assert.equal(output.products.length,0);assert.match(output.errors[0].message,/Actual subdaily availability metadata.*Source offline/);
});
