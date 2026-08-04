"use strict";
/** v74.3.3-alpha11 stage3: 現行設計値を中央値としたGUI仕様。 */
(() => {
  const controls = Object.freeze([
    Object.freeze({key:"noseLength",label:"ノーズ長さ",unit:"m",min:8,max:17,step:.1,defaultValue:12.5}),
    Object.freeze({key:"noseShoulderHold",label:"幅を保つ区間",unit:"%",min:.25,max:.75,step:.01,defaultValue:.50}),
    Object.freeze({key:"noseTipWidthRatio",label:"先端幅",unit:"%",min:.14,max:.62,step:.01,defaultValue:.38}),
    Object.freeze({key:"noseTipHeightRatio",label:"先端高さ",unit:"%",min:.12,max:.42,step:.01,defaultValue:.27}),
    Object.freeze({key:"noseCenterLift",label:"先端持ち上げ",unit:"m",min:.27,max:.95,step:.01,defaultValue:.61}),
    Object.freeze({key:"skirtTopY",label:"スカート上端",unit:"m",min:.65,max:1.25,step:.01,defaultValue:.95}),
    Object.freeze({key:"skirtBottomY",label:"スカート下端",unit:"m",min:.08,max:.56,step:.01,defaultValue:.32}),
    Object.freeze({key:"skirtBottomWidth",label:"スカート底幅",unit:"m",min:1.25,max:2.25,step:.01,defaultValue:1.75}),
    Object.freeze({key:"bellyTopY",label:"台車上カバー高",unit:"m",min:.90,max:1.70,step:.01,defaultValue:1.30}),
    Object.freeze({key:"cabWindowCenterFromTip",label:"運転窓位置",unit:"m",min:2.5,max:6.5,step:.05,defaultValue:4.5}),
    Object.freeze({key:"cabWindowLength",label:"運転窓長さ",unit:"m",min:1.8,max:4.6,step:.05,defaultValue:3.2}),
    Object.freeze({key:"cabWindowBaseHalfWidth",label:"窓端の半幅",unit:"m",min:.31,max:.91,step:.01,defaultValue:.61}),
    Object.freeze({key:"cabWindowPeakHalfWidth",label:"窓中央の半幅",unit:"m",min:.79,max:1.55,step:.01,defaultValue:1.17}),
    Object.freeze({key:"cabWindowLift",label:"窓上下位置",unit:"m",min:-.65,max:-.15,step:.01,defaultValue:-.40}),
    Object.freeze({key:"cabWindowScaleY",label:"窓縦倍率",unit:"×",min:.72,max:1.28,step:.01,defaultValue:1}),
    Object.freeze({key:"bodyRoundness",label:"車体角の丸み",unit:"×",min:3.6,max:5.8,step:.05,defaultValue:4.7}),
    Object.freeze({key:"doorCornerRadius",label:"ドア角丸",unit:"m",min:.05,max:.25,step:.01,defaultValue:.15})
  ]);
  const defaults = Object.freeze(Object.fromEntries(controls.map(item => [item.key,item.defaultValue])));
  const byKey = Object.freeze(Object.fromEntries(controls.map(item => [item.key,item])));
  window.TrainDesignerSpec = Object.freeze({version:"74.3.3-alpha11-stage3",controls,defaults,byKey});
})();
