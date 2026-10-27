// Build a location-free webOS app. A computer is only needed to build it;
// the person installing the resulting IPK configures everything on the TV.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const esbuild = require('esbuild');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const build = path.join(root, 'build');
const stage = path.join(build, 'lg-app');
const payload = path.join(stage, 'payload');
fs.rmSync(stage, {recursive:true, force:true});
fs.mkdirSync(payload, {recursive:true});
cp.execFileSync(process.execPath, [path.join(root, 'scripts/build-native-radar.cjs')], {cwd:root, stdio:'inherit'});

const bundled = esbuild.buildSync({entryPoints:[path.join(root,'native/vector-entry.js')], bundle:true,
  write:false, platform:'node', format:'cjs', target:'es2015', logLevel:'silent'}).outputFiles[0].text;
const converted = ts.transpileModule(bundled, {compilerOptions:{target:ts.ScriptTarget.ES5,module:ts.ModuleKind.CommonJS}}).outputText;
const polyfills = "if (!ArrayBuffer.isView) ArrayBuffer.isView=function(v){return v&&v.buffer instanceof ArrayBuffer;};\n";
fs.writeFileSync(path.join(payload,'vector-bundle.js'), polyfills + converted);

for (const name of ['setup.js','map-create.js','map-bounds.js','backend.js','map-render.js','radar.qml','install.js','boot.js','assets.js','legacy-guard.js']) {
  fs.copyFileSync(path.join(root,'native',name), path.join(payload,name));
}
fs.copyFileSync(path.join(build,'native/core.js'), path.join(payload,'core.js'));
fs.cpSync(path.join(root,'assets/flights'),path.join(payload,'assets'),{recursive:true});
fs.copyFileSync(path.join(root,'native/app/appinfo.json'),path.join(stage,'appinfo.json'));
fs.copyFileSync(path.join(root,'native/app/index.html'),path.join(stage,'index.html'));
fs.copyFileSync(path.join(root,'LICENSE'),path.join(stage,'LICENSE'));
for (const icon of ['icon80.png','icon130.png']) fs.copyFileSync(path.join(root,'assets/flights/aircraft.png'),path.join(stage,icon));

const ares = path.join(root,'node_modules','.bin',process.platform === 'win32' ? 'ares-package.cmd' : 'ares-package');
cp.execFileSync(ares,['--no-minify','--outdir',build,stage],{cwd:root,stdio:'inherit'});
console.log('LG app built without a preset location. Install the IPK, then open the app on the TV.');
