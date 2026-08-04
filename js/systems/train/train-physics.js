/* v71.5.0 train-physics: app.js から責務分離 */

function getAccelerationSectionLimit(position) {
  let limit = ACCELERATION_SECTIONS[0].speedKmh;

  for (const section of ACCELERATION_SECTIONS) {
    if (position >= section.position) {
      limit = section.speedKmh;
    } else {
      break;
    }
  }

  // 先頭が本線へ入っていても、最後部が分岐を抜けるまでは70を解除しない。
  const rearPosition = position - TRAIN_LENGTH_M;
  const rearClearPoint = DEPARTURE_GEOMETRY.switchEndM + DEPARTURE_GEOMETRY.rearClearanceMarginM;
  if (rearPosition < rearClearPoint) return Math.min(limit, 70);

  return limit;
}


function getAvailableTractionAcceleration(speedKmh) {
  // v71.0.1 N700系相当のフルノッチ加速モデル。
  // 起動加速度2.6 km/h/sから速度上昇に応じて連続的に低下し、
  // 平坦・P13で0→300 km/hが約190秒になるよう積分値から係数を逆算した。
  const normalizedSpeed = clamp(speedKmh / 300, 0, 1.2);
  const netAccelerationKmhPerSecond =
    2.6 / (1 + 1.94 * normalizedSpeed * normalizedSpeed);
  const desiredNetAcceleration = netAccelerationKmhPerSecond / 3.6;

  // updateTrain()で走行抵抗が別途差し引かれるため、ここでは抵抗分を加え、
  // 平坦線での最終的な車体加速度が上記曲線と一致するようにする。
  return desiredNetAcceleration + getResistanceDeceleration(speedKmh);
}

function getTractionAcceleration(speedKmh) {
  if (!train.running || train.finished || !train.doorsClosed) return 0;
  if (train.powerNotch <= 0 || train.brakeNotch > 0 || train.emergencyBrake) return 0;

  // 低速では低ノッチでも十分に牽引力が出るが、高速になるほど
  // ノッチ比率の指数を大きくして、P1〜P5では加速しにくくする。
  // P13は速度にかかわらず最大性能を維持する。
  const rawNotchRatio = train.powerNotch / 13;
  const speedRatio = clamp(speedKmh / 300, 0, 1.1);

  // v70.5: 低速では低ノッチも扱いやすく、高速では高ノッチとの差を強くする。
  const notchExponent = 1.0 + 3.10 * Math.pow(speedRatio, 1.55);
  let effectiveNotchRatio = Math.pow(rawNotchRatio, notchExponent);

  // 高速域で必要ノッチを下回る場合は、滑らかに牽引力を減らす。
  // 完全に無効にはしないため、ノッチ変更時の段差は生じない。
  const usefulNotchFloor =
    speedKmh < 120 ? 1 :
    speedKmh < 200 ? 3 :
    speedKmh < 270 ? 5 : 7;

  if (train.powerNotch < usefulNotchFloor) {
    const deficit =
      (usefulNotchFloor - train.powerNotch) /
      Math.max(1, usefulNotchFloor);

    effectiveNotchRatio *=
      1 - 0.55 * clamp(deficit, 0, 1);
  }

  const availableAcceleration = getAvailableTractionAcceleration(speedKmh);
  return Math.min(0.92, availableAcceleration * effectiveNotchRatio);
}

function getResistanceDeceleration(speedKmh) {
  return 0.014 + 0.00000082 * speedKmh * speedKmh;
}

function getManualBrakeDeceleration(speedKmh) {
  if (train.brakeNotch <= 0 && !train.emergencyBrake) return 0;

  // 指定値は走行抵抗を含む車体全体の実減速度。
  // 常用最大: 2.7 km/h/s（70→0）、非常: 3.64 km/h/s（120→0）。
  const targetTotalDeceleration = train.emergencyBrake
    ? 3.64 / 3.6
    : (train.brakeNotch / 7) * (2.7 / 3.6);
  const resistance = speedKmh > 0.1 ? getResistanceDeceleration(speedKmh) : 0;
  return Math.max(0, targetTotalDeceleration - resistance);
}


function updateTrain(deltaTime) {
  if (train.finished) return;

  const speedKmh = mpsToKmh(train.speedMps);
  if (train.running) train.elapsedSeconds += deltaTime;
  const plan = updateAtc(deltaTime);
  updatePhase(plan);

  if (!train.running) {
    train.acceleration = 0;
    updateDisplay(plan);
    return;
  }

  const traction = getTractionAcceleration(speedKmh);
  const resistance = train.speedMps > 0.02 ? getResistanceDeceleration(speedKmh) : 0;
  const manualBrake = getManualBrakeDeceleration(speedKmh);
  const effectiveBrake = Math.max(manualBrake, train.atcBrakeDecel);

  const gradientPermille = gradientAt(train.position);
  const gradientAcceleration = gradientAccelerationAt(train.position);
  let acceleration = traction - resistance - effectiveBrake + gradientAcceleration;
  train.gradientPermille = gradientPermille;
  train.gradientAcceleration = gradientAcceleration;

  if (train.speedMps <= 0.02 && acceleration < 0) {
    acceleration = 0;
  }

  train.acceleration = acceleration;
  train.speedMps = Math.max(0, train.speedMps + acceleration * deltaTime);
  const previousPositionM = train.position;
  train.position += train.speedMps * deltaTime;
  updateTrackJointSounds(previousPositionM, train.position);

  updateEvents(speedKmh, plan);
  checkBufferCollision();
  checkFinish();
  updateDisplay(plan);
}

