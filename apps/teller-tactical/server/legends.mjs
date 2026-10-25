import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const GIBS_COLORMAP_ROLE = 'http://earthdata.nasa.gov/gibs/metadata-type/colormap/1.3';
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'string' ? value : '';
const yes = value => value === true || value === 'true';
const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));
function label(value) {
  const result = text(value);
  if (result.length > 200) throw new Error('Provider legend label exceeds the supported length');
  return result;
}
function rgb(value) {
  if (typeof value !== 'string' || !/^\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*$/.test(value)) throw new Error('Provider legend has an invalid RGB color');
  const channels = value.split(',').map(Number);
  if (channels.some(channel => channel < 0 || channel > 255)) throw new Error('Provider legend color is outside RGB bounds');
  return channels;
}
const color = channels => `rgb(${channels.join(',')})`;

/** Parse only NASA's published ColorMap1.3 labels/units/colors. No color inversion. */
export function parseColorMapLegend(input) {
  const xml = Buffer.isBuffer(input) ? input.toString('utf8') : input;
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('Provider colormap must be bounded, well-formed XML without a DTD');
  const parsed = new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',removeNSPrefix:true,parseTagValue:false,processEntities:true}).parse(xml);
  const sourceMaps = list(parsed.ColorMaps?.ColorMap);
  if (!sourceMaps.length || sourceMaps.length > 8) throw new Error('Provider did not supply a supported ColorMap1.3 document');
  const maps = [];
  let budget = 0;
  for (const source of sourceMaps) {
    const rawEntries = list(source.Entries?.ColorMapEntry);
    budget += rawEntries.length;
    if (budget > 4096) throw new Error('Provider colormap exceeds its entry budget');
    const visible = rawEntries.filter(entry => !yes(entry['@_transparent']) && !yes(entry['@_nodata']));
    if (!visible.length) continue;
    const legend = source.Legend;
    const type = legend?.['@_type'];
    if (!['continuous','discrete','classification'].includes(type)) throw new Error('Provider colormap omitted a supported source legend');
    const rawLegend = list(legend.LegendEntry);
    budget += rawLegend.length;
    if (!rawLegend.length || budget > 4096) throw new Error('Provider legend entries are missing or exceed the entry budget');
    const entries = visible.map(entry => ({ref:label(entry['@_ref']),rgb:rgb(entry['@_rgb']),value:label(entry['@_value'])}));
    const referenced = new Set(entries.map(entry=>entry.ref));
    if (entries.some(entry=>!entry.ref)) throw new Error('Provider color entry omitted its legend reference');
    const ids = new Set();
    const labels = [];
    for (const entry of rawLegend) {
      const id = label(entry['@_id']);
      if (!referenced.has(id)) continue;
      if (!id || ids.has(id)) throw new Error('Provider legend identifiers are missing or duplicated');
      ids.add(id);
      const sourceLabel = label(entry['@_label']) || label(entry['@_tooltip']);
      labels.push({id,rgb:rgb(entry['@_rgb']),label:sourceLabel,showLabel:yes(entry['@_showLabel']),showTick:yes(entry['@_showTick'])});
    }
    if (!labels.length || entries.some(entry=>!ids.has(entry.ref))) throw new Error('Provider palette colors cannot be matched to their source legend');
    if (type==='classification' && (labels.length>16 || labels.some(entry=>!entry.label))) throw new Error('Provider categories cannot be represented by a compact labeled legend');
    maps.push({
      title:label(source['@_title']),units:label(source['@_units'])||null,type,entries,labels,
      minLabel:label(legend['@_minLabel']),maxLabel:label(legend['@_maxLabel']),
    });
  }
  if (!maps.length) throw new Error('Provider colormap has no visible quantitative or categorical entries');
  return {maps};
}

/** SVG contains only locally constructed geometry and escaped source text. */
export function renderColorMapLegend(xml, {title='Provider legend'}={}) {
  const {maps}=parseColorMapLegend(xml);
  const width=240,padding=10,barWidth=width-2*padding;
  const sections=maps.map(map=>map.type==='classification'?28+map.labels.length*20:70);
  const height=8+sections.reduce((a,b)=>a+b,0)+18;
  const svg=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title><rect width="${width}" height="${height}" rx="4" fill="#f8fafc"/>`];
  let y=8;
  for (const map of maps) {
    const heading=map.title||title;
    svg.push(`<text x="${padding}" y="${y+12}" font-family="sans-serif" font-size="12" fill="#142635">${escape(heading)}${map.units?' ('+escape(map.units)+')':''}</text>`);
    y+=22;
    if (map.type==='classification') {
      for(const entry of map.labels){
        svg.push(`<rect x="${padding}" y="${y}" width="14" height="14" fill="${color(entry.rgb)}"/><text x="${padding+21}" y="${y+11}" font-family="sans-serif" font-size="11" fill="#142635">${escape(entry.label)}</text>`);
        y+=20;
      }
      y+=6;
      continue;
    }
    const unitWidth=barWidth/map.entries.length;
    for(const [index,entry]of map.entries.entries())svg.push(`<rect x="${(padding+index*unitWidth).toFixed(4)}" y="${y}" width="${(unitWidth+0.01).toFixed(4)}" height="14" fill="${color(entry.rgb)}"/>`);
    svg.push(`<rect x="${padding}" y="${y}" width="${barWidth}" height="14" fill="none" stroke="#607488" stroke-width="0.5"/>`);
    const ticks=[];
    if(map.minLabel)ticks.push({position:0,text:map.minLabel});
    if(map.maxLabel)ticks.push({position:1,text:map.maxLabel});
    const sourceLabels=map.labels.filter(entry=>entry.label&&entry.showLabel);
    for(const entry of sourceLabels){
      const index=map.entries.findIndex(value=>value.ref===entry.id);
      // The source reference identifies this color cell. Position its label at
      // that cell's center, without treating palette index as a numeric scale.
      const position=(index+.5)/map.entries.length;
      if(!ticks.some(tick=>Math.abs(tick.position-position)<.01))ticks.push({position,text:entry.label});
    }
    if(!ticks.length){
      const supplied=map.labels.filter(entry=>entry.label);
      if(supplied.length){ticks.push({position:0,text:supplied[0].label});if(supplied.length>1)ticks.push({position:1,text:supplied.at(-1).label});}
    }
    // Use at most three of the provider's own labels; do not interpolate or
    // fabricate numeric ticks, units, spectral ranges or palette meanings.
    const sorted=ticks.sort((a,b)=>a.position-b.position);
    const shown=sorted.length<=3?sorted:[sorted[0],sorted[Math.floor((sorted.length-1)/2)],sorted.at(-1)];
    for(const tick of shown){const x=padding+tick.position*barWidth,anchor=tick.position<.1?'start':tick.position>.9?'end':'middle';svg.push(`<text x="${x.toFixed(4)}" y="${y+30}" text-anchor="${anchor}" font-family="sans-serif" font-size="11" fill="#142635">${escape(tick.text)}</text>`);}
    y+=48;
  }
  svg.push(`<text x="${padding}" y="${height-6}" font-family="sans-serif" font-size="9" fill="#596d80">Source colors and labels</text></svg>`);
  return {data:Buffer.from(svg.join('')),contentType:'image/svg+xml',maps};
}
