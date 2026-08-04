"use strict";
/** v74.3.3-alpha11 stage2: 運転窓・ワイパー・前照灯のScene構築だけを担当。 */
(() => {
  function build({THREE,parent,axis,d,mats,noseDirection}){
    const geometry=window.TrainLeadGeometry;
    const h=window.TrainPartHelpers;
    const exterior=window.TrainExteriorSpec;
    if(!geometry||!h||!exterior) throw new Error("Cab dependencies are not loaded.");
    const tip=noseDirection*d.carLength/2;
    const cab=exterior.cab;
    const glassMaterial=mats.glass.clone();
    glassMaterial.depthWrite=false; glassMaterial.transparent=true;
    glassMaterial.opacity=Math.max(.72,glassMaterial.opacity??.82);
    glassMaterial.side=THREE.DoubleSide;
    const glass=new THREE.Mesh(geometry.cabWindowGeometry(THREE,d,noseDirection,axis,0),glassMaterial);
    glass.renderOrder=8;
    glass.userData={component:"windows",part:"cab-panoramic-window",flushCabWindow:true,embeddedInNose:true,continuousCurvedGlass:true};
    parent.add(glass);
    const innerMaterial=mats.steelDark.clone(); innerMaterial.side=THREE.DoubleSide;
    const innerGlass=new THREE.Mesh(geometry.cabWindowGeometry(THREE,d,noseDirection,axis,-.018),innerMaterial);
    innerGlass.renderOrder=4;
    innerGlass.userData={component:"windows",part:"cab-window-inner-depth"}; parent.add(innerGlass);
    if(cab.wiperEnabled){
      const frontLong=tip-noseDirection*(cab.windowCenterFromTip-.25);
      for(const side of [-.42,.42]){
        const w=h.box(THREE,parent,axis,.045,.46,.022,mats.steelDark,frontLong-noseDirection*.025,3.01,side);
        if(axis==="z") w.rotation.z=side>0?-.24:.24; else w.rotation.x=side>0?.24:-.24;
        w.userData={component:"windows",part:"wiper",followsCurvedWindshield:true};
      }
    }
    const lightSpec=exterior.lights;
    for(const side of [-1,1]){
      const long=tip-noseDirection*lightSpec.centerFromTip;
      const light=new THREE.Mesh(new THREE.SphereGeometry(.15,16,10),mats.warmLight);
      light.scale.set(axis==="z"?.42:1.85,.52,axis==="z"?1.85:.42);
      h.longitudinal(light,axis,long); light.position.y=lightSpec.centerY; h.lateral(light,axis,side*lightSpec.lateral);
      light.userData={component:"lights",part:"headlight",embedded:true}; parent.add(light);
    }
  }
  window.TrainCabPart=Object.freeze({build});
})();
