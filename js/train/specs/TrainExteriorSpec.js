"use strict";
/** v74.3.3-alpha11 stage2: DesignStore snapshotを描画用Specへ変換する唯一のFactory。 */
(() => {
  const ref=window.TrainReferenceSpec;
  const store=window.TrainDesignStore;
  const designer=window.TrainDesignerSpec;
  if(!ref||!store||!designer) throw new Error("TrainReferenceSpec, TrainDesignerSpec and TrainDesignStore must load before TrainExteriorSpec.");
  const value=(s,key)=>{
    const item=designer.byKey[key];
    const raw=Number(s[key]);
    return Math.max(item.min,Math.min(item.max,Number.isFinite(raw)?raw:item.defaultValue));
  };
  function create(source=store.snapshot()){
    const s=source;
    return Object.freeze({
      version:"74.3.3-alpha11-stage2",
      body:Object.freeze({width:ref.body.width,bottomY:ref.body.bodyBottomY,roofTopY:ref.body.roofTopY,floorY:ref.body.floorY,roundness:value(s,"bodyRoundness"),shoulderInset:.035,doorCornerRadius:value(s,"doorCornerRadius")}),
      nose:Object.freeze({length:value(s,"noseLength"),flatBottomY:ref.body.leadSkirtBottomY,shoulderHold:value(s,"noseShoulderHold"),tipWidthRatio:value(s,"noseTipWidthRatio"),tipHeightRatio:value(s,"noseTipHeightRatio"),centerLift:value(s,"noseCenterLift")}),
      cab:Object.freeze({windowCenterFromTip:value(s,"cabWindowCenterFromTip"),windowHalfLength:value(s,"cabWindowLength")/2,windowBaseHalfWidth:value(s,"cabWindowBaseHalfWidth"),windowPeakHalfWidth:value(s,"cabWindowPeakHalfWidth"),windowLift:value(s,"cabWindowLift"),windowScaleY:value(s,"cabWindowScaleY"),frontWrapDepth:.62,surfaceOffset:.028,doorEnabled:true,wiperEnabled:true}),
      skirt:Object.freeze({topY:value(s,"skirtTopY"),bottomY:value(s,"skirtBottomY"),bottomWidth:value(s,"skirtBottomWidth"),bellyTopY:value(s,"bellyTopY"),bellyBottomY:ref.details.leadBellyCoverBottomY,coverBogies:true}),
      stripe:Object.freeze({primaryY:ref.details.stripePrimaryY,secondaryY:ref.details.stripeSecondaryY,primaryWidth:.16,secondaryWidth:.055,taperLength:ref.details.leadStripeTaperLength,tipClearanceLeft:ref.details.leadStripeTipClearance,tipClearanceRight:ref.details.leadStripeTipClearance+.12}),
      lights:Object.freeze({centerFromTip:2.10,centerY:1.08,lateral:.68,width:.56,height:.16,depth:.08})
    });
  }
  window.TrainExteriorSpecFactory=Object.freeze({create});
  window.refreshTrainExteriorSpec=()=>{window.TrainExteriorSpec=create();return window.TrainExteriorSpec;};
  store.subscribe(()=>window.refreshTrainExteriorSpec());
  window.refreshTrainExteriorSpec();
})();
