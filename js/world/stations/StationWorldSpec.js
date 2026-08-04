"use strict";
/** 駅の唯一の設計図。停車・運転の双方が同じ結果を参照する。 */
(() => {
  const ROLE_INDEX = Object.freeze({ "left-outer":0, "left-main":1, "right-main":2, "right-outer":3 });
  const range=(a,b)=>Object.freeze({min:Math.min(a,b),max:Math.max(a,b)});
  function resolve(stationId="asahigaoka") {
    const station=window.ATC_getStationConfig?.(stationId);
    const ref=window.TrainReferenceSpec;
    const spacing=window.StationTrackSpacingSpec?.resolve(stationId);
    const turnout=window.StationTurnoutSpec?.resolve(stationId);
    if(!station||!ref||!spacing||!turnout) throw new Error("StationWorldSpec dependencies are missing.");
    let tracks;
    if(station.platformType==="side-two-track") {
      tracks=[
        {id:"down-main",role:"main",direction:"down",centerZ:spacing.mainLeft},
        {id:"up-main",role:"main",direction:"up",centerZ:spacing.mainRight}
      ];
    } else {
      tracks=[
        {id:"down-siding",role:"siding",direction:"down",centerZ:spacing.leftOuter},
        {id:"down-main",role:"main",direction:"down",centerZ:spacing.mainLeft},
        {id:"up-main",role:"main",direction:"up",centerZ:spacing.mainRight},
        {id:"up-siding",role:"siding",direction:"up",centerZ:spacing.rightOuter}
      ];
    }
    tracks=Object.freeze(tracks.map(Object.freeze));
    const trackCenters=Object.freeze(tracks.map(t=>t.centerZ));
    let platforms=[];
    if(station.platformType==="two-island-four-track") {
      platforms=[
        {id:"down-platform",type:"island",centerZ:(spacing.leftOuter+spacing.mainLeft)/2,width:spacing.platformWidth},
        {id:"up-platform",type:"island",centerZ:(spacing.mainRight+spacing.rightOuter)/2,width:spacing.platformWidth}
      ];
    } else if(station.platformType==="side-four-track") {
      platforms=[
        {id:"down-platform",type:"side",centerZ:spacing.leftOuter-spacing.trackToPlatformEdge-spacing.platformWidth/2,width:spacing.platformWidth},
        {id:"up-platform",type:"side",centerZ:spacing.rightOuter+spacing.trackToPlatformEdge+spacing.platformWidth/2,width:spacing.platformWidth}
      ];
    } else {
      platforms=[
        {id:"down-platform",type:"side",centerZ:spacing.mainLeft-spacing.trackToPlatformEdge-spacing.platformWidth/2,width:spacing.platformWidth},
        {id:"up-platform",type:"side",centerZ:spacing.mainRight+spacing.trackToPlatformEdge+spacing.platformWidth/2,width:spacing.platformWidth}
      ];
    }
    platforms=Object.freeze(platforms.map(Object.freeze));
    const operatingTrackIndex=ROLE_INDEX[station.operatingTrack] ?? 0;
    const operatingTrack=tracks[Math.min(operatingTrackIndex,tracks.length-1)];
    const activePlatformIndex=operatingTrack.centerZ<0?0:1;
    const length=Number(station.platformLengthM||424);
    const edgeBuffer=Number(ref.platform.passengerEdgeBuffer??0.60);
    const safeZones=Object.freeze(platforms.map(p=>Object.freeze({
      id:p.id,centerZ:p.centerZ,
      z:range(p.centerZ-p.width/2+edgeBuffer,p.centerZ+p.width/2-edgeBuffer),
      x:range(-length/2+2,length/2-2)
    })));
    return Object.freeze({
      stationId,layoutType:station.platformType,spacing,turnout,tracks,trackCenters,platforms,
      platformCenters:Object.freeze(platforms.map(p=>p.centerZ)),platformWidth:platforms[0]?.width??spacing.platformWidth,
      platformWidths:Object.freeze(platforms.map(p=>p.width)),platformLengthM:length,
      operatingTrackIndex,operatingTrackId:operatingTrack.id,operatingTrackCenterZ:operatingTrack.centerZ,
      activePlatformIndex,activePlatformCenterZ:platforms[activePlatformIndex]?.centerZ??0,safeZones,
      forbiddenTrackZones:Object.freeze(tracks.map(t=>Object.freeze({id:t.id,z:range(t.centerZ-2.15,t.centerZ+2.15)})))
    });
  }
  window.StationWorldSpec=Object.freeze({version:"74.0.0-beta11",resolve});
})();
