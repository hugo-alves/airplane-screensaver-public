// Plan tiles in the same Web Mercator world used by the native camera.
// ES5 compatible: the TV setup can run on webOS with Node 0.12.
function boundsFor(config, maxTiles) {
 var lat=config.location.latitude, lon=config.location.longitude, radius=config.radiusKm;
 var count, z=12, b;
 var sin=Math.sin(lat*Math.PI/180);
 var centerX=(lon+180)/360;
 var centerY=(1-Math.log((1+sin)/(1-sin))/(2*Math.PI))/2;
 // The widest idle view is max(20km, radius*2.4). Lavender scales it
 // by 1.15 for its circular mask; the canvas renders 20% beyond the view.
 // Leave a little extra room for floating-point/tile boundary rounding.
 var half=Math.max(20,radius*2.4)*0.70/(6371*Math.cos(lat*Math.PI/180)*2*Math.PI);
 do {
  count=Math.pow(2,z);
  b={x0:Math.floor((centerX-half)*count),x1:Math.floor((centerX+half)*count),
     y0:Math.max(0,Math.floor((centerY-half)*count)),y1:Math.min(count-1,Math.floor((centerY+half)*count))};
  if ((b.x1-b.x0+1)*(b.y1-b.y0+1)<=maxTiles) return {zoom:z,bounds:b};
  z--;
 } while(z>=6);
 throw new Error('Selected map area is too large');
}
module.exports={boundsFor:boundsFor};
