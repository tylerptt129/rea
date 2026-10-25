import { Worker } from 'node:worker_threads';
import { validatePoint } from '../src/domain.mjs';

const IEM = 'https://mesonet.agron.iastate.edu';
let nextOwner = 0;
const limitations = [
  'Quantized IEM provider composite, not raw single-site radar or a vertical reflectivity profile.',
  'Source mosaic time is nominal; contributing radar inputs may be up to15 minutes old.',
  'Terrain blockage, beam overshoot, attenuation, clutter processing and missing source coverage limit interpretation.',
  'Index0 has no quantitative value; it cannot establish no precipitation or distinguish missing coverage.',
];
const problem = (message, status = 400) => Object.assign(new Error(message), { status, retryable: false });
const abortReason = signal => signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Native radar probe cancelled'), { name: 'AbortError' });

/** World files list A,D,B,E,C,F; C/F are the upper-left pixel CENTER. */
export function parseWorldFile(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (!bytes.length || bytes.length > 4096) throw problem('Native radar worldfile is missing or exceeds its byte limit.');
  const lines = bytes.toString('utf8').trim().split(/\r?\n/).map(value => value.trim());
  if (lines.length !== 6 || lines.some(value => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(value))) throw problem('Native radar worldfile must contain exactly six finite affine coefficients.');
  const values = lines.map(Number);
  if (!values.every(Number.isFinite)) throw problem('Native radar worldfile contains a nonfinite coefficient.');
  const [a, d, b, e, c, f] = values, determinant = a * e - b * d;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-20 || c < -180 || c > 180 || f < -90 || f > 90) throw problem('Native radar worldfile is singular or outside EPSG:4326 coordinates.');
  return { a, d, b, e, c, f, determinant, projection: 'EPSG:4326' };
}
const position = (grid, column, row) => ({ longitude: grid.a * column + grid.b * row + grid.c, latitude: grid.d * column + grid.e * row + grid.f });

/** Nearest native-cell selection, with half-open outer pixel edges. */
export function nativeCell(grid, width, height, latitude, longitude) {
  validatePoint(latitude, longitude);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 70_000_000) throw problem('Native radar geometry is outside the supported resource budget.');
  const dx = longitude - grid.c, dy = latitude - grid.f;
  const col = (grid.e * dx - grid.b * dy) / grid.determinant;
  const line = (-grid.d * dx + grid.a * dy) / grid.determinant;
  if (!Number.isFinite(col) || !Number.isFinite(line)) throw problem('Selected point cannot be transformed into the source raster.');
  const index = coordinate => {
    const edge = coordinate + 0.5, integer = Math.round(edge);
    // Remove only floating arithmetic noise at an exact native-cell boundary.
    const pixel = Math.floor(Math.abs(edge - integer) < 1e-8 ? integer : edge);
    return pixel === 0 ? 0 : pixel;
  };
  const column = index(col), row = index(line);
  if (column < 0 || row < 0 || column >= width || row >= height) return null;
  const center = position(grid, column, row);
  const corners = [[column-.5,row-.5],[column+.5,row-.5],[column+.5,row+.5],[column-.5,row+.5]].map(([x,y])=>position(grid,x,y));
  return {
    column, row, width, height, center,
    bounds: { west: Math.min(...corners.map(p=>p.longitude)), east: Math.max(...corners.map(p=>p.longitude)), south: Math.min(...corners.map(p=>p.latitude)), north: Math.max(...corners.map(p=>p.latitude)) },
    corners,
    resolution: { projection: 'EPSG:4326', units: 'degrees', columnVector: [grid.a,grid.d], rowVector: [grid.b,grid.e] },
    sampling: 'nearest native pixel center; no spatial interpolation',
  };
}

