"use strict";
(() => {
  const longitudinal = (o,a,v) => { if(a === "z") o.position.z=v; else o.position.x=v; };
  const lateral = (o,a,v) => { if(a === "z") o.position.x=v; else o.position.z=v; };
  function box(THREE,parent,axis,l,y,w,material,long=0,height=0,side=0){
    const size=axis === "z" ? [w,y,l] : [l,y,w];
    const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),material);
    longitudinal(mesh,axis,long); mesh.position.y=height; lateral(mesh,axis,side);
    mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh;
  }
  function wheel(THREE,parent,axis,radius,width,material,long,height,side){
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,width,16),material);
    if(axis === "z") mesh.rotation.z=Math.PI/2; else mesh.rotation.x=Math.PI/2;
    longitudinal(mesh,axis,long); mesh.position.y=height; lateral(mesh,axis,side); parent.add(mesh); return mesh;
  }
  function tag(object,component,detail={}){
    object.userData={...object.userData,component,...detail};
    return object;
  }
  function componentGroup(THREE,parent,component){
    const group=new THREE.Group(); tag(group,component); parent.add(group); return group;
  }
  window.TrainPartHelpers=Object.freeze({box,wheel,longitudinal,lateral,tag,componentGroup});
})();
