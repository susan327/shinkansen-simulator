/* v71.5.0 atc-engine: app.js から責務分離 */

function calculateBrakeCurveSpeed(distance, targetSpeedKmh, deceleration) {
  const targetMps = kmhToMps(targetSpeedKmh);
  const safeDistance = Math.max(distance, 0);
  const permittedMps = Math.sqrt(targetMps ** 2 + 2 * deceleration * safeDistance);
  return mpsToKmh(permittedMps);
}

function getAtcPlan() {
  const position = train.position;
  let sectionLimit = getAccelerationSectionLimit(position);

  // v71.0.1: 出発駅構内は地上進路状態を最優先する。
  // 地上止中は30、進路構成後は70。分岐後方が抜けた後は通常の路線ATCへ戻る。
  if(position < DEPARTURE_ATC_RELEASE_FRONT_M){
    // 出発駅構内では進路状態を唯一の現示源とする。
    // 他の区間制限との Math.min で70が30へ戻る競合を防ぐ。
    sectionLimit=train.departureAtcSignalKmh;
  }

  // 終着駅への進入だけ「目標70」「目標30」のパターン制御を使う。
  if (position < ROUTE.target70.position) {
    const curveSpeed = calculateBrakeCurveSpeed(
      ROUTE.target70.position - position,
      ROUTE.target70.speedKmh,
      ROUTE.target70.deceleration
    );
    const permittedKmh = Math.min(sectionLimit, curveSpeed, 300);
    const targetActive = curveSpeed < sectionLimit - 0.25;
    return {
      permittedKmh,
      targetLabel: targetActive ? "目標70" : `${sectionLimit} km/h`,
      automaticFollow: targetActive,
      feedForwardDecel: ROUTE.target70.deceleration,
      manualStop: false,
      stationTarget: targetActive ? 70 : null
    };
  }

  if (position < ROUTE.target30.position) {
    const curveSpeed = calculateBrakeCurveSpeed(
      ROUTE.target30.position - position,
      ROUTE.target30.speedKmh,
      ROUTE.target30.deceleration
    );
    const permittedKmh = Math.min(70, curveSpeed);
    const targetActive = curveSpeed < 69.75;
    return {
      permittedKmh,
      targetLabel: targetActive ? "目標30" : "70 km/h",
      automaticFollow: targetActive,
      feedForwardDecel: ROUTE.target30.deceleration,
      manualStop: false,
      stationTarget: targetActive ? 30 : null
    };
  }

  return {
    permittedKmh: 30,
    targetLabel: "停止",
    automaticFollow: false,
    feedForwardDecel: 0,
    manualStop: true,
    stationTarget: null
  };
}


function updateAtc(deltaTime) {
  const plan = getAtcPlan();
  const speedKmh = mpsToKmh(train.speedMps);
  train.atcPermittedKmh = plan.permittedKmh;

  let targetDecel = 0;

  if (plan.automaticFollow && speedKmh > plan.permittedKmh - 2.5) {
    const correction = clamp((speedKmh - plan.permittedKmh) * 0.07, -0.18, 0.55);
    targetDecel = clamp(plan.feedForwardDecel + correction, 0, 1.25);
  }

  // 30 km/hより上からATC確認を押し続けていた場合のみ、
  // 30 km/h以下へ到達した瞬間に確認扱いを成立させる。
  if (
    train.atcConfirmHeld &&
    train.atc30ConfirmArmedAbove30 &&
    train.atc30ConfirmAvailable &&
    !train.atc30Confirmed &&
    speedKmh <= 30.2
  ) {
    confirmAtc30({ fromHeldArrival: true });
  }

  // 30 km/h確認扱いが済んでいない場合、30到達後もATCブレーキを保持する。
  if (train.atc30ConfirmAvailable && !train.atc30Confirmed && speedKmh <= 31.0) {
    targetDecel = Math.max(targetDecel, 0.62);
  }

  // ATC速度を超えた場合は、どの区間でも保安ブレーキをかける。
  const overspeed = speedKmh - plan.permittedKmh;
  if (overspeed > 0.6) {
    targetDecel = Math.max(targetDecel, clamp(0.22 + overspeed * 0.12, 0, 1.35));
  }

  // 減速度を少しずつ変化させ、ブレーキの立ち上がりを滑らかにする。
  train.atcBrakeTarget = targetDecel;
  train.atcBrakeDecel = moveTowards(
    train.atcBrakeDecel,
    train.atcBrakeTarget,
    0.48 * deltaTime
  );

  return plan;
}

