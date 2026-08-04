"use strict";
/** v74.3.3-alpha11 stage3: 床板・内スカート・隔壁による共通床下遮蔽。 */
(() => {
  function build({THREE,parent,axis,d,mats,shellLength,shellCenter=0,lead=false,noseDirection=0}){
    if(!window.TrainUnderbodyGeometry) throw new Error("TrainUnderbodyGeometry is not loaded.");
    const h=window.TrainPartHelpers;
    const p=window.TrainUnderbodyGeometry.profile(d,{shellLength,shellCenter,lead,noseDirection});
    const root=h.componentGroup(THREE,parent,"shield");
    root.userData={...root.userData,part:"underbody-shield-system",structuralShield:true};
    const mat=mats.steelDark||mats.equipment||mats.skirtGray||mats.bodyWhite;

    // 上面から台車・主電動機が抜けて見えない、連続した床板。
    const floor=h.box(THREE,root,axis,p.length,p.floorThickness,p.outerHalf*2,mat,p.center,p.floorY,0);
    h.tag(floor,"shield",{part:"sealed-floor-pan",blocksTopView:true});

    // 外スカートの内側に置く二重壁。斜め・側面から背景が抜けるのを防ぐ。
    const wallHeight=Math.max(0.18,p.floorY-p.lowerY);
    for(const side of [-1,1]){
      const wall=h.box(THREE,root,axis,p.length,wallHeight,p.innerWallThickness,mat,p.center,(p.floorY+p.lowerY)/2,side*p.innerHalf);
      h.tag(wall,"shield",{part:"inner-skirt",side,blocksSideView:true});
    }

    // 車端隔壁。正面・後方から床下奥まで見通せないようにする。
    for(const [long,role] of [[p.frontLong,"front-bulkhead"],[p.rearLong,"rear-bulkhead"]]){
      const bulk=h.box(THREE,root,axis,p.bulkheadThickness,p.bulkheadHeight,p.innerHalf*2,mat,long,(p.floorY+p.lowerY)/2,0);
      h.tag(bulk,"shield",{part:role,blocksLongitudinalView:true});
    }

    // 機器上面を覆う中央天井。床板との微小な隙間を埋める。
    const ceilingHeight=Math.max(0.06,p.floorY-p.equipmentCeilingY);
    const ceiling=h.box(THREE,root,axis,p.length-0.14,ceilingHeight,p.innerHalf*1.88,mat,p.center,(p.floorY+p.equipmentCeilingY)/2,0);
    h.tag(ceiling,"shield",{part:"equipment-ceiling",blocksEquipmentSilhouette:true});
    return root;
  }
  window.UnderbodyShieldBuilder=Object.freeze({build});
})();
