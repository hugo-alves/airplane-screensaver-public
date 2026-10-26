// Builds ES5 QML logic directly from the already-tested flight model.
const fs = require('fs'), path = require('path'), esbuild = require('esbuild');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'build/native');
fs.mkdirSync(out, {recursive:true});
let source = ['flight-aircraft-icons.js','flight-tracking.js','flight-camera.js'].map(name => fs.readFileSync(path.join(root,'src/js',name),'utf8')
  .replace(/^import .*;\n/gm,'').replace(/^export /gm,'').replace(/\b(const|let)\b/g,'var')).join('\n');
const polyfill = `function Map(){this.keys=[];this.values=[];}
Map.prototype.get=function(k){return this.values[this.keys.indexOf(k)];};
Map.prototype.set=function(k,v){var i=this.keys.indexOf(k);if(i<0){this.keys.push(k);this.values.push(v);}else this.values[i]=v;};
Map.prototype.delete=function(k){var i=this.keys.indexOf(k);if(i>=0){this.keys.splice(i,1);this.values.splice(i,1);}};
Map.prototype.forEach=function(f){var self=this;this.keys.slice().forEach(function(k){f(self.get(k),k);});};
Map.prototype.clear=function(){this.keys=[];this.values=[];};
if(!Array.prototype.find)Array.prototype.find=function(f){for(var i=0;i<this.length;i++)if(f(this[i],i))return this[i];};
if(!Object.assign)Object.assign=function(target){for(var n=1;n<arguments.length;n++){var s=arguments[n];for(var k in s)if(Object.prototype.hasOwnProperty.call(s,k))target[k]=s[k];}return target;};\n`;
const coreExports = ['altitudeDisposition','normalizeIcaoType','resolveAircraftIcon','distanceKm','normalizeFlightConfig','createFlightTracker','readAircraftFeed','selectAircraft','createFlightCamera','cameraPoint','projectFlight','projectFlightNear','aircraftMarkerScale'];
source = polyfill + source + '\nvar FlightCore={' + coreExports.map(n=>n+':'+n).join(',')+'};';
fs.writeFileSync(path.join(out,'core.js'), esbuild.transformSync(source,{target:'es5'}).code
  .replace(/^\(function\(\) \{\n/,'').replace(/\n\}\)\(\);\n?$/,''));
console.log('Built native ES5 flight core');
