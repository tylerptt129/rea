import test from 'node:test';
import assert from 'node:assert/strict';
import { requireNativeLiveSnapshot } from '../scripts/packaged-live-smoke.mjs';

function currentSnapshot() {
  const now=Date.now(), iso=delta=>new Date(now+delta).toISOString();
  const frames=[{id:'a',time:iso(-10*60000),verified:true},{id:'b',time:iso(-5*60000),verified:true}];
  return { fixture:false, catalog:{fixture:false,stale:false,products:[
    {id:'iem-n0q',kind:'radar',sourceUrl:'https://mesonet.agron.iastate.edu/docs/nexrad_mosaic/',frames,stale:false},
    ...['GOES-East_ABI_Band13_Clean_Infrared','GOES-East_ABI_Band2_Red_Visible_1km'].map(sourceProductId=>({id:sourceProductId,sourceProductId,kind:'satellite',frames,stale:false,expectedLatencyMinutes:40,cadenceMinutes:10}))
  ]}, weather:{fixture:false,stale:false,periods:[{startTime:iso(0),endTime:iso(3600000)}],observations:[{timestamp:iso(-600000),sourceUrl:'https://api.weather.gov/stations/KCOS/observations/latest',stale:false}],alerts:[],alertStatus:{},sources:[{name:'alerts',sourceUrl:'https://api.weather.gov/alerts/active',retrievedAt:iso(0),stale:false}]}, displayed:{frameId:'b',time:iso(-300000),loaded:true,missingTiles:0},canvas:{width:1000,height:700},frameLabel:'Verified displayed time' };
}

test('native live gate requires a complete non-fixture rendered public-data workflow',()=>{assert.equal(requireNativeLiveSnapshot(currentSnapshot()).product.id,'iem-n0q');});
test('native live gate rejects fixture, stale, absent or partial raster snapshots',()=>{for(const mutation of [s=>s.fixture=true,s=>s.catalog.stale=true,s=>s.displayed=null,s=>s.displayed.missingTiles=1,s=>s.displayed.loaded=false,s=>s.frameLabel='No frame displayed']){const s=currentSnapshot();mutation(s);assert.throws(()=>requireNativeLiveSnapshot(s));}});
test('real radar alone cannot masquerade as a complete satellite workstation',()=>{const s=currentSnapshot();s.catalog.products=s.catalog.products.filter(p=>p.kind==='radar');assert.throws(()=>requireNativeLiveSnapshot(s),/satellite|GOES/);});
test('old observations and expired forecast periods cannot pass native readiness',()=>{const s=currentSnapshot();s.weather.observations[0].timestamp=new Date(Date.now()-4*3600000).toISOString();assert.throws(()=>requireNativeLiveSnapshot(s),/three-hour/);const t=currentSnapshot();t.weather.periods[0].endTime=new Date(Date.now()-60000).toISOString();t.weather.periods[0].startTime=new Date(Date.now()-3600000).toISOString();assert.throws(()=>requireNativeLiveSnapshot(t),/expired/);});
test('missing official alert response cannot be treated as an all-clear',()=>{const s=currentSnapshot();s.weather.sources=[];assert.throws(()=>requireNativeLiveSnapshot(s),/alerts request|alert/i);});
