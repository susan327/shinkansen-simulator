"use strict";
/** v74.3.2-alpha10: TrainShapeProfileを唯一の断面原典として全車へ即反映。 */
(() => {
  function mapPoint(axis,longitudinal,y,lateral){
    return axis === "z" ? [lateral,y,longitudinal] : [longitudinal,y,lateral];
  }

  function unifiedSkirtGeometry(THREE,axis,length,center,topY,bottomY,topWidth,bottomWidth){
    const x0=center-length/2, x1=center+length/2;
    const tw=topWidth/2, bw=bottomWidth/2;
    const positions=[
      ...mapPoint(axis,x0,topY,-tw), ...mapPoint(axis,x1,topY,-tw),
      ...mapPoint(axis,x1,topY, tw), ...mapPoint(axis,x0,topY, tw),
      ...mapPoint(axis,x0,bottomY,-bw), ...mapPoint(axis,x1,bottomY,-bw),
      ...mapPoint(axis,x1,bottomY, bw), ...mapPoint(axis,x0,bottomY, bw)
    ];
    const indices=[
      0,4,1, 1,4,5, // left sloping face
      3,2,7, 2,6,7, // right sloping face
      0,3,4, 3,7,4, // front/end cap
      1,5,2, 2,5,6, // rear/end cap
      0,1,3, 1,2,3, // top closure
      4,7,5, 5,7,6  // bottom closure
    ];
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
    g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingSphere();
    return g;
  }

  window.TrainSkirtPart=Object.freeze({
    build({THREE,parent,axis,d,mats,shellLength,shellCenter}){
      const material=mats.skirtGray||mats.equipment||mats.steelDark;
      const profile=window.TrainShapeProfile.skirt(d);
      const {topY,bottomY,topWidth,bottomWidth}=profile;
      const length=Math.max(0.2,shellLength-0.18);

      // 側板を貼る方式を廃止し、断面全体を一つの閉じた台形メッシュにする。
      const skirt=new THREE.Mesh(
        unifiedSkirtGeometry(THREE,axis,length,shellCenter,topY,bottomY,topWidth,bottomWidth),
        material
      );
      skirt.castShadow=true; skirt.receiveShadow=true;
      skirt.userData={component:"skirt",part:"unified-tapered-skirt",coversBogies:true,coversBogieGap:true,commonCrossSection:true};
      parent.add(skirt);

      // 台車の真上に空が抜けないよう、床下中央を上側まで連続して閉じる。
      const h=window.TrainPartHelpers;
      const bellyTop=Math.min(topY-0.025,Math.max(profile.bellyTopY,bottomY+0.42));
      const bellyBottom=Math.max(bottomY+0.03,profile.bellyBottomY);
      const belly=h.box(THREE,parent,axis,length-0.08,bellyTop-bellyBottom,Math.max(2.04,bottomWidth-0.06),material,shellCenter,(bellyTop+bellyBottom)/2,0);
      belly.userData={component:"skirt",part:"sealed-belly-cover",coversBogieGap:true,noHandGap:true};
    }
  });
})();