export function nativeRadarUrls(frame, now = Date.now()) {
  if (!frame || !/^\d{12}$/.test(frame.id) || typeof frame.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/.test(frame.time)) throw problem('Select a source-advertised N0Q frame before probing.');
  const time = Date.parse(frame.time), date = new Date(time);
  if (!Number.isFinite(time) || time > now + 60_000 || date.getUTCMinutes() % 5 || date.getUTCSeconds() || date.getUTCMilliseconds()) throw problem('N0Q probes require an actual five-minute source mosaic timestamp.');
  const canonical = date.toISOString();
  if (canonical.slice(0,16) !== frame.time.slice(0,16) || canonical.replace(/[-:TZ.]/g,'').slice(0,12) !== frame.id) throw problem('Native radar frame identifier and timestamp disagree.');
  const base = `${IEM}/archive/data/${canonical.slice(0,4)}/${canonical.slice(5,7)}/${canonical.slice(8,10)}/GIS/uscomp/n0q_${frame.id}`;
  return { image: `${base}.png`, worldfile: `${base}.wld`, observationTime: canonical };
}

/** One worker and one retained native raster; cancellation terminates CPU work. */
class NativeWorker {
  constructor() { this.worker = null; this.stopping = null; this.queue = []; this.active = null; this.serial = 0; this.closed = false; }
  run(operation, payload, signal) {
    if (this.closed) return Promise.reject(new Error('Native radar probe is closed.'));
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.queue.length >= 3) return Promise.reject(new Error('Native radar decode queue is full; retry after the current request.'));
    return new Promise((resolve,reject) => {
      const job = { id: ++this.serial, operation, payload, signal, resolve, reject };
      job.abort = () => {
        if (this.active === job) {
          const worker = this.worker; this.worker = null; this.active = null;
          if(worker)this.stop(worker);
          this.finish(job, abortReason(signal)); this.pump();
        } else {
          this.queue = this.queue.filter(value=>value!==job);
          this.finish(job, abortReason(signal));
        }
      };
      signal?.addEventListener('abort',job.abort,{once:true});
      this.queue.push(job); this.pump();
    });
  }
  finish(job,error,value) {
    job.signal?.removeEventListener('abort',job.abort);
    if (error) job.reject(error); else job.resolve(value);
  }
  stop(worker) {
    const completion=worker.terminate().finally(()=>{if(this.stopping===completion)this.stopping=null;this.pump();});
    this.stopping=completion;return completion;
  }
  pump() {
    if (this.closed || this.stopping || this.active || !this.queue.length) return;
    if (!this.worker) {
      const worker = new Worker(new URL('./radar-probe-worker.mjs',import.meta.url),{resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16},execArgv:[]});
      this.worker=worker;
      worker.on('message',message=>{
        if (this.worker!==worker || !this.active || message.id!==this.active.id) return;
        const job=this.active; this.active=null;
        this.finish(job,message.error?Object.assign(new Error(message.error.message),{retryable:false}):null,message.value);
        this.pump();
      });
      worker.on('error',error=>{
        if (this.worker!==worker) return;
        this.worker=null;
        const job=this.active;this.active=null;if(job)this.finish(job,error);
        this.stop(worker);
      });
      worker.on('exit',code=>{
        if (this.worker!==worker) return;
        this.worker=null;
        const job=this.active;this.active=null;
        if(job)this.finish(job,new Error(`Native radar worker exited before completion (${code}).`));
        this.pump();
      });
    }
    const job=this.queue.shift();this.active=job;
    try { this.worker.postMessage({id:job.id,operation:job.operation,...job.payload}); }
    catch(error) { this.active=null;this.finish(job,error);this.pump(); }
  }
  async settle() { if(this.stopping)await this.stopping; }
  async close() {
    if(this.closed)return;this.closed=true;
    const error=new Error('Native radar probe closed.');
    if(this.active){this.finish(this.active,error);this.active=null;}
    for(const job of this.queue)this.finish(job,error);this.queue=[];
    const worker=this.worker;this.worker=null;if(worker)this.stop(worker);if(this.stopping)await this.stopping;
  }
}

