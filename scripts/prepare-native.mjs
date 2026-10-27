// Generate a self-contained TV payload from a user-supplied, untracked configuration.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
const file = process.argv[2];
if (!file) throw Error('Usage: npm run prepare:lg -- /absolute/path/to/settings.json');
const input = JSON.parse(fs.readFileSync(file, 'utf8'));
const loc = input.location || {}, lat = Number(loc.latitude), lon = Number(loc.longitude), radius = Number(input.radiusKm);
if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180 || !Number.isFinite(radius) || radius < 1 || radius > 50) throw Error('Invalid coordinates or radius (1–50 km)');
const config = {location:{name:String(loc.name || 'Area').slice(0,40),latitude:lat,longitude:lon},radiusKm:radius,language:input.language === 'en' ? 'en' : 'pt',units:input.units === 'aviation' ? 'aviation' : 'metric',theme:['classic','coast','lavender','sage','evangelion','noir'].includes(input.theme) ? input.theme : 'classic'};
const out = path.resolve('build/native'); fs.mkdirSync(out,{recursive:true});
execFileSync(process.execPath,['scripts/build-native-radar.cjs'],{stdio:'inherit'});
const metadata = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const template = metadata.tiles[0];
if (!/^https:\/\/tiles\.openfreemap\.org\/planet\/[a-z0-9_/-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/i.test(template)) throw Error('Invalid map source');
// Share the exact native camera coverage with the on-TV preparation path.
const {boundsFor} = await import('../native/map-bounds.js');
const plan = boundsFor(config, 100), z = plan.zoom, bounds = plan.bounds;
const jobs=[]; for(let x=bounds.x0;x<=bounds.x1;x++) for(let y=bounds.y0;y<=bounds.y1;y++) jobs.push({x,y});
function style(name,p,type){if(name==='water')return{fill:'#07333e'};if(name==='park')return{fill:'#1a2a29'};if(name==='landuse')return{fill:p.class==='residential'?'#151e22':'#1b282b'};if(name==='aeroway')return type===3?{fill:'#344247'}:{stroke:'#5a6c70',width:1.3};if(name==='transportation'){if(p.class==='path'||p.class==='track')return null;return{stroke:/^(motorway|trunk)$/.test(p.class)?'#b8beb0':/^(primary|secondary)$/.test(p.class)?'#939f98':'#506263',width:/^(motorway|trunk)$/.test(p.class)?1.6:.7};}return null;}
const shapes=[]; let completed=0;
async function worker(){while(jobs.length){const tile=jobs.shift(), count=2**z, x=((tile.x%count)+count)%count; const response=await fetch(template.replace('{z}',z).replace('{x}',x).replace('{y}',tile.y));if(!response.ok)throw Error('Map tile unavailable');const data=new VectorTile(new Pbf(new Uint8Array(await response.arrayBuffer()))), size=1200/count, ox=tile.x*size, oy=tile.y*size;
 for(const name of ['landuse','park','water','aeroway','transportation']){const layer=data.layers[name];if(!layer)continue;for(let n=0;n<layer.length;n++){const f=layer.feature(n), appearance=style(name,f.properties,f.type);if(!appearance)continue;const paths=f.loadGeometry().map(r=>r.map(p=>[+(ox+p.x/f.extent*size).toFixed(6),+(oy+p.y/f.extent*size).toFixed(6)]));let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; for(const ring of paths)for(const p of ring){x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1]);} if(!Number.isFinite(x0))continue; shapes.push({...appearance,polygon:f.type===3,paths,bounds:[x0,y0,x1,y1]});}}completed++;}}
await Promise.all([worker(),worker()]);
shapes.sort((a,b)=>Number(!!a.stroke)-Number(!!b.stroke));
const map={source:'OpenFreeMap / OpenStreetMap contributors',shapes};
fs.writeFileSync(path.join(out,'map.json'),JSON.stringify(map));
const compiled=shapes.map(f=>{const parts=[];let count=0;for(const ring of f.paths){count+=ring.length;ring.forEach((p,i)=>parts.push((i?'L':'M')+p[0]+' '+p[1]));if(f.polygon&&ring.length)parts.push('Z');}const {paths,...rest}=f;return {...rest,nativePath:parts.join(''),nativeVertices:count};});
fs.writeFileSync(path.join(out,'map-native.json'),JSON.stringify({...map,shapes:compiled}));
fs.writeFileSync(path.join(out,'config.json'),JSON.stringify(config),{mode:0o600});
for(const name of ['backend.js','map-render.js','radar.qml','install.js','boot.js','assets.js','legacy-guard.js'])fs.copyFileSync(path.join('native',name),path.join(out,name));
fs.cpSync('assets/flights',path.join(out,'assets'),{recursive:true});
console.log('Prepared native payload: '+completed+' map tiles, '+shapes.length+' features. Payload includes the selected coordinates; keep it private.');
