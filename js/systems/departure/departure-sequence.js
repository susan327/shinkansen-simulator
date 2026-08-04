/* v71.5.0 departure-sequence: app.js から責務分離 */

function clearDepartureSequenceTimer(){
  if(train.departureSequenceTimer){
    clearTimeout(train.departureSequenceTimer);
    train.departureSequenceTimer=null;
  }
}

function playDepartureSignNote(note){
  const c=ensureAudioContext();
  if(!c || !sound.enabled || !train.departureSignActive) return;
  const q=DEPARTURE_SIGN_SOUND;
  const now=c.currentTime+.012;
  const end=now+q.duration;
  const out=c.createGain();
  const filter=c.createBiquadFilter();
  const pan=c.createStereoPanner ? c.createStereoPanner() : null;
  filter.type="lowpass";
  filter.frequency.setValueAtTime(q.filterHz,now);
  filter.Q.setValueAtTime(q.filterQ,now);
  out.gain.setValueAtTime(.0001,now);
  out.gain.exponentialRampToValueAtTime(Math.max(.0002,q.volume),now+Math.max(.004,q.attack));
  out.gain.setValueAtTime(Math.max(.0002,q.volume),end);
  out.gain.exponentialRampToValueAtTime(.0001,end+Math.max(.03,q.release));
  filter.connect(out);
  if(pan){
    pan.pan.setValueAtTime((train.departureSignPhase===0?-1:1)*q.stereoWidth,now);
    out.connect(pan);pan.connect(c.destination);
  }else out.connect(c.destination);
  const base=noteFrequency(note.note,note.octave,q.globalDetune);
  for(const layer of q.layers){
    if(!layer || layer.gain<=0) continue;
    const osc=c.createOscillator();
    const gain=c.createGain();
    osc.type=layer.wave;
    osc.frequency.setValueAtTime(base,now);
    osc.detune.setValueAtTime(layer.detune||0,now);
    gain.gain.setValueAtTime(Math.max(.0001,layer.gain),now);
    osc.connect(gain);gain.connect(filter);
    osc.start(now);osc.stop(end+q.release+.05);
  }
}

function departureSignStep(){
  if(!train.departureSignActive) return;
  const q=DEPARTURE_SIGN_SOUND;
  const note=train.departureSignPhase===0?q.noteD:q.noteFs;
  playDepartureSignNote(note);
  train.departureSignPhase=1-train.departureSignPhase;
  const extraGap=(train.departureSignPhase===0?q.pairGap:0);
  train.departureSignTimer=setTimeout(departureSignStep,(q.stepInterval+extraGap)*1000);
}

function startDepartureSign(){
  stopDepartureSign();
  train.departureSignActive=true;
  train.departureSignPhase=0;
  departureSignStep();
  logEvent("車掌から発車サイン。D5・F♯5交互合図を開始。");
}

function stopDepartureSign(){
  train.departureSignActive=false;
  if(train.departureSignStopTimer){
    clearTimeout(train.departureSignStopTimer);
    train.departureSignStopTimer=null;
  }
  if(train.departureSignTimer){
    clearTimeout(train.departureSignTimer);
    train.departureSignTimer=null;
  }
}

function clearDeparturePreannounceTimer(){
  // v71.0.1: 時刻チャイム用タイマーは廃止。地上進路状態がATC現示を決定する。
  if(train.departurePreannounceTimer){
    clearTimeout(train.departurePreannounceTimer);
    train.departurePreannounceTimer=null;
  }
}

function getDepartureRemainingSeconds(){
  return TIMETABLE.departureSeconds-train.timetableClockSeconds;
}

function setDepartureAtcSignal(nextKmh,{announce=true}={}){
  const next=Math.round(nextKmh);
  const previous=train.departureAtcSignalKmh;
  if(previous===next) return false;
  train.departureAtcSignalKmh=next;
  train.atcPermittedKmh=next;
  if(next===70) train.eventFlags.add("limit-0-70");
  updateDisplay(getAtcPlan());

  if(announce && next===DEPARTURE_ROUTE_CONFIG.proceedAtcKmh){
    // 現示変化が成立したことと、音声再生成功は別に管理する。
    // 音声は物理更新内で短時間再試行するが、戸閉処理からは一切呼ばない。
    logEvent("旭ヶ丘駅の出発進路構成。地上止解除、ATC 30→70。");
  }
  return true;
}

function setDepartureRouteState(nextState){
  if(train.departureRouteState===nextState) return false;
  train.departureRouteState=nextState;
  if(nextState===DEPARTURE_ROUTE_STATE.ROUTE_SET){
    train.departureRouteSetDone=true;
    setDepartureAtcSignal(DEPARTURE_ROUTE_CONFIG.proceedAtcKmh);
  }else{
    train.departureRouteSetDone=false;
    train.departureRouteChimePlayed=false;
    setDepartureAtcSignal(DEPARTURE_ROUTE_CONFIG.groundStopAtcKmh,{announce:false});
  }
  return true;
}

function updateDepartureRouteSystem(){
  const physicallyDeparted=train.position>1 || mpsToKmh(train.speedMps)>=0.5;
  if(physicallyDeparted) return;

  const remaining=getDepartureRemainingSeconds();
  if(
    train.departureRouteState===DEPARTURE_ROUTE_STATE.GROUND_STOP &&
    remaining<=DEPARTURE_ROUTE_CONFIG.routeSetLeadSeconds
  ){
    setDepartureRouteState(DEPARTURE_ROUTE_STATE.ROUTE_SET);
  }

  if(
    train.departureRouteState===DEPARTURE_ROUTE_STATE.ROUTE_SET &&
    !train.departureRouteChimePlayed &&
    remaining>=-1
  ){
    if(playAtcChimeGuaranteed()){
      train.departureRouteChimePlayed=true;
      train.departurePreannounceDone=true;
      sound.lastChimedAtc=DEPARTURE_ROUTE_CONFIG.proceedAtcKmh;
      window.setTimeout(()=>{
        if(train.position<=1 && mpsToKmh(train.speedMps)<0.5) callSignal(70);
      },850);
      logEvent("ATC現示70。ピンポーン、信号70。");
    }
  }
}

// 旧API互換。v71では地上止・進路構成システムへ委譲する。
function fireDeparturePreannouncement(){
  updateDepartureRouteSystem();
  return train.departureRouteChimePlayed;
}
function scheduleDeparturePreannouncement(){ clearDeparturePreannounceTimer(); }
function updateDeparturePreannouncement(){ updateDepartureRouteSystem(); }

