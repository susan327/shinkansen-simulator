"use strict";
/** v73.4.7: 標準軌1,435mmとレール頭頂面を基準に台車・車輪を配置。 */
(() => {
  function build({THREE,parent,axis,d,mats}){
    const bogieRoot=new THREE.Group(); bogieRoot.userData.component="bogie"; parent.add(bogieRoot); parent=bogieRoot;
    const h=window.TrainPartHelpers;
    const common=window.BogieSpec?.common || {};
    const gauge=Number.isFinite(d.trackGauge)?d.trackGauge:(common.gauge ?? 1.435);
    const wheelY=Number.isFinite(d.wheelCenterY)?d.wheelCenterY:0.39;
    const wheelSide=gauge/2;
    for(const center of [-d.bogieCenterOffset,d.bogieCenterOffset]){
      h.box(THREE,parent,axis,2.95,0.30,2.05,mats.steelDark,center,wheelY+0.16,0);
      h.box(THREE,parent,axis,1.32,0.20,1.68,mats.equipment,center,wheelY+0.34,0);
      // 2軸台車。左右の車輪中心を標準軌のレール中心に一致させる。
      const axleHalfSpacing=common.axleHalfSpacing ?? 0.79;
      for(const dl of [-axleHalfSpacing,axleHalfSpacing]){
        for(const side of [-1,1]){
          const wheel=h.wheel(THREE,parent,axis,d.wheelRadius,0.15,mats.rubber,center+dl,wheelY,side*wheelSide);
          wheel.userData={...wheel.userData,railGauge:gauge,railSide:side,wheelOnRail:true};
        }
        // 車軸は左右車輪を結ぶ。スカート内に収まる高さに固定。
        h.box(THREE,parent,axis,0.16,0.12,gauge+0.22,mats.steelDark,center+dl,wheelY,0);
      }
    }
  }
  window.TrainBogiePart=Object.freeze({build});
})();