function updatePhase(plan) {
  const speedKmh = mpsToKmh(train.speedMps);

  if (train.finished) {
    train.phase = PHASE.FINISHED;
  } else if (!train.running) {
    train.phase = PHASE.READY;
  } else if (plan.manualStop) {
    train.phase = PHASE.MANUAL_STOP;
  } else if (train.position >= ROUTE.target70.position) {
    train.phase = plan.automaticFollow ? PHASE.APPROACH_30 : PHASE.CRUISE_70;
  } else if (plan.stationTarget === 70) {
    train.phase = PHASE.APPROACH_70;
  } else if (
    (Math.abs(train.position - ROUTE.passStation.position) < 500 ||
     Math.abs(train.position - ROUTE.curveStation.position) < 500) &&
    speedKmh > 120
  ) {
    train.phase = PHASE.PASSING;
  } else if (train.position < 600 && speedKmh < 45) {
    train.phase = PHASE.DEPARTING;
  } else {
    train.phase = PHASE.RUNNING;
  }
}

function updateEvents(previousSpeedKmh, plan) {
  const position = train.position;
  const speedKmh = mpsToKmh(train.speedMps);

  for (const section of ACCELERATION_SECTIONS) {
    // 同じ速度が路線内で再登場しても、位置ごとに必ず現示変化を処理する。
    const key = `limit-${section.position}-${section.speedKmh}`;
    if (position >= section.position && !train.eventFlags.has(key)) {
      train.eventFlags.add(key);
      // 始発0mの信号70は、発車20秒前の専用イベントだけで扱う。
      // 戸閉・出発進行で通常ATCイベントが再発火する経路を完全に遮断する。
      if(section.position===0){
        sound.lastChimedAtc=section.speedKmh;
        continue;
      }
      logEvent(`ATC現示が ${section.speedKmh} km/h に変化。ピンポーン、信号${section.speedKmh}。`);
      announceAtcChange(section.speedKmh);
      window.setTimeout(() => callSignal(section.speedKmh), 850);
    }
  }

  if (position >= ROUTE.passStation.position && !train.eventFlags.has("pass-station")) {
    train.eventFlags.add("pass-station");
    train.passedStation = true;
    train.passActualSeconds = TIMETABLE.departureSeconds + train.elapsedSeconds;
    logEvent(`${ROUTE.passStation.name}駅を ${speedKmh.toFixed(0)} km/h で通過（${formatClock(train.passActualSeconds)}）。`);
  }

  if (position >= ROUTE.curveStation.position && !train.eventFlags.has("curve-pass-station")) {
    train.eventFlags.add("curve-pass-station");
    train.curveStationPassed = true;
    logEvent(`${ROUTE.curveStation.name}駅をカーブ制限 ${speedKmh.toFixed(0)} km/h で通過。`);
  }

  // 通過区間の制限は上の通常ATC現示変化でピンポーンを鳴らす。
  // 終着駅への進入だけ「目標70」「目標30」として扱う。
  if (plan.stationTarget === 70 && !train.eventFlags.has("target-set-70")) {
    train.eventFlags.add("target-set-70");
    logEvent("停車パターン・目標70。固定警報を鳴動。");
    play70BrakeAlarm();
    callTarget(70);
  }

  if (plan.stationTarget === 30 && !train.eventFlags.has("target-set-30")) {
    train.eventFlags.add("target-set-30");
    logEvent("停車パターン・目標30。固定警報を鳴動。");
    play70BrakeAlarm();
    train.atc30ConfirmAvailable = true;
    train.atc30Confirmed = false;
    callTarget(30);
  }

  if (position >= ROUTE.target70.position && !train.eventFlags.has("reached-70")) {
    train.eventFlags.add("reached-70");
    logEvent("70 km/h区間へ進入。次の目標は30 km/h。 ");
  }

  if (position >= ROUTE.target30.position && !train.eventFlags.has("manual-stop")) {
    train.eventFlags.add("manual-stop");
    logEvent("ATC 30。ここから停止位置までは手動ブレーキ。 ");
  }

  // 位置ではなく、ブレーキで実際に設定速度へ到達した瞬間にATCチャイムを鳴らす
  if (position > ROUTE.target70.position - 2500 && previousSpeedKmh > 70.8 && speedKmh <= 70.8 && !train.eventFlags.has("speed-reached-70")) {
    train.eventFlags.add("speed-reached-70");
    logEvent("実速度が70 km/hへ到達。ピンポーン、信号70。 ");
    playAtcChime();
    // チャイムへ音声が重ならないよう、鳴動後に歓呼する。
    window.setTimeout(() => callSignal(70), 850);
  }
  if (position > ROUTE.target30.position - 1200 && previousSpeedKmh > 30.8 && speedKmh <= 30.8 && !train.eventFlags.has("speed-reached-30")) {
    train.eventFlags.add("speed-reached-30");
    logEvent("実速度が30 km/hへ到達。ATC確認操作待ち。 ");
  }
}