export class NativeRadarProbe {
  constructor({client}={}) {
    if(!client || typeof client.bytes!=='function')throw new TypeError('NativeRadarProbe requires the bounded WeatherClient.');
    this.client=client;this.worker=new NativeWorker();this.owner=++nextOwner;this.operation=0;
    this.controller=new AbortController();this.busy=false;this.waiters=[];this.closed=false;
    this.worldAdmission={key:'iem-worldfile-v1',validate:data=>parseWorldFile(data)};
  }
  async acquire(signal) {
    signal.throwIfAborted();
    if(!this.busy){this.busy=true;return;}
    if(this.waiters.length>=2)throw new Error('Native radar probe is busy; retry after the current point request.');
    await new Promise((resolve,reject)=>{
      const entry={resolve:()=>{signal.removeEventListener('abort',abort);resolve();}};
      const abort=()=>{this.waiters=this.waiters.filter(value=>value!==entry);reject(abortReason(signal));};
      signal.addEventListener('abort',abort,{once:true});this.waiters.push(entry);
    });
  }
  release(){const next=this.waiters.shift();if(next)next.resolve();else this.busy=false;}
  async sample({frame,latitude,longitude,signal}={}) {
    validatePoint(latitude,longitude);
    const urls=nativeRadarUrls(frame);
    const operationController=new AbortController();
    const combined=AbortSignal.any([this.controller.signal,operationController.signal,AbortSignal.timeout(45_000),...(signal?[signal]:[])]);
    let acquired=false;const sources=[];
    const result={available:false,value:null,units:'dBZ',nativeIndex:null,sourceUrl:urls.image,worldfileUrl:urls.worldfile,retrievedAt:null,stale:null,cell:null,latitude,longitude,observationTime:urls.observationTime,quantizationDbz:0.5,limitations:[...limitations]};
    try{
      await this.acquire(combined);acquired=true;
      const admission={key:'iem-native-indexed-v1',owner:`${this.owner}:${++this.operation}`,validate:(data,contentType,{signal})=>this.worker.run('admit',{data,contentType},AbortSignal.any([combined,...(signal?[signal]:[])]))};
      sources.push(
        this.client.bytes(urls.image,{ttl:7*86400_000,maxBytes:8*1024*1024,category:'image',image:{profile:'iem-native-indexed'},admission,signal:combined}),
        this.client.bytes(urls.worldfile,{ttl:7*86400_000,maxBytes:4096,category:'metadata',admission:this.worldAdmission,signal:combined}),
      );
      const [raster,world]=await Promise.all(sources);
      combined.throwIfAborted();
      const facts=raster.admissionFact,grid=world.admissionFact;
      if(!facts || facts.mode!=='indexed8' || !grid)throw new Error('Native source validation did not provide accepted grid/index facts.');
      result.retrievedAt=raster.retrievedAt;result.worldfileRetrievedAt=world.retrievedAt;result.stale=raster.stale===true||world.stale===true;
      const cell=nativeCell(grid,facts.width,facts.height,latitude,longitude);
      result.cell=cell;
      if(!cell)return {...result,reason:'Selected point is outside this native IEM composite grid.'};
      const index=await this.worker.run('pixel',{token:facts.token,column:cell.column,row:cell.row},combined);
      result.nativeIndex=index;
      if(index===0)return {...result,reason:'The provider pixel has no quantitative value; missing coverage and no echo cannot be distinguished.'};
      return {...result,available:true,value:index*0.5-32.5,quality:'provider-composite quantized native index',timeSemantics:'nominal provider mosaic time'};
    }catch(error){
      if(combined.aborted)throw abortReason(combined);
      return {...result,reason:error.message.slice(0,500)};
    }finally{
      operationController.abort(new Error('Native radar sample completed.'));
      await Promise.allSettled(sources);
      await this.worker.settle();
      if(acquired)this.release();
    }
  }
  async close(){if(this.closed)return;this.closed=true;this.controller.abort(new Error('Native radar probe closed.'));await this.worker.close();}
}
