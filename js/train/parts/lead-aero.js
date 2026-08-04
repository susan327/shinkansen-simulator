"use strict";
/** v74.3.3-alpha11 stage1: 先頭シェル・ライン・スカート・腹部カバーのScene構築を担当。 */
(() => {
  function buildShellAndStripes({THREE,parent,axis,d,mats,noseDirection}){
    const g=window.TrainLeadGeometry;
    const shell=new THREE.Mesh(g.buildShellGeometry(THREE,d,noseDirection,axis),mats.noseWhite||mats.bodyWhite);
    shell.castShadow=true; shell.receiveShadow=true; shell.userData={component:"body",part:"lead-shell"}; parent.add(shell);
    for(const side of [-1,1]){
      const primary=new THREE.Mesh(g.stripeGeometry(THREE,d,noseDirection,axis,side,d.stripePrimaryY||1.96,.16,side>0?.12:0),mats.navy);
      primary.userData={component:"stripe",part:"primary-stripe"}; parent.add(primary);
      const secondary=new THREE.Mesh(g.stripeGeometry(THREE,d,noseDirection,axis,side,d.stripeSecondaryY||1.78,.055,side>0?.87:.75),mats.aqua);
      secondary.userData={component:"stripe",part:"secondary-stripe"}; parent.add(secondary);
    }
    return shell;
  }
  function buildCovers({THREE,parent,axis,d,mats,noseDirection}){
    const g=window.TrainLeadGeometry;
    const material=mats.skirtGray||mats.equipment||mats.bodyWhite;
    for(const side of [-1,1]){
      const skirt=new THREE.Mesh(g.skirtGeometry(THREE,d,noseDirection,axis,side),material);
      skirt.castShadow=true; skirt.receiveShadow=true;
      skirt.userData={component:"skirt",part:"side-skirt",leadBogieSkirt:true,side,originalGraySkirt:true}; parent.add(skirt);
    }
    const belly=new THREE.Mesh(g.bellyCoverGeometry(THREE,d,noseDirection,axis),material);
    belly.castShadow=true; belly.receiveShadow=true;
    belly.userData={component:"skirt",part:"belly-cover",leadBellyCover:true,coversBogieGap:true}; parent.add(belly);
    return belly;
  }
  window.TrainLeadAeroPart=Object.freeze({buildShellAndStripes,buildCovers});
})();
