"use strict";
/** v74.3.3-alpha11 stage3: 床下遮蔽の純粋な寸法計算。Scene構築は行わない。 */
(() => {
  function profile(d,{shellLength,shellCenter=0,lead=false,noseDirection=0}={}){
    const skirt=window.TrainShapeProfile.skirt(d);
    const floorY=Math.max(skirt.topY+0.05,Math.min(d.floorY-0.08,1.36));
    const lowerY=Math.max(skirt.bottomY+0.055,0.34);
    const outerHalf=Math.max(0.85,skirt.bottomWidth/2-0.025);
    const innerHalf=Math.max(0.68,outerHalf-0.14);
    const length=Math.max(0.4,(shellLength||d.carLength)-0.28);
    const center=shellCenter||0;
    const frontLong=lead ? noseDirection*d.carLength/2-noseDirection*0.82 : center+length/2-0.06;
    const rearLong=lead ? -noseDirection*d.carLength/2+noseDirection*0.42 : center-length/2+0.06;
    return Object.freeze({
      floorY,lowerY,outerHalf,innerHalf,length,center,frontLong,rearLong,
      floorThickness:0.10,
      innerWallThickness:0.08,
      bulkheadThickness:0.10,
      bulkheadHeight:Math.max(0.34,floorY-lowerY),
      equipmentCeilingY:Math.max(lowerY+0.18,floorY-0.18)
    });
  }
  window.TrainUnderbodyGeometry=Object.freeze({profile});
})();
