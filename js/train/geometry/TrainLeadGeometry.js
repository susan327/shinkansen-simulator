"use strict";
/** v74.3.3-alpha11 stage2: 先頭・最後尾車の純粋な形状計算。Sceneへの追加は行わない。 */
(() => {
  const exterior=()=>window.TrainExteriorSpec;
  const smoothstep=t=>t*t*(3-2*t);
  const smootherstep=t=>t*t*t*(t*(t*6-15)+10);

  function mapPoint(axis,longitudinal,y,lateral){
    return axis === "z" ? [lateral,y,longitudinal] : [longitudinal,y,lateral];
  }

  function sampleProfile(points,t){
    const x=Math.max(0,Math.min(1,t));
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1];
      if(x<=b[0]){
        const local=(x-a[0])/Math.max(0.0001,b[0]-a[0]);
        return a[1]+(b[1]-a[1])*smootherstep(local);
      }
    }
    return points[points.length-1][1];
  }

  function section(THREERef,d,noseDirection,long){
    const tip = noseDirection * d.carLength / 2;
    const extNose=exterior().nose;
    const noseLength=extNose.length;
    const noseStart = tip - noseDirection * noseLength;
    const signed = noseDirection * (long - noseStart);
    const t = Math.max(0, Math.min(1, signed / noseLength));

    // alpha7独自断面：運転室～台車前方では幅を保ち、先端付近だけ強く絞る。
    // 特定実車の輪郭を写さず、断面積変化が急変しないS字補間で構成する。
    const hold=extNose.shoulderHold;
    // 車体断面からノーズへC2連続で遷移させ、台車前方の四角い境界を抑える。
    const transitionEnd=Math.min(.78,hold+.20);
    const widthRatio=sampleProfile([
      [0.00,1.000],[hold*.55,1.000],[hold,.992],[transitionEnd,.930],
      [.84,.760],[.95,.510],[1.00,extNose.tipWidthRatio]
    ],t);
    const heightRatio=sampleProfile([
      [0.00,1.000],[hold*.55,1.000],[hold,.994],[transitionEnd,.935],
      [.86,.730],[.96,.500],[1.00,extNose.tipHeightRatio]
    ],t);
    const centerLift=sampleProfile([
      [0.00,0.000],[hold*.60,0.000],[hold,.012],[transitionEnd,.085],
      [.86,.255],[.96,.505],[1.00,extNose.centerLift]
    ],t);
    const baseHalfHeight=(d.roofTopY-d.bodyBottomY)/2;
    const baseCenterY=(d.roofTopY+d.bodyBottomY)/2;
    return {
      halfWidth:(d.carWidth/2-0.025)*widthRatio,
      halfHeight:Math.max(0.28,baseHalfHeight*heightRatio),
      centerY:baseCenterY-centerLift,
      widthRatio,
      t
    };
  }

  function shellSurfaceY(p,lateral){
    const exponent=window.TrainExteriorSpec?.body?.roundness||4.55;
    return window.TrainShapeProfile.upperSurfaceY(p.centerY,p.halfWidth,p.halfHeight,lateral,exponent);
  }

  function buildShellGeometry(THREERef,d,noseDirection,axis){
    const rings=56, segments=48, positions=[], indices=[];
    const rear=-noseDirection*d.carLength/2;
    const tip=noseDirection*d.carLength/2;
    for(let i=0;i<=rings;i++){
      const u=i/rings;
      const long=THREERef.MathUtils.lerp(rear,tip,u);
      const p=section(THREERef,d,noseDirection,long);
      for(let j=0;j<segments;j++){
        const a=j/segments*Math.PI*2;
        const exponent=THREERef.MathUtils.lerp(window.TrainExteriorSpec?.body?.roundness||4.55,2.55,smootherstep(Math.max(0,(p.t-0.72)/0.28)));
        const q=window.TrainShapeProfile.superellipsePoint(a,p.halfWidth,p.halfHeight,exponent);
        let vertical=q.vertical;
        if(vertical < -p.halfHeight*0.72) vertical=-p.halfHeight*0.72+(vertical+p.halfHeight*0.72)*0.22;
        positions.push(...mapPoint(axis,long,p.centerY+vertical,q.lateral));
      }
    }
    for(let i=0;i<rings;i++) for(let j=0;j<segments;j++){
      const n=(j+1)%segments;
      const a=i*segments+j,b=i*segments+n,c=(i+1)*segments+n,e=(i+1)*segments+j;
      if(noseDirection>0) indices.push(a,b,e,b,c,e); else indices.push(a,e,b,b,e,c);
    }
    for(const ring of [0,rings]){
      const long=ring===0?rear:tip;
      const p=section(THREERef,d,noseDirection,long);
      const center=positions.length/3;
      positions.push(...mapPoint(axis,long,p.centerY,0));
      const base=ring*segments;
      for(let j=0;j<segments;j++){
        const n=(j+1)%segments;
        if((ring===rings) === (noseDirection>0)) indices.push(base+j,base+n,center);
        else indices.push(base+j,center,base+n);
      }
    }
    const g=new THREERef.BufferGeometry();
    g.setAttribute("position",new THREERef.Float32BufferAttribute(positions,3));
    g.setIndex(indices); g.computeVertexNormals(); g.normalizeNormals(); g.computeBoundingSphere();
    return g;
  }

  function stripeGeometry(THREERef,d,noseDirection,axis,sideSign,yBase,width,tipOffset=0){
    const count=72, positions=[], indices=[];
    const rear=-noseDirection*d.carLength/2+0.18;
    const tip=noseDirection*d.carLength/2;
    const noseStart=tip-noseDirection*exterior().nose.length;
    // 独自デザイン：高さは維持し、前方へ向かって水平方向に細く収束させる。
    const taperStart=noseStart-noseDirection*(d.leadStripeFadeStartDoorInset||1.25);
    const tipClearance=(d.leadStripeTipClearance||2.4)+tipOffset;
    const renderEnd=tip-noseDirection*tipClearance;
    const taperLength=Math.max(1.0,d.leadStripeTaperLength||5.8);
    for(let i=0;i<=count;i++){
      const u=i/count;
      const long=THREERef.MathUtils.lerp(rear,renderEnd,u);
      const p=section(THREERef,d,noseDirection,long);
      const distanceIntoTaper=Math.max(0,noseDirection*(long-taperStart));
      const taper=smoothstep(Math.min(1,distanceIntoTaper/taperLength));
      const remaining=1-taper;
      const w=Math.max(0.004,width*(0.22+0.78*remaining));
      const lateral=sideSign*(p.halfWidth+(d.stripeSurfaceOffset||0.006));
      positions.push(...mapPoint(axis,long,yBase+w/2,lateral));
      positions.push(...mapPoint(axis,long,yBase-w/2,lateral));
    }
    for(let i=0;i<count;i++){
      const a=i*2,b=a+1,c=a+3,e=a+2;
      if(sideSign>0) indices.push(a,b,e,b,c,e); else indices.push(a,e,b,b,e,c);
    }
    const g=new THREERef.BufferGeometry();
    g.setAttribute("position",new THREERef.Float32BufferAttribute(positions,3));
    g.setIndex(indices); g.computeVertexNormals(); return g;
  }

  // ノーズ表面へ埋め込み、前端を前方へ回り込ませた連続曲面ガラス。
  function cabWindowGeometry(THREERef,d,noseDirection,axis,layerOffset=0){
    const longSteps=18, latSteps=14, positions=[], uvs=[], indices=[];
    const tip=noseDirection*d.carLength/2;
    const cab=exterior().cab;
    const centerLong=tip-noseDirection*cab.windowCenterFromTip;
    const halfLong=cab.windowHalfLength;
    for(let i=0;i<=longSteps;i++){
      const u=i/longSteps;
      const edge=Math.pow(Math.sin(Math.PI*u),.62);
      const halfLat=cab.windowBaseHalfWidth+(cab.windowPeakHalfWidth-cab.windowBaseHalfWidth)*edge;
      const frontWrap=smootherstep(Math.max(0,(.34-u)/.34));
      const rearRound=smootherstep(Math.max(0,(u-.82)/.18));
      const long=centerLong+noseDirection*((u-.5)*halfLong*2+cab.frontWrapDepth*frontWrap-.12*rearRound);
      const p=section(THREERef,d,noseDirection,long);
      for(let j=0;j<=latSteps;j++){
        const v=j/latSteps;
        const normalized=(v-.5)*2;
        const lateral=normalized*halfLat;
        const baseY=shellSurfaceY(p,lateral);
        const sideRound=Math.pow(Math.max(0,1-normalized*normalized),.42);
        const frontDrop=.52*frontWrap;
        const edgeDrop=.11*(1-sideRound);
        const y=(baseY-2.56)*cab.windowScaleY+2.56+cab.windowLift-frontDrop-edgeDrop;
        // Z-fightingを避け、ガラスをシェル表面よりわずかに外側へ配置。
        const out=cab.surfaceOffset+layerOffset;
        const outLat=lateral===0?0:Math.sign(lateral)*out*(.45+.55*Math.abs(normalized));
        positions.push(...mapPoint(axis,long,y+out,lateral+outLat));
        uvs.push(u,v);
      }
    }
    const row=latSteps+1;
    for(let i=0;i<longSteps;i++) for(let j=0;j<latSteps;j++){
      const a=i*row+j,b=a+1,c=(i+1)*row+j+1,e=(i+1)*row+j;
      if(noseDirection>0) indices.push(a,e,b,b,e,c); else indices.push(a,b,e,b,c,e);
    }
    const g=new THREERef.BufferGeometry();
    g.setAttribute("position",new THREERef.Float32BufferAttribute(positions,3));
    g.setAttribute("uv",new THREERef.Float32BufferAttribute(uvs,2));
    g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }

  function skirtGeometry(THREERef,d,noseDirection,axis,sideSign){
    const count=52, positions=[], indices=[];
    const rear=-noseDirection*d.carLength/2+0.25;
    const tip=noseDirection*d.carLength/2-0.30;
    const skirtSpec=window.TrainShapeProfile.skirt(d);
    const bottom=skirtSpec.bottomY;
    const top=skirtSpec.topY;
    for(let i=0;i<=count;i++){
      const u=i/count;
      const long=THREERef.MathUtils.lerp(rear,tip,u);
      const p=section(THREERef,d,noseDirection,long);
      const noseFactor=1-smoothstep(Math.max(0,(p.t-0.72)/0.28));
      const localTop=THREERef.MathUtils.lerp(Math.max(top,1.24),Math.max(top,1.32),noseFactor);
      const topLateral=Math.max(0.52,p.halfWidth-0.006);
      const targetBottomHalf=skirtSpec.bottomWidth/2;
      // 上端は車体幅、下端は床下幅へ絞る。先端ではノーズ幅を超えない。
      const bottomLateral=Math.min(targetBottomHalf,Math.max(0.42,topLateral*0.78));
      // ノーズ先端側で底面を緩やかに持ち上げ、台車前方との直角境界をなくす。
      const tipBlend=smootherstep(Math.max(0,(p.t-0.76)/0.24));
      const localBottom=THREERef.MathUtils.lerp(bottom,Math.min(localTop-0.20,bottom+0.44),tipBlend);
      positions.push(...mapPoint(axis,long,localTop,sideSign*topLateral));
      positions.push(...mapPoint(axis,long,localBottom,sideSign*bottomLateral));
    }
    for(let i=0;i<count;i++){
      const a=i*2,b=a+1,c=a+3,e=a+2;
      if(sideSign>0) indices.push(a,b,e,b,c,e); else indices.push(a,e,b,b,e,c);
    }
    const g=new THREERef.BufferGeometry();
    g.setAttribute("position",new THREERef.Float32BufferAttribute(positions,3));
    g.setIndex(indices); g.computeVertexNormals(); return g;
  }


  function bellyCoverGeometry(THREERef,d,noseDirection,axis){
    const count=56, positions=[], indices=[];
    const rear=-noseDirection*d.carLength/2+0.55;
    const tip=noseDirection*d.carLength/2-0.55;
    const skirtSpec=window.TrainShapeProfile.skirt(d);
    const topY=Math.min(skirtSpec.topY-0.02,Math.max(skirtSpec.bellyTopY,skirtSpec.bottomY+0.42));
    const bottomY=Math.max(skirtSpec.bottomY+0.015,skirtSpec.bellyBottomY);
    for(let i=0;i<=count;i++){
      const u=i/count;
      const long=THREERef.MathUtils.lerp(rear,tip,u);
      const p=section(THREERef,d,noseDirection,long);
      const noseNarrow=smoothstep(Math.max(0,(p.t-0.78)/0.22));
      const halfWidth=THREERef.MathUtils.lerp(skirtSpec.bottomWidth/2,Math.max(0.56,skirtSpec.bottomWidth*0.24),noseNarrow);
      positions.push(...mapPoint(axis,long,topY,-halfWidth));
      positions.push(...mapPoint(axis,long,topY, halfWidth));
      positions.push(...mapPoint(axis,long,bottomY,-halfWidth*0.92));
      positions.push(...mapPoint(axis,long,bottomY, halfWidth*0.92));
    }
    for(let i=0;i<count;i++){
      const a=i*4,b=a+1,c=a+2,e=a+3;
      const n=a+4,nb=a+5,nc=a+6,ne=a+7;
      indices.push(a,n,b,b,n,nb);          // top
      indices.push(c,e,nc,e,ne,nc);        // bottom
      indices.push(a,c,n,c,nc,n);          // left side
      indices.push(b,nb,e,e,nb,ne);         // right side
    }
    const g=new THREERef.BufferGeometry();
    g.setAttribute("position",new THREERef.Float32BufferAttribute(positions,3));
    g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }
  window.TrainLeadGeometry=Object.freeze({section,shellSurfaceY,buildShellGeometry,stripeGeometry,cabWindowGeometry,skirtGeometry,bellyCoverGeometry});
})();
