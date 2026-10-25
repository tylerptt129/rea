import test from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parseColorMapLegend, renderColorMapLegend } from '../server/legends.mjs';

// Contract fixture follows NASA Worldview's processColormap.js and the
// ColorMap1.3 AERONET example; its abbreviated values are test data.
const map = `<ColorMaps><ColorMap title="Test temperature" units="K"><Entries>
 <ColorMapEntry rgb="0,0,0" transparent="true" nodata="true" ref="missing"/>
 <ColorMapEntry rgb="0,12,255" transparent="false" value="[180,200)" ref="cold"/>
 <ColorMapEntry rgb="44,96,8" transparent="false" value="[200,250)" ref="middle"/>
 <ColorMapEntry rgb="255,8,2" transparent="false" value="[250,300]" ref="warm"/>
 </Entries><Legend type="continuous" minLabel="180" maxLabel="300">
 <LegendEntry id="cold" rgb="0,12,255" tooltip="180 – 200" label="180" showLabel="true"/>
 <LegendEntry id="middle" rgb="44,96,8" tooltip="200 – 250" label="200" showLabel="true" showTick="true"/>
 <LegendEntry id="warm" rgb="255,8,2" tooltip="250 – 300" label="250" showLabel="true"/>
 </Legend></ColorMap></ColorMaps>`;

test('source colormap keeps exact RGB, original value text, references, labels and published units', () => {
 const {maps}=parseColorMapLegend(map), [parsed]=maps;
 assert.equal(maps.length,1);assert.equal(parsed.units,'K');assert.equal(parsed.title,'Test temperature');assert.equal(parsed.type,'continuous');
 assert.deepEqual(parsed.entries,[
  {ref:'cold',rgb:[0,12,255],value:'[180,200)'},
  {ref:'middle',rgb:[44,96,8],value:'[200,250)'},
  {ref:'warm',rgb:[255,8,2],value:'[250,300]'},
 ]);
 assert.deepEqual(parsed.labels.map(entry=>[entry.id,entry.label,entry.showLabel]),[['cold','180',true],['middle','200',true],['warm','250',true]]);
 assert.equal(parsed.minLabel,'180');assert.equal(parsed.maxLabel,'300');assert.equal(parsed.labels[1].showTick,true);
 const {data,contentType}=renderColorMapLegend(Buffer.from(map),{title:'Provider test'}),svg=data.toString();
 assert.equal(contentType,'image/svg+xml');assert.equal(XMLValidator.validate(svg),true);
 for(const rgb of ['rgb(0,12,255)','rgb(44,96,8)','rgb(255,8,2)'])assert.ok(svg.includes(`fill="${rgb}"`));
 assert.match(svg,/Test temperature \(K\)/);assert.ok(!svg.includes('rgb(0,0,0)'),'transparent nodata is not a measured palette value');
 assert.match(svg,/>180<\/text>/);assert.match(svg,/>300<\/text>/);
});

test('missing units stay unknown and categorical or tooltip labels come from the provider', () => {
 const categorical=`<ColorMaps><ColorMap title="Classification"><Entries><ColorMapEntry rgb="128,128,128" transparent="false" ref="0"/></Entries><Legend type="classification"><LegendEntry rgb="128,128,128" id="0" tooltip="Inactive Site" label="Inactive Site" showLabel="true"/></Legend></ColorMap></ColorMaps>`;
 const {maps}=parseColorMapLegend(categorical);assert.equal(maps[0].units,null);assert.equal(maps[0].labels[0].label,'Inactive Site');
 assert.match(renderColorMapLegend(categorical).data.toString(),/>Inactive Site<\/text>/);
 const tooltips=map.replace(/ label="[^"]*"/g,'').replace(' units="K"','');
 const rendered=renderColorMapLegend(tooltips);assert.equal(rendered.maps[0].units,null);
 assert.match(rendered.data.toString(),/>200 – 250<\/text>/);
 assert.ok(!rendered.data.toString().includes('Celsius'));assert.ok(!rendered.data.toString().includes('°'));
});

test('SVG escapes provider text and title, without remote or executable elements', () => {
 const unsafe=map.replace('Test temperature','&lt;script&gt;source&lt;/script&gt; &amp; quoted &quot;title&quot;').replace('units="K"','units="&lt;img src=x&gt;"');
 const svg=renderColorMapLegend(unsafe,{title:'" onload="bad" <script>bad</script>'}).data.toString();
 assert.equal(XMLValidator.validate(svg),true);
 const parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_'}).parse(svg);
 assert.equal(parsed.svg['@_aria-label'],'" onload="bad" <script>bad</script>');
 assert.ok(svg.includes('&lt;script&gt;source&lt;/script&gt; &amp; quoted &quot;title&quot;'));
 assert.ok(!/<(?:script|image|foreignObject)\b/.test(svg));
 const checkAttributes=node=>{
  if(!node||typeof node!=='object')return;
  for(const [key,value]of Object.entries(node)){
   assert.ok(!/^@_(?:on\w*|href|xlink:href)$/.test(key),`no executable or remote attribute ${key}`);
   checkAttributes(value);
  }
 };
 checkAttributes(parsed);
 assert.match(svg,/<rect[^>]*fill="#f8fafc"/,'opaque readable source legend background');
});

test('invalid or unbounded source XML never produces a plausible palette', () => {
 for(const xml of ['<ColorMaps><ColorMap>','<html/>','<!DOCTYPE ColorMaps [<!ENTITY unit "K">]>'+map,map.replace('rgb="0,12,255"','rgb="0,12,256"'),map.replace('rgb="0,12,255"','rgb="0,12,1);alert(1)"'),map.replace('ref="middle"','ref="unmatched"'),map.replace('type="continuous"','type="unknown"')])assert.throws(()=>parseColorMapLegend(xml));
 assert.throws(()=>parseColorMapLegend(map.replace('id="middle"','id="cold"')),/duplicated|matched/);
 assert.throws(()=>parseColorMapLegend(map.replace('Test temperature','a'.repeat(201))),/length/);
 assert.throws(()=>parseColorMapLegend(' '.repeat(1024*1024+1)),/bounded/);
 assert.throws(()=>parseColorMapLegend(`<ColorMaps>${map.slice(11,-12).repeat(9)}</ColorMaps>`),/supported ColorMap/);
 const excessive=map.replace('<Entries>','<Entries>'+ '<ColorMapEntry rgb="0,0,0" ref="missing" transparent="true"/>'.repeat(4097));
 assert.throws(()=>parseColorMapLegend(excessive),/entry budget/);
});

test('an all-transparent or unlabelled categorical source is unavailable', () => {
 assert.throws(()=>parseColorMapLegend(map.replaceAll('transparent="false"','transparent="true"')),/no visible/);
 const categorical=map.replace('type="continuous"','type="classification"').replace(/ (?:label|tooltip)="[^"]*"/g,'');
 assert.throws(()=>parseColorMapLegend(categorical),/compact labeled legend/);
});
