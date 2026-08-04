"use strict";
/** v73.4.5: 床下機器を車体中心側へ収め、先頭車ではスカート内から突出させない。 */
(() => {
  function build({THREE,parent,axis,d,mats,index,covered=false}){
    const underfloorRoot=new THREE.Group(); underfloorRoot.userData.component="underfloor"; parent.add(underfloorRoot); parent=underfloorRoot;
    const h=window.TrainPartHelpers;
    const maxWidth=covered?1.92:2.48;
    const baseY=covered?0.62:0.43;
    const modules=[
      {l:-4.8,len:3.6,w:Math.min(2.20,maxWidth),h:0.44},
      {l:0,len:4.1,w:maxWidth,h:0.48},
      {l:4.8,len:3.4,w:Math.min(2.16,maxWidth),h:0.42}
    ];
    modules.forEach((m,i)=>h.box(THREE,parent,axis,m.len,m.h,m.w,covered?mats.steelDark:(i===1&&index%4===0?mats.steelDark:mats.equipment),m.l,baseY,0));
    h.box(THREE,parent,axis,2.8,0.18,Math.min(2.08,maxWidth),covered?mats.steelDark:mats.equipment,-1.8,covered?0.82:0.76,0);
  }
  window.TrainUnderfloorPart=Object.freeze({build});
})();
