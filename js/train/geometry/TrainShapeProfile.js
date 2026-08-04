"use strict";
/** v74.3.2-alpha10: 車体断面・スカート・曲率計算の唯一の共通原典。 */
(() => {
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number(v)));
  const smoothstep=t=>{t=clamp(t,0,1);return t*t*(3-2*t);};
  const smootherstep=t=>{t=clamp(t,0,1);return t*t*t*(t*(t*6-15)+10);};
  function mapPoint(axis,longitudinal,y,lateral){return axis==="z"?[lateral,y,longitudinal]:[longitudinal,y,lateral];}
  function sample(points,t){
    const x=clamp(t,0,1);
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1];
      if(x<=b[0]){const u=(x-a[0])/Math.max(1e-6,b[0]-a[0]);return a[1]+(b[1]-a[1])*smootherstep(u);}
    }
    return points[points.length-1][1];
  }
  function superellipsePoint(angle,halfWidth,halfHeight,exponent=4.4){
    const p=2/Math.max(2.05,exponent);
    const c=Math.cos(angle),s=Math.sin(angle);
    return {
      lateral:Math.sign(c)*Math.pow(Math.abs(c),p)*halfWidth,
      vertical:Math.sign(s)*Math.pow(Math.abs(s),p)*halfHeight
    };
  }
  function upperSurfaceY(centerY,halfWidth,halfHeight,lateral,exponent=4.4){
    const n=Math.max(2.05,exponent);
    const x=clamp(Math.abs(lateral)/Math.max(1e-6,halfWidth),0,0.9999);
    return centerY+halfHeight*Math.pow(Math.max(0,1-Math.pow(x,n)),1/n);
  }
  function body(d){
    const s=window.TrainExteriorSpec?.body||{};
    return Object.freeze({
      bottomY:Number.isFinite(s.bottomY)?s.bottomY:d.bodyBottomY,
      roofTopY:Number.isFinite(s.roofTopY)?s.roofTopY:d.roofTopY,
      width:Number.isFinite(s.width)?s.width:d.carWidth,
      roundness:Number.isFinite(s.roundness)?s.roundness:4.55,
      shoulderInset:Number.isFinite(s.shoulderInset)?s.shoulderInset:0.035
    });
  }
  function skirt(d){
    const s=window.TrainExteriorSpec?.skirt||{};
    return Object.freeze({
      topY:Number.isFinite(s.topY)?s.topY:(d.skirtShoulderY??1.22),
      bottomY:Number.isFinite(s.bottomY)?s.bottomY:(d.skirtBottomY??0.10),
      topWidth:Math.min(d.carWidth,(d.skirtTopWidth??d.carWidth)-0.012),
      bottomWidth:Number.isFinite(s.bottomWidth)?s.bottomWidth:(d.skirtBottomWidth??2.14),
      bellyTopY:Number.isFinite(s.bellyTopY)?s.bellyTopY:1.10,
      bellyBottomY:Number.isFinite(s.bellyBottomY)?s.bellyBottomY:Math.max((s.bottomY??0.10)+0.03,0.13)
    });
  }
  window.TrainShapeProfile=Object.freeze({clamp,smoothstep,smootherstep,mapPoint,sample,superellipsePoint,upperSurfaceY,body,skirt});
})();
