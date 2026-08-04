"use strict";
/** v74.3.3-alpha11 stage2: 屋根と側面を一体化した、四角に近い角丸断面の共通車体。 */
(() => {
  function roundedBodyGeometry(THREE,axis,length,center,bottomY,topY,width,roundness){
    const segments=48, positions=[], indices=[];
    const map=window.TrainShapeProfile.mapPoint;
    const halfWidth=width/2, halfHeight=(topY-bottomY)/2, centerY=(topY+bottomY)/2;
    const x0=center-length/2,x1=center+length/2;
    const profile=[];
    for(let j=0;j<segments;j++){
      const a=j/segments*Math.PI*2;
      const p=window.TrainShapeProfile.superellipsePoint(a,halfWidth,halfHeight,roundness);
      // 床下側だけ少し平らにし、上肩と屋根は柔らかく丸める。
      let vertical=p.vertical;
      if(vertical<-halfHeight*0.78) vertical=-halfHeight*0.78+(vertical+halfHeight*0.78)*0.22;
      profile.push([p.lateral,centerY+vertical]);
    }
    for(const x of [x0,x1]) for(const [lat,y] of profile) positions.push(...map(axis,x,y,lat));
    for(let j=0;j<segments;j++){
      const n=(j+1)%segments,a=j,b=n,c=segments+n,d=segments+j;
      indices.push(a,d,b,b,d,c);
    }
    for(const ring of [0,1]){
      const base=ring*segments, x=ring===0?x0:x1, centerIndex=positions.length/3;
      positions.push(...map(axis,x,centerY,0));
      for(let j=0;j<segments;j++){
        const n=(j+1)%segments;
        if(ring===0) indices.push(centerIndex,base+n,base+j);
        else indices.push(centerIndex,base+j,base+n);
      }
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    g.setIndex(indices);g.computeVertexNormals();g.computeBoundingSphere();return g;
  }

  window.TrainBodyPart={
    build({THREE,parent,axis,d,mats,shellLength,shellCenter}){
      const profile=window.TrainShapeProfile.body(d);
      const skirt=window.TrainShapeProfile.skirt(d);
      const bottomY=Math.min(profile.bottomY,skirt.topY-0.02);
      const mesh=new THREE.Mesh(
        roundedBodyGeometry(THREE,axis,shellLength,shellCenter,bottomY,profile.roofTopY,profile.width-0.018,profile.roundness),
        mats.bodyWhite
      );
      mesh.castShadow=true;mesh.receiveShadow=true;
      mesh.userData={component:"body",part:"integrated-rounded-body",roundedCorners:true,nearRectangularSection:true};
      parent.add(mesh);

      const h=window.TrainPartHelpers;
      h.box(THREE,parent,axis,shellLength+0.03,0.16,d.carWidth+0.026,mats.navy||mats.blue,shellCenter,d.stripePrimaryY||1.96,0);
      h.box(THREE,parent,axis,shellLength+0.03,0.055,d.carWidth+0.040,mats.aqua||mats.blue,shellCenter,d.stripeSecondaryY||1.78,0);
      return mesh;
    }
  };
})();
