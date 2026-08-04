"use strict";
/** v74.2.0-alpha7: 号車設備プロファイルに応じて窓数・間隔・設備区画を変更。 */
(() => {
  function makeLayout(d,type,noseDirection,serviceProfile){
    const start=noseDirection<0 ? -d.carLength/2+d.noseLength+2.20 : -d.carLength/2+3.10;
    const end=noseDirection>0 ? d.carLength/2-d.noseLength-2.20 : d.carLength/2-3.10;
    if(type!=="middle") return {start,end,count:Math.max(5,Math.floor((end-start)/d.windowPitch)+1),gaps:[]};
    if(serviceProfile==="facilities"){
      // トイレ・洗面・多目的室の設備区画。左右で少し位置を変えて実車らしい非対称性を持たせる。
      return {start:start+0.30,end:end-0.25,count:12,gaps:[-8.2,7.8],gapRadius:1.35};
    }
    return {start,end,count:15,gaps:[],gapRadius:0};
  }
  function build({THREE,parent,axis,d,mats,type,noseDirection,serviceProfile="passenger",carNumber=0}){
    const h=window.TrainPartHelpers;
    for(const side of [-1,1]){
      const surface=side*(d.carWidth/2+0.010);
      const layout=makeLayout(d,type,noseDirection,serviceProfile);
      const span=Math.max(0,layout.end-layout.start);
      const candidates=[];
      for(let i=0;i<layout.count;i++){
        const long=layout.count===1?0:layout.start+span*(i/(layout.count-1));
        const sideShift=serviceProfile==="facilities" ? side*0.22 : 0;
        const blocked=(layout.gaps||[]).some(g=>Math.abs(long-(g+sideShift))<(layout.gapRadius||0));
        if(!blocked)candidates.push(long);
      }
      for(let i=0;i<candidates.length;i++){
        const long=candidates[i];
        const mesh=h.box(THREE,parent,axis,d.windowWidth,d.windowHeight,0.032,mats.glass,long,d.windowCenterY||2.38,surface+side*0.009);
        mesh.userData={component:"windows",part:"passenger-window",serviceProfile,carNumber};
      }
      // 設備区画は窓を無理に置かず、外板の小さな換気口で用途を表現。
      if(serviceProfile==="facilities"){
        for(const g of layout.gaps){
          const vent=h.box(THREE,parent,axis,0.42,0.15,0.025,mats.steelDark,g+side*0.22,2.72,surface+side*0.010);
          vent.userData={component:"windows",part:"facility-vent",serviceProfile,carNumber};
        }
      }
    }
  }
  window.TrainWindowsPart=Object.freeze({build});
})();
