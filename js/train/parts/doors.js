"use strict";
/** v74.3.2-alpha10: 角丸・面一・戸袋収納式の共通ドア。 */
(() => {
  function roundedRectShape(THREE,w,h,r){
    const x=-w/2,y=-h/2,rr=Math.min(r,w/2,h/2);
    const s=new THREE.Shape();
    s.moveTo(x+rr,y);s.lineTo(x+w-rr,y);s.quadraticCurveTo(x+w,y,x+w,y+rr);
    s.lineTo(x+w,y+h-rr);s.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
    s.lineTo(x+rr,y+h);s.quadraticCurveTo(x,y+h,x,y+h-rr);
    s.lineTo(x,y+rr);s.quadraticCurveTo(x,y,x+rr,y);return s;
  }
  function roundedPanel(THREE,axis,w,h,depth,r,material){
    const g=new THREE.ExtrudeGeometry(roundedRectShape(THREE,w,h,r),{depth,bevelEnabled:false,curveSegments:8});
    g.translate(0,0,-depth/2);
    if(axis==="z") g.rotateY(Math.PI/2);
    const m=new THREE.Mesh(g,material);m.castShadow=true;m.receiveShadow=true;return m;
  }
  function place(panel,h,axis,long,y,lateral){h.longitudinal(panel,axis,long);panel.position.y=y;h.lateral(panel,axis,lateral);}
  function build({THREE,parent,axis,d,mats,index,noseDirection,doorsOpen,platformSide}){
    const h=window.TrainPartHelpers, doors=[];
    const doorCenterY=d.floorY+d.doorHeight/2;
    const primaryStripeLocalY=(d.stripePrimaryY||1.96)-doorCenterY;
    const radius=window.TrainExteriorSpec?.body?.doorCornerRadius||0.12;
    for(const side of [-1,1]){
      const bodySurface=side*(d.carWidth/2+0.003);
      const rear=-d.carLength/2+1.78, front=d.carLength/2-1.78;
      let positions=[rear,front];
      if(noseDirection>0) positions=[rear,d.carLength/2-d.noseLength-1.30];
      if(noseDirection<0) positions=[-d.carLength/2+d.noseLength+1.30,front];
      for(const long of positions){
        const seam=roundedPanel(THREE,axis,d.doorWidth+0.045,d.doorHeight+0.055,0.010,radius+0.018,mats.steelDark);
        place(seam,h,axis,long,doorCenterY,bodySurface);seam.userData={component:"doors",part:"rounded-door-seam",flush:true};parent.add(seam);

        const panel=new THREE.Group();panel.userData={component:"doors",part:"rounded-flush-door-panel"};
        const skin=roundedPanel(THREE,axis,d.doorWidth-0.022,d.doorHeight-0.030,0.016,radius,mats.bodyWhite);panel.add(skin);
        const glass=roundedPanel(THREE,axis,d.doorWidth*0.42,0.50,0.020,0.095,mats.glass);glass.position.y=0.31;h.lateral(glass,axis,side*0.003);panel.add(glass);
        h.box(THREE,panel,axis,d.doorWidth-0.045,0.16,0.020,mats.navy||mats.blue,0,primaryStripeLocalY,side*0.004);
        h.box(THREE,panel,axis,d.doorWidth-0.045,0.055,0.021,mats.aqua||mats.blue,0,(d.stripeSecondaryY||1.78)-doorCenterY,side*0.005);

        const slideDirection=long<0?-1:1;
        const amount=side===platformSide?Math.max(0,Math.min(1,doorsOpen)):0;
        const distance=d.doorWidth*1.04,closedLateral=bodySurface+side*0.003,pocketLateral=bodySurface-side*0.090;
        place(panel,h,axis,long+slideDirection*distance*amount,doorCenterY,closedLateral+(pocketLateral-closedLateral)*amount);parent.add(panel);
        doors.push({panel,axis,localCenter:long,direction:slideDirection,slideDistance:distance,closedLateral,pocketLateral,side,carIndex:index,flushClosed:true,roundedCorners:true});
      }
    }
    return doors;
  }
  window.TrainDoorsPart=Object.freeze({build});
})();
