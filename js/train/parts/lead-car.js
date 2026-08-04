"use strict";
/** v74.3.3-alpha11 stage1: 先頭・最後尾車の構築順だけを管理するオーケストレーター。 */
(() => {
  function build({THREE,parent,axis,d,mats,index,carNumber,serviceProfile,type,direction,doorsOpen,platformSide,detailLevel}){
    const noseDirection=type==="lead"?direction:-direction;
    window.TrainLeadAeroPart.buildShellAndStripes({THREE,parent,axis,d,mats,noseDirection});
    const doors=window.TrainDoorsPart.build({THREE,parent,axis,d,mats,index,noseDirection,doorsOpen,platformSide});
    window.TrainWindowsPart.build({THREE,parent,axis,d,mats,type,noseDirection,serviceProfile:"cab",carNumber});
    window.TrainCabPart.build({THREE,parent,axis,d,mats,noseDirection});
    window.TrainLeadAeroPart.buildCovers({THREE,parent,axis,d,mats,noseDirection});
    window.UnderbodyShieldBuilder.build({THREE,parent,axis,d,mats,shellLength:d.carLength,shellCenter:0,lead:true,noseDirection});
    if(detailLevel!=="low"){
      window.TrainBogiePart.build({THREE,parent,axis,d,mats});
      window.TrainUnderfloorPart.build({THREE,parent,axis,d,mats,index,covered:true});
    }
    parent.userData={...parent.userData,carIndex:index,carType:type,carNumber,serviceProfile:"cab",doors,integratedLeadCar:true,flushCabWindow:true,coveredLeadBogies:true,underbodyShielded:true,originalHorizontalStripe:true,grayAerodynamicSkirt:true};
    return doors;
  }
  const buildLead=options=>build({...options,type:"lead"});
  const buildTail=options=>build({...options,type:"tail"});
  window.TrainLeadCarPart=Object.freeze({build,buildLead,buildTail});
})();
