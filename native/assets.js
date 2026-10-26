// Copy only public display assets to the staged Glasshouse QML directory.
var fs=require('fs'),path=require('path');
function install(work,target){
 var src=path.join(work,'assets'),dest=path.join(target,'airplane-assets'),marker=path.join(dest,'.airplane-screensaver');
 if(fs.existsSync(dest)&&!fs.existsSync(marker))throw new Error('Display assets directory belongs to another installation');
 if(!fs.existsSync(dest)){fs.mkdirSync(dest,parseInt('755',8));fs.writeFileSync(marker,'airplane-screensaver\n',{mode:parseInt('644',8)});}
 fs.chmodSync(dest,parseInt('755',8));
 fs.readdirSync(src).forEach(function(name){
  if(!/^[a-zA-Z0-9_.-]+\.(png|ttf)$/.test(name))return;
  var input=path.join(src,name);if(!fs.statSync(input).isFile())return;
  var output=path.join(dest,name),tmp=output+'.new';
  fs.writeFileSync(tmp,fs.readFileSync(input),{mode:parseInt('644',8)});fs.chmodSync(tmp,parseInt('644',8));fs.renameSync(tmp,output);
 });
 fs.writeFileSync(marker,'airplane-screensaver\n',{mode:parseInt('644',8)});fs.chmodSync(marker,parseInt('644',8));
}
module.exports={install:install};
