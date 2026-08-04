"use strict";

const ATC_PERFORMANCE_PROFILE = (() => {
  const requested = Number(new URLSearchParams(window.location.search).get("fps"));
  const targetFps = requested === 30 ? 30 : 60;
  const profile = Object.freeze({
    targetFps,
    frameIntervalMs: 1000 / targetFps,
    pixelRatio: 1,
    boardingShadows: false
  });
  window.__ATC_PERFORMANCE__ = profile;
  return profile;
})();

// ============================================================
// 高速鉄道 ATC シミュレーター v71.4.0 責務分離フェーズ1
// 内部単位: 距離 m / 速度 m/s / 加速度 m/s²
// ============================================================

const lerp = (a, b, t) => a + (b - a) * t;

// 標準軌。横方向のワールド座標は 1 unit = 1 m として扱う。
// レール中心間を 1,435 mm にするため、中心線から左右へ半分ずつ配置する。
const TRACK_GAUGE_METERS = window.ATC_CONFIG?.real?.gaugeM ?? 1.435;
const RAIL_CENTER_OFFSET = TRACK_GAUGE_METERS / 2;

const ROUTE = {
  length: 52350,
  passStation: {
    name: "桜野",
    position: 18000
  },
  curveStation: {
    name: "青峰",
    position: 32000
  },
  curveRestriction: {
    warning230Position: 26000,
    limit170Position: 29000,
    release230Position: 33500,
    release300Position: 35500
  },
  target70: {
    position: 50800,
    speedKmh: 70,
    deceleration: 0.60
  },
  target30: {
    position: 51850,
    speedKmh: 30,
    deceleration: 0.45
  },
  stopPosition: 52000,
  bufferStopPosition: 52130,
  renderEndPosition: 52350
};

// 旭ヶ丘の出発線形。位置は列車先頭基準。
// ホーム先端直後から分岐し、最後部が分岐終端＋余裕を抜けるまでATC 70を保持する。
const DEPARTURE_STATION_WORLD = window.StationWorldSpec?.resolve("asahigaoka");
const DEPARTURE_TURNOUT = DEPARTURE_STATION_WORLD?.turnout || { approachLength:80, transitionLength:416, parallelBefore:424, parallelAfter:80 };
const DEPARTURE_GEOMETRY = Object.freeze({
  platformStartM: -Number(DEPARTURE_STATION_WORLD?.platformLengthM || 424) - 6,
  platformEndM: 18,
  switchStartM: Number(DEPARTURE_TURNOUT.approachLength || 80) - 56,
  switchEndM: Number(DEPARTURE_TURNOUT.approachLength || 80) - 56 + Number(DEPARTURE_TURNOUT.transitionLength || 416),
  rearClearanceMarginM: 20
});
const TRAIN_LENGTH_M = window.ATC_CONFIG?.real?.formationLengthM ??
  ((window.ATC_CONFIG?.real?.vehicleLengthM ?? 25) * (window.ATC_CONFIG?.real?.cars ?? 4));
const DEPARTURE_ATC_RELEASE_FRONT_M =
  DEPARTURE_GEOMETRY.switchEndM + TRAIN_LENGTH_M + DEPARTURE_GEOMETRY.rearClearanceMarginM;

// 通過区間のATC現示。停車駅以外は「目標」ではなく、
// ピンポーンと同時に通常の制限速度現示へ切り替わる。
const ACCELERATION_SECTIONS = [
  { position: 0, speedKmh: 70 },
  { position: DEPARTURE_ATC_RELEASE_FRONT_M, speedKmh: 170 },
  { position: 3000, speedKmh: 230 },
  { position: 5000, speedKmh: 285 },
  { position: 7000, speedKmh: 300 },
  { position: 26000, speedKmh: 230 },
  { position: 29000, speedKmh: 170 },
  { position: 33500, speedKmh: 230 },
  { position: 35500, speedKmh: 285 },
  { position: 37000, speedKmh: 300 }
];

// P13を基本に各ATC現示まで加速し、ATCパターンに従って減速した
// 標準運転の物理シミュレーションを基準にしたダイヤ。
// 18.0 km桜野通過 / 32.0 km熱海型駅通過 / 52.0 km潮見中央停車
const TIMETABLE = {
  departureSeconds: 10 * 3600,
  passSeconds: 10 * 3600 + 6 * 60,
  curvePassSeconds: 10 * 3600 + 10 * 60,
  arrivalSeconds: 10 * 3600 + 17 * 60 + 30
};

const PHASE = {
  READY: "READY",
  DEPARTING: "DEPARTING",
  RUNNING: "RUNNING",
  PASSING: "PASSING",
  APPROACH_70: "ATC 300→70",
  CRUISE_70: "70km/h区間",
  APPROACH_30: "ATC 70→30",
  MANUAL_STOP: "手動停車",
  FINISHED: "FINISHED"
};

const DEPARTURE_ROUTE_STATE = Object.freeze({
  GROUND_STOP: "GROUND_STOP",
  ROUTE_SET: "ROUTE_SET"
});

const DEPARTURE_ROUTE_CONFIG = Object.freeze({
  routeSetLeadSeconds: 20,
  groundStopAtcKmh: 30,
  proceedAtcKmh: 70
});

const train = {
  position: 0,
  speedMps: 0,
  acceleration: 0,
  powerNotch: 0,
  brakeNotch: 7,
  emergencyBrake: false,
  doorsClosed: true,
  running: false,
  finished: false,
  atcPermittedKmh: 30,
  atcBrakeDecel: 0,
  atcBrakeTarget: 0,
  phase: PHASE.READY,
  passedStation: false,
  eventFlags: new Set(),
  simulationRate: 1,
  previousSpeedKmh: 0,
  stationPhase: "DOORS_CLOSED_WAIT_OPEN",
  elapsedSeconds: 0,
  timetableClockSeconds: TIMETABLE.departureSeconds - 60,
  passActualSeconds: null,
  arrivalActualSeconds: null,
  atc30ConfirmAvailable: false,
  atc30Confirmed: false,
  atcConfirmHeld: false,
  atc30ConfirmArmedAbove30: false,
  curveStationPassed: false,
  doorOpenRatio: 0,
  passengerEndActive: false,
  passengerEndTimer: null,
  boardingEndsAt: 0,
  boardingDurationMs: 40000,
  crashed: false,
  impactSpeedKmh: 0,
  departurePreannounceDone: false,
  departurePreannounceTimer: null,
  departureRouteState: DEPARTURE_ROUTE_STATE.GROUND_STOP,
  departureRouteSetDone: false,
  departureRouteChimePlayed: false,
  departureAtcSignalKmh: DEPARTURE_ROUTE_CONFIG.groundStopAtcKmh,
  departureSignStopTimer: null,
  departureSignTimer: null,
  departureSignActive: false,
  departureSignPhase: 0,
  departureSequenceTimer: null,
  powerCommandTimer: null,
  brakeCommandTimer: null,
  powerCommandTimers: new Set(),
  brakeCommandTimers: new Set(),
  requestedPowerNotch: 0,
  requestedBrakeNotch: 7
};

// ATCパターン投入時だけ、明暗1組を1回として目標70/30を8回点滅表示する。
// 点滅後はブレーキ曲線が返す監視速度へ表示を戻す。
let atcPatternFlashActive = false;
let atcPatternFlashTarget = null;
let atcPatternFlashTimer = null;
let atcPatternFlashPhase = 0;
const ATC_PATTERN_FLASH_CYCLES = 8;
const ATC_PATTERN_FLASH_HALF_CYCLE_MS = 180;
let previousStationTarget = null;

const ui = {
  sceneryCanvas: document.querySelector("#sceneryCanvas"),
  sceneryArea: document.querySelector("#sceneryArea"),
  viewSpeed: document.querySelector("#viewSpeed"),
  passDurationView: document.querySelector("#passDurationView"),
  startButton: document.querySelector("#startButton"),
  doorLamp: document.querySelector("#doorLamp"),
  doorScene: document.querySelector("#doorScene"),
  singleDoors: [...document.querySelectorAll(".single-door")],
  passengerEndLamp: document.querySelector("#passengerEndLamp"),
  doorClosedSceneLamp: document.querySelector("#doorClosedSceneLamp"),
  doorSceneMessage: document.querySelector("#doorSceneMessage"),
  doorSceneStation: document.querySelector("#doorSceneStation"),
  boardingSkipButton: document.querySelector("#boardingSkipButton"),
  resetButton: document.querySelector("#resetButton"),
  resultResetButton: document.querySelector("#resultResetButton"),
  statusLamp: document.querySelector("#statusLamp"),
  statusText: document.querySelector("#statusText"),
  messageText: document.querySelector("#messageText"),
  speedValue: document.querySelector("#speedValue"),
  speedBar: document.querySelector("#speedBar"),
  atcValue: document.querySelector("#atcValue"),
  atcCircleShell: document.querySelector("#atcCircleShell"),
  nextStationActionLabel: document.querySelector("#nextStationActionLabel"),
  nextStationDistanceValue: document.querySelector("#nextStationDistanceValue"),
  predictionCard: document.querySelector("#predictionCard"),
  predictionTypeLabel: document.querySelector("#predictionTypeLabel"),
  predictionTimeValue: document.querySelector("#predictionTimeValue"),
  drivingGraphCanvas: document.querySelector("#drivingGraphCanvas"),
  nextStationScheduledValue: document.querySelector("#nextStationScheduledValue"),
  predictionDifferenceValue: document.querySelector("#predictionDifferenceValue"),
  diagramModeValue: document.querySelector("#diagramModeValue"),
  diagramTargetSpeedValue: document.querySelector("#diagramTargetSpeedValue"),
  positionValue: document.querySelector("#positionValue"),
  remainingValue: document.querySelector("#remainingValue"),
  stopDistanceValue: document.querySelector("#stopDistanceValue"),
  manualModeValue: document.querySelector("#manualModeValue"),
  stopCard: document.querySelector(".stop-card"),
  trainMarker: document.querySelector("#trainMarker"),
  routeLine: document.querySelector(".route-line"),
  powerDisplay: document.querySelector("#powerDisplay"),
  brakeDisplay: document.querySelector("#brakeDisplay"),
  accelerationValue: document.querySelector("#accelerationValue"),
  gradientValue: document.querySelector("#gradientValue"),
  elevationValue: document.querySelector("#elevationValue"),
  atcBrakeValue: document.querySelector("#atcBrakeValue"),
  phaseValue: document.querySelector("#phaseValue"),
  passStationValue: document.querySelector("#passStationValue"),
  clockValue: document.querySelector("#clockValue"),
  passScheduledValue: document.querySelector("#passScheduledValue"),
  passActualValue: document.querySelector("#passActualValue"),
  arrivalScheduledValue: document.querySelector("#arrivalScheduledValue"),
  arrivalActualValue: document.querySelector("#arrivalActualValue"),
  atcConfirmButton: document.querySelector("#atcConfirmButton"),
  atcConfirmFloatButton: document.querySelector("#atcConfirmFloatButton"),
  mixerOptionButton: document.querySelector("#mixerOptionButton"),
  motorMixerPanel: document.querySelector("#motorMixerPanel"),
  atcConfirmStatus: document.querySelector("#atcConfirmStatus"),
  eventLog: document.querySelector("#eventLog"),
  resultPanel: document.querySelector("#resultPanel"),
  resultTitle: document.querySelector("#resultTitle"),
  resultText: document.querySelector("#resultText"),
  collisionOverlay: document.querySelector("#collisionOverlay"),
  collisionTitle: document.querySelector("#collisionTitle"),
  collisionSubtitle: document.querySelector("#collisionSubtitle"),
  powerUpButton: document.querySelector("#powerUpButton"),
  powerDownButton: document.querySelector("#powerDownButton"),
  powerNeutralButton: document.querySelector("#powerNeutralButton"),
  brakeReleaseButton: document.querySelector("#brakeReleaseButton"),
  brakeFullReleaseButton: document.querySelector("#brakeFullReleaseButton"),
  brakeStrengthenButton: document.querySelector("#brakeStrengthenButton"),
  emergencyButton: document.querySelector("#emergencyButton"),
  rateButtons: [...document.querySelectorAll(".rate-button")],
  soundToggleButton: document.querySelector("#soundToggleButton"),
  soundTestButton: document.querySelector("#soundTestButton"),
  brake70TestButton: document.querySelector("#brake70TestButton"),
  brake70TestButtonPanel: document.querySelector("#brake70TestButtonPanel"),
  alarmBeepDurationInput: document.querySelector("#alarmBeepDurationInput"),
  alarmBeepIntervalInput: document.querySelector("#alarmBeepIntervalInput"),
  alarmBeepCountInput: document.querySelector("#alarmBeepCountInput"),
  alarmSetCountInput: document.querySelector("#alarmSetCountInput"),
  alarmSetGapInput: document.querySelector("#alarmSetGapInput"),
  alarmLeadDistanceInput: document.querySelector("#alarmLeadDistanceInput"),
  alarmBeepDurationValue: document.querySelector("#alarmBeepDurationValue"),
  alarmBeepIntervalValue: document.querySelector("#alarmBeepIntervalValue"),
  alarmBeepCountValue: document.querySelector("#alarmBeepCountValue"),
  alarmSetCountValue: document.querySelector("#alarmSetCountValue"),
  alarmSetGapValue: document.querySelector("#alarmSetGapValue"),
  alarmLeadDistanceValue: document.querySelector("#alarmLeadDistanceValue"),
  doorOpenTestButton: document.querySelector("#doorOpenTestButton"),
  doorCloseTestButton: document.querySelector("#doorCloseTestButton"),
  boardingBuzzerTestButton: document.querySelector("#boardingBuzzerTestButton"),
  openAirDurationInput: document.querySelector("#openAirDurationInput"), openAirDurationValue: document.querySelector("#openAirDurationValue"),
  openAirLevelInput: document.querySelector("#openAirLevelInput"), openAirLevelValue: document.querySelector("#openAirLevelValue"),
  openAirPitchInput: document.querySelector("#openAirPitchInput"), openAirPitchValue: document.querySelector("#openAirPitchValue"),
  openLockPitchInput: document.querySelector("#openLockPitchInput"), openLockPitchValue: document.querySelector("#openLockPitchValue"),
  openLockLevelInput: document.querySelector("#openLockLevelInput"), openLockLevelValue: document.querySelector("#openLockLevelValue"),
  openVolumeInput: document.querySelector("#openVolumeInput"), openVolumeValue: document.querySelector("#openVolumeValue"),
  closeAirDurationInput: document.querySelector("#closeAirDurationInput"), closeAirDurationValue: document.querySelector("#closeAirDurationValue"),
  closeAirLevelInput: document.querySelector("#closeAirLevelInput"), closeAirLevelValue: document.querySelector("#closeAirLevelValue"),
  closeAirPitchInput: document.querySelector("#closeAirPitchInput"), closeAirPitchValue: document.querySelector("#closeAirPitchValue"),
  closeLockPitchInput: document.querySelector("#closeLockPitchInput"), closeLockPitchValue: document.querySelector("#closeLockPitchValue"),
  closeLockLevelInput: document.querySelector("#closeLockLevelInput"), closeLockLevelValue: document.querySelector("#closeLockLevelValue"),
  closeVolumeInput: document.querySelector("#closeVolumeInput"), closeVolumeValue: document.querySelector("#closeVolumeValue"),
  boardingFrequencyInput: document.querySelector("#boardingFrequencyInput"), boardingFrequencyValue: document.querySelector("#boardingFrequencyValue"),
  boardingDurationInput: document.querySelector("#boardingDurationInput"), boardingDurationValue: document.querySelector("#boardingDurationValue"),
  boardingVolumeInput: document.querySelector("#boardingVolumeInput"), boardingVolumeValue: document.querySelector("#boardingVolumeValue"),
  boardingWaveSelect: document.querySelector("#boardingWaveSelect"),
  driverVoiceToggle: document.querySelector("#driverVoiceToggle"),
  driverVoiceStatus: document.querySelector("#driverVoiceStatus"),
  voiceDoorTestButton: document.querySelector("#voiceDoorTestButton"),
  voiceDepartTestButton: document.querySelector("#voiceDepartTestButton"),
  voiceSignalTestButton: document.querySelector("#voiceSignalTestButton"),
  voiceTargetTestButton: document.querySelector("#voiceTargetTestButton"),
  voice70TestButton: document.querySelector("#voice70TestButton"),
  voice30TestButton: document.querySelector("#voice30TestButton"),
  voiceStopTestButton: document.querySelector("#voiceStopTestButton"),
  soundPresetSelect: document.querySelector("#soundPresetSelect"),
  globalTuningInput: document.querySelector("#globalTuningInput"),
  pinTuningInput: document.querySelector("#pinTuningInput"),
  pongTuningInput: document.querySelector("#pongTuningInput"),
  globalTuningValue: document.querySelector("#globalTuningValue"),
  pinTuningValue: document.querySelector("#pinTuningValue"),
  pongTuningValue: document.querySelector("#pongTuningValue"),
  pinDurationInput: document.querySelector("#pinDurationInput"),
  pinReleaseInput: document.querySelector("#pinReleaseInput"),
  pongDurationInput: document.querySelector("#pongDurationInput"),
  chimeGapInput: document.querySelector("#chimeGapInput"),
  chimeOverlapInput: document.querySelector("#chimeOverlapInput"),
  chimeVolumeInput: document.querySelector("#chimeVolumeInput"),
  pinDurationValue: document.querySelector("#pinDurationValue"),
  pinReleaseValue: document.querySelector("#pinReleaseValue"),
  pongDurationValue: document.querySelector("#pongDurationValue"),
  chimeGapValue: document.querySelector("#chimeGapValue"),
  chimeOverlapValue: document.querySelector("#chimeOverlapValue"),
  chimeVolumeValue: document.querySelector("#chimeVolumeValue"),
  soundResetButton: document.querySelector("#soundResetButton"),
  pinPitchSelect: document.querySelector("#pinPitchSelect"),
  pongPitchSelect: document.querySelector("#pongPitchSelect"),
  pinWaveSelect: document.querySelector("#pinWaveSelect"),
  pongWaveSelect: document.querySelector("#pongWaveSelect"),
  pinHarmonicInput: document.querySelector("#pinHarmonicInput"),
  pongHarmonicInput: document.querySelector("#pongHarmonicInput"),
  pinDetuneInput: document.querySelector("#pinDetuneInput"),
  pongDetuneInput: document.querySelector("#pongDetuneInput"),
  pinHarmonicValue: document.querySelector("#pinHarmonicValue"),
  pongHarmonicValue: document.querySelector("#pongHarmonicValue"),
  pinDetuneValue: document.querySelector("#pinDetuneValue"),
  pongDetuneValue: document.querySelector("#pongDetuneValue"),
  pinSineInput: document.querySelector("#pinSineInput"), pinTriangleInput: document.querySelector("#pinTriangleInput"), pinSquareInput: document.querySelector("#pinSquareInput"), pinSawInput: document.querySelector("#pinSawInput"),
  pongSineInput: document.querySelector("#pongSineInput"), pongTriangleInput: document.querySelector("#pongTriangleInput"), pongSquareInput: document.querySelector("#pongSquareInput"), pongSawInput: document.querySelector("#pongSawInput"),
  pinSineValue: document.querySelector("#pinSineValue"), pinTriangleValue: document.querySelector("#pinTriangleValue"), pinSquareValue: document.querySelector("#pinSquareValue"), pinSawValue: document.querySelector("#pinSawValue"),
  pongSineValue: document.querySelector("#pongSineValue"), pongTriangleValue: document.querySelector("#pongTriangleValue"), pongSquareValue: document.querySelector("#pongSquareValue"), pongSawValue: document.querySelector("#pongSawValue"),
  pinAttackInput: document.querySelector("#pinAttackInput"), pinDecayInput: document.querySelector("#pinDecayInput"), pinSustainInput: document.querySelector("#pinSustainInput"), pinEnvReleaseInput: document.querySelector("#pinEnvReleaseInput"),
  pongAttackInput: document.querySelector("#pongAttackInput"), pongDecayInput: document.querySelector("#pongDecayInput"), pongSustainInput: document.querySelector("#pongSustainInput"), pongEnvReleaseInput: document.querySelector("#pongEnvReleaseInput"),
  pinAttackValue: document.querySelector("#pinAttackValue"), pinDecayValue: document.querySelector("#pinDecayValue"), pinSustainValue: document.querySelector("#pinSustainValue"), pinEnvReleaseValue: document.querySelector("#pinEnvReleaseValue"),
  pongAttackValue: document.querySelector("#pongAttackValue"), pongDecayValue: document.querySelector("#pongDecayValue"), pongSustainValue: document.querySelector("#pongSustainValue"), pongEnvReleaseValue: document.querySelector("#pongEnvReleaseValue"),
  pinFilterInput: document.querySelector("#pinFilterInput"), pongFilterInput: document.querySelector("#pongFilterInput"), pinDriveInput: document.querySelector("#pinDriveInput"), pongDriveInput: document.querySelector("#pongDriveInput"),
  pinFilterValue: document.querySelector("#pinFilterValue"), pongFilterValue: document.querySelector("#pongFilterValue"), pinDriveValue: document.querySelector("#pinDriveValue"), pongDriveValue: document.querySelector("#pongDriveValue"),
  soundExportButton: document.querySelector("#soundExportButton"), soundImportButton: document.querySelector("#soundImportButton"), soundJsonArea: document.querySelector("#soundJsonArea"),
  toneFamilySelect: document.querySelector("#toneFamilySelect"), toneVariationSelect: document.querySelector("#toneVariationSelect"), applyCharacterButton: document.querySelector("#applyCharacterButton"), compareVariationsButton: document.querySelector("#compareVariationsButton"), characterDescription: document.querySelector("#characterDescription"),
  mudInput: document.querySelector("#mudInput"), boxInput: document.querySelector("#boxInput"), speakerInput: document.querySelector("#speakerInput"), mudValue: document.querySelector("#mudValue"), boxValue: document.querySelector("#boxValue"), speakerValue: document.querySelector("#speakerValue")
};



// ============================================================
// SE（Web Audio API）v13 音色工房
// 4波形ミキサー + ADSR + ローパス + 軽い歪み
// ============================================================
const DEFAULT_STATION_SOUND_SETTINGS = Object.freeze({
  openAirDuration: 3.2, openAirLevel: .86, openAirPitch: 2800, openLockPitch: 100, openLockLevel: .71, openVolume: 1.1,
  closeAirDuration: 3.2, closeAirLevel: .86, closeAirPitch: 2800, closeLockPitch: 100, closeLockLevel: .71, closeVolume: 1.1,
  doorAirStyle: "sharp", doorMechanicalStyle: "double", doorAirPulse: .35, doorRattle: 1,
  doorClunkDepth: .3, doorLockDelay: .3,
  boardingFrequency: 95, boardingSecondFrequency: 603, boardingSecondLevel: 0,
  boardingDuration: 4.2, boardingVolume: .5, boardingWave: "sawtooth", boardingStyle: "single-main",
  boardingTremolo: 5.5, boardingTremoloDepth: 0, boardingAttack: .001,
  boardingRelease: .2, boardingResonance: 1,
  boardingNoise: .06, boardingNoiseFreq: 1100,
  boardingLowpass: 4460, boardingHighpass: 205
});
const stationSound = {...DEFAULT_STATION_SOUND_SETTINGS};

// v69.0 固定チャイム設定
const DOOR_CHIME_SETTINGS = Object.freeze({
  doorOpen:{timbre:"sineChime",note:"C♯",octave:5,detune:0,volume:.55,duration:1.4,release:1.2,harmonic:0,metal:0,softness:1,interval:8.5},
  doorChime:{timbre:"softBell",pinNote:"C♯",pinOctave:5,ponNote:"A",ponOctave:4,detune:0,volume:.82,pinDuration:.09,ponDuration:.66,noteGap:.4,repeatGap:.1,release:1.6,harmonic:0,metal:0,softness:1,overlap:0,repeats:2}
});
let doorOpenChimeTimer = null;

const DEFAULT_SOUND_SETTINGS = {
  preset:"custom", pinFrequency:739.98885, pongFrequency:587.32954,
  globalTuning:0, pinTuning:-3, pongTuning:-5,
  pinDuration:0.7, pinReleaseRatio:1, pongDuration:1.3, gap:0, overlap:0.4, volumeScale:0.9,
  pinSine:1,pinTriangle:0.24,pinSquare:0.6,pinSaw:0.46,
  pongSine:1,pongTriangle:0.3,pongSquare:0.55,pongSaw:0.46,
  pinAttack:0.024,pinDecay:0.01,pinSustain:0.59,pinEnvRelease:0.31,
  pongAttack:0.024,pongDecay:0.01,pongSustain:0.6,pongEnvRelease:0.28,
  pinFilter:500,pongFilter:500,pinDrive:0.23,pongDrive:0.21,
  family:"hazyResonance",variation:"A",mud:0.12,box:0.08,speaker:0.06,
  pinInharmonic:0.08,pongInharmonic:0.07,pinCompanionDetune:-4,pongCompanionDetune:-3,boxDelay:0.045
};
const sound={enabled:true,context:null,lastChimedAtc:null,...DEFAULT_SOUND_SETTINGS};
const DEFAULT_ALARM_SETTINGS={
  beepDuration:0.060,
  beepInterval:0.090,
  beepCount:9,
  setCount:3,
  setGap:0.49
};
const alarm={...DEFAULT_ALARM_SETTINGS};

// v69.6 確定ATC電子チャイム（Fine Tune v7.1 最終値）
// 「フィン→フォーン」の開始間隔は 0.265 秒。反響は同音程の短い初期反射だけに整理。
const FINAL_ATC_CHIME = Object.freeze({
  pinFrequency:739.98885,
  pongFrequency:587.32954,
  pinTuning:-3,
  pongTuning:-5,
  pinDuration:0.7,
  pongDuration:1.3,
  noteInterval:0.265,
  volumeScale:0.9,
  squareMix:0.7,
  sineMix:0.09,
  h2:0.37,
  h3:0.04,
  h4:0.2,
  pulseWidth:0.5,
  attack:0.014,
  glideCents:40,
  glideTime:0.05,
  bloom:0.16,
  releaseShape:0.81,
  cutoff:4002.8,
  resonance:0.8,
  speakerLow:148.1,
  saturation:0.04,
  chorus:0,
  noise:0.005,
  room:0.0105,
  volume:0.74,
  reflectionClean:1,
  eq:[2,-4,-1,1.2,3.5,1.42,-2.13,-9]
});
const LEGACY_FAMILY_MAP={muddyBell:"softMuddy",boxed:"warmBox",speaker:"clothSpeaker",oldUnit:"resinBell",resonant:"hazyResonance",dry:"mellowBell"};


const TONE_FAMILIES = {
  softMuddy:{label:"やわらかい濁りベル",description:"角を抑え、近い音と非整数倍音を薄く重ねた、やわらかく濁る電子ベル。",base:{pinSine:.68,pinTriangle:.29,pinSquare:.03,pinSaw:0,pongSine:.78,pongTriangle:.21,pongSquare:.01,pongSaw:0,pinFilter:3300,pongFilter:2850,pinDrive:.018,pongDrive:.012,pinInharmonic:.19,pongInharmonic:.14,pinCompanionDetune:-8,pongCompanionDetune:-5,boxDelay:.034}},
  mellowBell:{label:"丸い電子ベル",description:"サイン波中心で輪郭を丸めた、耳当たりのやさしい電子ベル。",base:{pinSine:.78,pinTriangle:.21,pinSquare:.01,pinSaw:0,pongSine:.87,pongTriangle:.13,pongSquare:0,pongSaw:0,pinFilter:3700,pongFilter:3150,pinDrive:.010,pongDrive:.007,pinInharmonic:.10,pongInharmonic:.075,pinCompanionDetune:-5,pongCompanionDetune:-3,boxDelay:.030}},
  warmBox:{label:"あたたかい箱鳴り",description:"木や樹脂の筐体に収まったような、短い反射と中低域の丸い響き。",base:{pinSine:.64,pinTriangle:.34,pinSquare:.02,pinSaw:0,pongSine:.79,pongTriangle:.20,pongSquare:.01,pongSaw:0,pinFilter:3050,pongFilter:2650,pinDrive:.016,pongDrive:.011,pinInharmonic:.12,pongInharmonic:.10,pinCompanionDetune:-5,pongCompanionDetune:-4,boxDelay:.050}},
  clothSpeaker:{label:"やわらかいスピーカー",description:"高域を穏やかに丸め、布越しの小型スピーカーのように少しこもる音。",base:{pinSine:.61,pinTriangle:.35,pinSquare:.04,pinSaw:0,pongSine:.75,pongTriangle:.23,pongSquare:.02,pongSaw:0,pinFilter:2550,pongFilter:2250,pinDrive:.024,pongDrive:.017,pinInharmonic:.10,pongInharmonic:.085,pinCompanionDetune:-4,pongCompanionDetune:-3,boxDelay:.027}},
  resinBell:{label:"樹脂質チャイム",description:"金属の硬さを抑え、樹脂製の発音体のような柔らかな芯を持つチャイム。",base:{pinSine:.58,pinTriangle:.39,pinSquare:.03,pinSaw:0,pongSine:.72,pongTriangle:.27,pongSquare:.01,pongSaw:0,pinFilter:3450,pongFilter:2950,pinDrive:.020,pongDrive:.014,pinInharmonic:.15,pongInharmonic:.11,pinCompanionDetune:-7,pongCompanionDetune:-4,boxDelay:.039}},
  hazyResonance:{label:"霞んだ共鳴ベル",description:"高域を抑えた共鳴が後ろにふわっと残る、霞んだやわらかいベル。",base:{pinSine:.72,pinTriangle:.27,pinSquare:.01,pinSaw:0,pongSine:.84,pongTriangle:.16,pongSquare:0,pongSaw:0,pinFilter:3000,pongFilter:2500,pinDrive:.012,pongDrive:.008,pinInharmonic:.25,pongInharmonic:.22,pinCompanionDetune:-7,pongCompanionDetune:-5,boxDelay:.060}}
};
const VARIATIONS={
 A:{label:"A・素直で軽め",mud:.24,box:.18,speaker:.12,driveMul:.62,inharmMul:.68,filterMul:1.12},
 B:{label:"B・丸くやわらかい",mud:.43,box:.38,speaker:.28,driveMul:.78,inharmMul:.92,filterMul:.94},
 C:{label:"C・低い共鳴",mud:.56,box:.68,speaker:.31,driveMul:.82,inharmMul:1.22,filterMul:.80},
 D:{label:"D・霞み／こもり強め",mud:.66,box:.54,speaker:.72,driveMul:.92,inharmMul:1.10,filterMul:.66}
};
function applyToneCharacter(family=sound.family,variation=sound.variation,{preview=true}={}){
 const f=TONE_FAMILIES[family]||TONE_FAMILIES.softMuddy,v=VARIATIONS[variation]||VARIATIONS.B,b=f.base;
 Object.assign(sound,b,{family,variation,preset:family,mud:v.mud,box:v.box,speaker:v.speaker});
 sound.pinDrive=Math.min(.30,b.pinDrive*v.driveMul);sound.pongDrive=Math.min(.30,b.pongDrive*v.driveMul);
 sound.pinInharmonic=Math.min(.7,b.pinInharmonic*v.inharmMul);sound.pongInharmonic=Math.min(.7,b.pongInharmonic*v.inharmMul);
 sound.pinFilter=Math.round(b.pinFilter*v.filterMul);sound.pongFilter=Math.round(b.pongFilter*v.filterMul);
 updateSoundSettingsDisplay();saveSoundSettings();if(preview&&sound.enabled)playAtcChime();
}
function applyMacroControls({preview=false}={}){
 sound.mud=+ui.mudInput.value/100;sound.box=+ui.boxInput.value/100;sound.speaker=+ui.speakerInput.value/100;sound.preset='custom';
 updateSoundSettingsDisplay();saveSoundSettings();if(preview&&sound.enabled)playAtcChime();
}
async function compareVariations(){
 const family=ui.toneFamilySelect.value;ui.compareVariationsButton.disabled=true;
 for(const v of ['A','B','C','D']){ui.toneVariationSelect.value=v;applyToneCharacter(family,v,{preview:true});await new Promise(r=>setTimeout(r,2300));}
 ui.compareVariationsButton.disabled=false;
}

function ensureAudioContext(){
  if(!sound.context){
    const A=window.AudioContext||window.webkitAudioContext;
    if(!A)return null;
    sound.context=new A();
  }
  return sound.context;
}

// v70.7.15: 最初のユーザー操作で音声系を確実に解錠する。
// 自動イベント時に resume() の Promise を保留し、数十秒後の戸閉操作で
// ATCチャイムだけ遅れて鳴る現象を防ぐ。
function unlockSimulatorAudio(){
  const c=ensureAudioContext();
  if(!c)return;
  if(c.state!=="running"){
    Promise.resolve(c.resume?.()).catch(()=>{});
  }
}
["pointerdown","keydown","touchstart"].forEach(type=>{
  document.addEventListener(type,unlockSimulatorAudio,{capture:true,passive:true});
});

// ------------------------------------------------------------
// v69.3 軌道ジョイント・分岐器通過音
// 分岐器は最前台車中心を基準に、進入・退出それぞれで
// 右レール→左レールの順に独立した単発衝撃音を鳴らす。
// ------------------------------------------------------------
// 描画側で実際に生成している分岐区間から、通過音マーカーを共通生成する。
// 数字だけを別に手入力しないため、見た目のポイント位置と音判定がずれない。
const makeRailPairHits = (baseId, markerM, phase) => [
  { id: `${baseId}-right`, markerM, side: "right", phase },
  { id: `${baseId}-left`, markerM: markerM + 1.2, side: "left", phase }
];

const SAKURANO_GEOMETRY = Object.freeze({
  lengthM: 420,
  startM: ROUTE.passStation.position - 420,
  approachStartM: ROUTE.passStation.position - 420 - 420,
  approachEndM: ROUTE.passStation.position - 420 - 80,
  departureStartM: ROUTE.passStation.position + 80,
  departureEndM: ROUTE.passStation.position + 420
});

const TERMINAL_GEOMETRY = Object.freeze({
  lengthM: 440,
  startM: ROUTE.stopPosition - 440,
  approachStartM: ROUTE.stopPosition - 440 - 520,
  approachEndM: ROUTE.stopPosition - 440 - 80
});

const VISUAL_SWITCH_HITS = Object.freeze([
  // 旭ヶ丘：addDepartureStation() の switchStartM / switchEndM と同一。
  ...makeRailPairHits("asahigaoka-entry", DEPARTURE_GEOMETRY.switchStartM, "entry"),
  ...makeRailPairHits("asahigaoka-exit", DEPARTURE_GEOMETRY.switchEndM, "exit"),

  // 桜野：addRelativeFourTrackStation() の4つの分岐端点と同一。
  ...makeRailPairHits("sakurano-approach-toe", SAKURANO_GEOMETRY.approachStartM, "entry"),
  ...makeRailPairHits("sakurano-approach-frog", SAKURANO_GEOMETRY.approachEndM, "exit"),
  ...makeRailPairHits("sakurano-departure-toe", SAKURANO_GEOMETRY.departureStartM, "entry"),
  ...makeRailPairHits("sakurano-departure-frog", SAKURANO_GEOMETRY.departureEndM, "exit"),

  // 潮見中央：addFourTrackStation(... length:440) の進入側分岐端点と同一。
  ...makeRailPairHits("shiomi-approach-toe", TERMINAL_GEOMETRY.approachStartM, "entry"),
  ...makeRailPairHits("shiomi-approach-frog", TERMINAL_GEOMETRY.approachEndM, "exit")
]);

const TRACK_SOUND = Object.freeze({
  regularJointIntervalM: 1000,
  frontBogieOffsetFromNoseM: 4.0,
  switchRailOffsetM: 1.2,
  switchHits: VISUAL_SWITCH_HITS
});

// DevTools で発火履歴を確認できる。ゲーム表示や操作には影響しない。
window.__POINT_SOUND_LOG__ = [];
window.__POINT_SOUND_MARKERS__ = VISUAL_SWITCH_HITS.map(hit => ({...hit}));
window.__POINT_SOUND_TEST__ = (side = "right", phase = "entry", speedKmh = 100) =>
  playSwitchWheelHit(Number(speedKmh) || 100, {side, phase});

function recordPointSoundHit(hit, frontBogieM, speedKmh) {
  const row = {
    id: hit.id,
    phase: hit.phase,
    side: hit.side,
    markerM: hit.markerM,
    frontBogieM: Number(frontBogieM.toFixed(3)),
    speedKmh: Number(speedKmh.toFixed(2)),
    time: new Date().toISOString()
  };
  window.__POINT_SOUND_LOG__.push(row);
  console.info("[POINT SOUND v69.3]", row);
}

function playSwitchWheelHit(speedKmh = 0, options = {}) {
  const c = ensureAudioContext();
  if (!c || !sound.enabled) return false;

  // resume() は Promise だが、既に走行音が鳴っている場合は running。
  // 万一 suspended のままなら復帰後に再生する。
  if (c.state === "suspended") {
    c.resume().then(() => playSwitchWheelHit(speedKmh, options)).catch(() => {});
    return false;
  }

  const now = c.currentTime + 0.006;
  const phaseTone = options.phase === "exit" ? 0.94 : 1;
  const panValue = options.side === "right" ? 0.12 : -0.12;
  // 低速・高速とも確実に聞こえる固定基準。速度は音色だけに薄く反映。
  const speedTone = clamp(speedKmh / 180, 0, 1);
  const peak = 0.42 * sound.volumeScale;

  const master = c.createGain();
  const compressor = c.createDynamicsCompressor();
  compressor.threshold.value = -28;
  compressor.knee.value = 16;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.16;

  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + 0.004);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
  master.connect(compressor);

  if (typeof c.createStereoPanner === "function") {
    const panner = c.createStereoPanner();
    panner.pan.value = panValue;
    compressor.connect(panner).connect(c.destination);
  } else {
    compressor.connect(c.destination);
  }

  // 車体へ伝わる「ガタン」の芯。以前より約4倍強くした。
  const body = c.createOscillator();
  const bodyGain = c.createGain();
  body.type = "triangle";
  body.frequency.setValueAtTime((128 + speedTone * 18) * phaseTone, now);
  body.frequency.exponentialRampToValueAtTime(47 * phaseTone, now + 0.25);
  bodyGain.gain.setValueAtTime(0.72, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.27);
  body.connect(bodyGain).connect(master);
  body.start(now);
  body.stop(now + 0.29);

  // 台車枠・レールの中低域衝撃。
  const thud = c.createOscillator();
  const thudGain = c.createGain();
  thud.type = "sine";
  thud.frequency.setValueAtTime(76 * phaseTone, now);
  thud.frequency.exponentialRampToValueAtTime(39 * phaseTone, now + 0.20);
  thudGain.gain.setValueAtTime(0.54, now);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.23);
  thud.connect(thudGain).connect(master);
  thud.start(now);
  thud.stop(now + 0.25);

  // 短い金属接触音。
  const metal = c.createOscillator();
  const metalGain = c.createGain();
  metal.type = "square";
  metal.frequency.setValueAtTime((820 + speedTone * 180) * phaseTone, now);
  metal.frequency.exponentialRampToValueAtTime(360 * phaseTone, now + 0.052);
  metalGain.gain.setValueAtTime(0.17, now);
  metalGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
  metal.connect(metalGain).connect(master);
  metal.start(now);
  metal.stop(now + 0.08);

  // 接触面のざらつき。
  const len = Math.max(1, Math.floor(c.sampleRate * 0.12));
  const buffer = c.createBuffer(1, len, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 2.2);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const noise = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const noiseGain = c.createGain();
  noise.buffer = buffer;
  filter.type = "bandpass";
  filter.frequency.value = (980 + speedTone * 240) * phaseTone;
  filter.Q.value = 0.75;
  noiseGain.gain.value = 0.16;
  noise.connect(filter).connect(noiseGain).connect(master);
  noise.start(now);
  noise.stop(now + len / c.sampleRate);
  return true;
}

function playTrackImpactSound(kind = "joint", speedKmh = 0, options = {}) {
  if (kind === "switch") return playSwitchWheelHit(speedKmh, options);

  const c = ensureAudioContext();
  if (!c || !sound.enabled || speedKmh < 1) return false;
  const cfg = {volume:.09,bodyFreq:145,endFreq:85,duration:.18,metalFreq:1050,metalQ:.8,noise:.22,hits:2,hitGap:.075,bodyLevel:1};
  const now = c.currentTime, speedGain = clamp(speedKmh / 160, .18, 1);
  for (let hit = 0; hit < cfg.hits; hit++) {
    const at = now + hit * cfg.hitGap;
    const master = c.createGain();
    const hitFalloff = hit === 0 ? 1 : .72;
    master.gain.setValueAtTime(Math.max(.0001, cfg.volume * speedGain * hitFalloff * sound.volumeScale), at);
    master.gain.exponentialRampToValueAtTime(.0001, at + cfg.duration);
    master.connect(c.destination);
    const body = c.createOscillator(), bodyGain = c.createGain();
    body.type = "sine";
    body.frequency.setValueAtTime(cfg.bodyFreq, at);
    body.frequency.exponentialRampToValueAtTime(cfg.endFreq, at + cfg.duration * .82);
    bodyGain.gain.value = cfg.bodyLevel;
    body.connect(bodyGain).connect(master); body.start(at); body.stop(at + cfg.duration + .02);
    const len = Math.max(1, Math.floor(c.sampleRate * Math.min(cfg.duration, .13)));
    const buffer = c.createBuffer(1, len, c.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) * cfg.noise;
    const noise = c.createBufferSource(), filter = c.createBiquadFilter();
    noise.buffer = buffer; filter.type = "bandpass"; filter.frequency.value = cfg.metalFreq; filter.Q.value = cfg.metalQ;
    noise.connect(filter).connect(master); noise.start(at); noise.stop(at + len / c.sampleRate);
  }
  return true;
}

function updateTrackJointSounds(previousPositionM, currentPositionM) {
  if (currentPositionM <= previousPositionM) return;
  const speedKmh = mpsToKmh(train.speedMps);
  const previousFrontBogieM = previousPositionM - TRACK_SOUND.frontBogieOffsetFromNoseM;
  const currentFrontBogieM = currentPositionM - TRACK_SOUND.frontBogieOffsetFromNoseM;

  for (const hit of TRACK_SOUND.switchHits) {
    const key = `track-switch-${hit.id}`;
    const crossed = previousFrontBogieM < hit.markerM && currentFrontBogieM >= hit.markerM;
    if (crossed && !train.eventFlags.has(key)) {
      train.eventFlags.add(key);
      recordPointSoundHit(hit, currentFrontBogieM, speedKmh);
      playSwitchWheelHit(speedKmh, {side: hit.side, phase: hit.phase});
    }
  }

  const interval = TRACK_SOUND.regularJointIntervalM;
  const first = Math.max(1, Math.floor(previousPositionM / interval) + 1);
  const last = Math.floor(currentPositionM / interval);
  for (let index = first; index <= last; index++) {
    const marker = index * interval;
    const key = `track-joint-${marker}`;
    if (!train.eventFlags.has(key)) {
      train.eventFlags.add(key);
      playTrackImpactSound("joint", speedKmh);
    }
  }
}

// ------------------------------------------------------------
// 速度・ノッチ・ブレーキに追従するリアルタイム走行音
// 外部音源を使わず、PWMキャリア音・側帯波・段階切替を重ねてVVVFらしさを作る。
// ------------------------------------------------------------
const motorSound = {
  initialized:false, master:null,
  tractionContinuousGain:null, tractionStepGain:null,
  regenContinuousGain:null, regenStepGain:null,
  windGain:null, windWhistleGain:null, brakeSquealGain:null,
  tractionContinuousFilter:null, tractionStepFilter:null,
  regenContinuousFilter:null, regenStepFilter:null,
  tractionContinuous:null, regenContinuous:null,
  tractionStepA:null, tractionStepB:null,
  regenStepA:null, regenStepB:null,
  rumbleGain:null, rumbleOscillator:null,
  windFilter:null, windWhistleFilter:null, brakeSquealFilter:null, brakeSqueal:null
};

const DEFAULT_RUNNING_SOUND_MIX = Object.freeze({
  motor: 2.15,
  coast: 2.23,
  regen: 2.63,
  wind: 1.75
});
const MOTOR_LAB = Object.freeze({
  pitch: 1.8,
  stepPitch: 1.45,
  body: 2.13,
  harmonic: 0.9,
  filter: 1.01
});
const MOTOR_SOUND_TUNING = Object.freeze({
  timbre: "clear",
  continuous: Object.freeze({
    fundamentalLevel: 0.48,
    harmonicLevel: 0.12,
    harmonicRatio: 1.7,
    bodyLevel: 0.35
  }),
  vvvf: Object.freeze({
    mainLevel: 0.27,
    upperLevel: 0.185,
    lowerLevel: 0.18,
    upperRatio: 2.01,
    lowerRatio: 0.45,
    holdRatio: 0.18,
    frequencyTimeConstant: 0.09,
    crossfadeKmh: 1.8,
    crossfadeSeconds: 0.20,
    stepsScale: 1.1
  }),
  effects: Object.freeze({
    rumbleLevel: 0.43,
    rumbleHz: 79,
    rumbleSpeedGain: 0.4,
    rumbleBeat: 0.02,
    fmAmount: 0.55,
    fmRate: 8,
    pwmAmount: 0.2,
    noiseLevel: 0,
    drive: 0,
    lowpassHz: 2200,
    masterVolume: 0.52
  })
});
const runningSoundMix = {...DEFAULT_RUNNING_SOUND_MIX};

function loadRunningSoundMix(){
  Object.assign(runningSoundMix, DEFAULT_RUNNING_SOUND_MIX);
}
function saveRunningSoundMix(){
  try{ localStorage.setItem("shinkansenRunningSoundMix",JSON.stringify(runningSoundMix)); }catch(_){}
}
function updateRunningSoundMixDisplay(){
  const pairs=[
    ["motor",ui.motorVolumeInput,ui.motorVolumeOutput],
    ["coast",ui.coastVolumeInput,ui.coastVolumeOutput],
    ["regen",ui.regenVolumeInput,ui.regenVolumeOutput],
    ["wind",ui.windVolumeInput,ui.windVolumeOutput]
  ];
  for(const [key,input,output] of pairs){
    if(input) input.value=Math.round(runningSoundMix[key]*100);
    if(output) output.textContent=`${Math.round(runningSoundMix[key]*100)}%`;
  }
}
function bindRunningSoundMixer(){
  const pairs=[
    ["motor",ui.motorVolumeInput,ui.motorVolumeOutput],
    ["coast",ui.coastVolumeInput,ui.coastVolumeOutput],
    ["regen",ui.regenVolumeInput,ui.regenVolumeOutput],
    ["wind",ui.windVolumeInput,ui.windVolumeOutput]
  ];
  for(const [key,input,output] of pairs){
    if(!input) continue;
    input.addEventListener("input",()=>{
      initializeMotorSound();
      runningSoundMix[key]=Number(input.value)/100;
      if(output) output.textContent=`${input.value}%`;
      saveRunningSoundMix();
    });
  }
}


function createContinuousMotorBank(c, destination){
  const tuning=MOTOR_SOUND_TUNING.continuous;

  const fundamental=c.createOscillator(), fundamentalGain=c.createGain();
  fundamental.type='sine'; fundamentalGain.gain.value=tuning.fundamentalLevel;
  fundamental.connect(fundamentalGain); fundamentalGain.connect(destination); fundamental.start();

  // clear音色は主音・倍音ともサイン波にして、耳へ刺さる角を抑える。
  const harmonic=c.createOscillator(), harmonicGain=c.createGain();
  harmonic.type='sine'; harmonicGain.gain.value=tuning.harmonicLevel;
  harmonic.connect(harmonicGain); harmonicGain.connect(destination); harmonic.start();

  const body=c.createOscillator(), bodyGain=c.createGain();
  body.type='sine'; bodyGain.gain.value=tuning.bodyLevel;
  body.connect(bodyGain); bodyGain.connect(destination); body.start();

  return {fundamental,fundamentalGain,harmonic,harmonicGain,body,bodyGain};
}

function createSteppedWhineBank(c, destination){
  const tuning=MOTOR_SOUND_TUNING.vvvf;
  const crossfadeGain=c.createGain(); crossfadeGain.gain.value=.0001;
  crossfadeGain.connect(destination);

  const whine=c.createOscillator(), whineGain=c.createGain();
  whine.type='sine'; whineGain.gain.value=tuning.mainLevel;
  whine.connect(whineGain); whineGain.connect(crossfadeGain); whine.start();

  const upper=c.createOscillator(), upperGain=c.createGain();
  upper.type='sine'; upperGain.gain.value=tuning.upperLevel;
  upper.connect(upperGain); upperGain.connect(crossfadeGain); upper.start();

  const lower=c.createOscillator(), lowerGain=c.createGain();
  lower.type='sine'; lowerGain.gain.value=tuning.lowerLevel;
  lower.connect(lowerGain); lowerGain.connect(crossfadeGain); lower.start();

  return {crossfadeGain,whine,whineGain,upper,upperGain,lower,lowerGain};
}

function initializeMotorSound(){
  const c=ensureAudioContext();
  if(!c || motorSound.initialized) return;
  const master=c.createGain(); master.gain.value=0.0001; master.connect(c.destination);

  // 連続モーター音と段階VVVF音を別バスに分離。
  // これにより、惰行中も速度連動モーターだけを薄く残せる。
  const tractionContinuousGain=c.createGain(); tractionContinuousGain.gain.value=0.0001; tractionContinuousGain.connect(master);
  const tractionStepGain=c.createGain(); tractionStepGain.gain.value=0.0001; tractionStepGain.connect(master);
  const regenContinuousGain=c.createGain(); regenContinuousGain.gain.value=0.0001; regenContinuousGain.connect(master);
  const regenStepGain=c.createGain(); regenStepGain.gain.value=0.0001; regenStepGain.connect(master);
  const windGain=c.createGain(); windGain.gain.value=0.0001; windGain.connect(master);
  const windWhistleGain=c.createGain(); windWhistleGain.gain.value=0.0001; windWhistleGain.connect(master);
  const brakeSquealGain=c.createGain(); brakeSquealGain.gain.value=0.0001; brakeSquealGain.connect(master);

  const tractionContinuousFilter=c.createBiquadFilter(); tractionContinuousFilter.type='lowpass'; tractionContinuousFilter.frequency.value=3000; tractionContinuousFilter.Q.value=.72; tractionContinuousFilter.connect(tractionContinuousGain);
  const tractionStepFilter=c.createBiquadFilter(); tractionStepFilter.type='lowpass'; tractionStepFilter.frequency.value=3100; tractionStepFilter.Q.value=.78; tractionStepFilter.connect(tractionStepGain);
  const regenContinuousFilter=c.createBiquadFilter(); regenContinuousFilter.type='lowpass'; regenContinuousFilter.frequency.value=3000; regenContinuousFilter.Q.value=.72; regenContinuousFilter.connect(regenContinuousGain);
  const regenStepFilter=c.createBiquadFilter(); regenStepFilter.type='lowpass'; regenStepFilter.frequency.value=3100; regenStepFilter.Q.value=.78; regenStepFilter.connect(regenStepGain);

  const tractionContinuous=createContinuousMotorBank(c,tractionContinuousFilter);
  const regenContinuous=createContinuousMotorBank(c,regenContinuousFilter);

  // VVVFは2系統を常時用意し、速度帯境界だけ等電力クロスフェードする。
  const tractionStepA=createSteppedWhineBank(c,tractionStepFilter);
  const tractionStepB=createSteppedWhineBank(c,tractionStepFilter);
  const regenStepA=createSteppedWhineBank(c,regenStepFilter);
  const regenStepB=createSteppedWhineBank(c,regenStepFilter);

  const rumbleGain=c.createGain(); rumbleGain.gain.value=.0001; rumbleGain.connect(master);
  const rumbleOscillator=c.createOscillator();
  rumbleOscillator.type='sine';
  rumbleOscillator.connect(rumbleGain);
  rumbleOscillator.start();

  const noise=createNoiseBuffer(c,2.0);
  const src=c.createBufferSource(); src.buffer=noise; src.loop=true;
  const windFilter=c.createBiquadFilter(); windFilter.type='bandpass'; windFilter.frequency.value=900; windFilter.Q.value=.55;
  src.connect(windFilter); windFilter.connect(windGain); src.start();

  const whistleSrc=c.createBufferSource(); whistleSrc.buffer=noise; whistleSrc.loop=true;
  const windWhistleFilter=c.createBiquadFilter(); windWhistleFilter.type='bandpass'; windWhistleFilter.frequency.value=2400; windWhistleFilter.Q.value=3.2;
  whistleSrc.connect(windWhistleFilter); windWhistleFilter.connect(windWhistleGain); whistleSrc.start();

  // 停止直前の機械ブレーキ音。
  // 広い金属摩擦ノイズに、狭い共鳴と不規則なビートを重ねて「耳障りなキィーッ」を作る。
  const brakeSquealFilter=c.createBiquadFilter(); brakeSquealFilter.type='highpass'; brakeSquealFilter.frequency.value=1450; brakeSquealFilter.Q.value=.68; brakeSquealFilter.connect(brakeSquealGain);

  const squealNoise=c.createBufferSource(); squealNoise.buffer=noise; squealNoise.loop=true;
  const scrapeFilter=c.createBiquadFilter(); scrapeFilter.type='bandpass'; scrapeFilter.frequency.value=3050; scrapeFilter.Q.value=2.3;
  const scrapeGain=c.createGain(); scrapeGain.gain.value=.84;
  squealNoise.connect(scrapeFilter); scrapeFilter.connect(scrapeGain); scrapeGain.connect(brakeSquealFilter); squealNoise.start();

  const raspNoise=c.createBufferSource(); raspNoise.buffer=noise; raspNoise.loop=true;
  const raspFilter=c.createBiquadFilter(); raspFilter.type='bandpass'; raspFilter.frequency.value=4850; raspFilter.Q.value=5.2;
  const raspGain=c.createGain(); raspGain.gain.value=.34;
  raspNoise.connect(raspFilter); raspFilter.connect(raspGain); raspGain.connect(brakeSquealFilter); raspNoise.start();

  const ringA=c.createOscillator(), ringAGain=c.createGain();
  ringA.type='triangle'; ringAGain.gain.value=.13; ringA.connect(ringAGain); ringAGain.connect(brakeSquealFilter); ringA.start();
  const ringB=c.createOscillator(), ringBGain=c.createGain();
  ringB.type='sawtooth'; ringBGain.gain.value=.058; ringB.connect(ringBGain); ringBGain.connect(brakeSquealFilter); ringB.start();
  const ringC=c.createOscillator(), ringCGain=c.createGain();
  ringC.type='square'; ringCGain.gain.value=.018; ringC.connect(ringCGain); ringCGain.connect(brakeSquealFilter); ringC.start();

  const brakeSqueal={ringA,ringB,ringC,ringAGain,ringBGain,ringCGain,scrapeFilter,raspFilter,scrapeGain,raspGain};

  Object.assign(motorSound,{initialized:true,master,
    tractionContinuousGain,tractionStepGain,regenContinuousGain,regenStepGain,
    windGain,windWhistleGain,brakeSquealGain,
    tractionContinuousFilter,tractionStepFilter,regenContinuousFilter,regenStepFilter,
    tractionContinuous,regenContinuous,
    tractionStepA,tractionStepB,regenStepA,regenStepB,
    rumbleGain,rumbleOscillator,
    windFilter,windWhistleFilter,brakeSquealFilter,brakeSqueal});
}

function getSteppedWhineBands(){
  const scale=MOTOR_SOUND_TUNING.vvvf.stepsScale;
  return [
    {min:0,   max:22,  from:118, to:168, steps:Math.max(2,Math.round(5*scale))},
    {min:22,  max:48,  from:146, to:216, steps:Math.max(2,Math.round(6*scale))},
    {min:48,  max:82,  from:184, to:272, steps:Math.max(2,Math.round(7*scale))},
    {min:82,  max:125, from:224, to:326, steps:Math.max(2,Math.round(7*scale))},
    {min:125, max:175, from:270, to:374, steps:Math.max(2,Math.round(7*scale))},
    {min:175, max:230, from:312, to:414, steps:Math.max(2,Math.round(6*scale))},
    {min:230, max:340, from:354, to:456, steps:Math.max(2,Math.round(6*scale))}
  ];
}

function getSteppedWhineProfileInBand(speed,band,bandIndex){
  const tuning=MOTOR_SOUND_TUNING.vvvf;
  const bandProgress=clamp((speed-band.min)/(band.max-band.min),0,1);
  const scaled=bandProgress*Math.max(1,band.steps-1);
  const stepIndex=Math.min(band.steps-1,Math.floor(scaled));
  const localProgress=scaled-stepIndex;
  const rawBlend=clamp(
    (localProgress-tuning.holdRatio)/(1-tuning.holdRatio),
    0,1
  );
  const smoothBlend=rawBlend*rawBlend*(3-2*rawBlend);
  const currentStep=band.steps<=1 ? 0 : stepIndex/(band.steps-1);
  const nextStep=band.steps<=1 ? 0 : Math.min(stepIndex+1,band.steps-1)/(band.steps-1);
  const steppedProgress=currentStep+(nextStep-currentStep)*smoothBlend;
  return {
    stage:bandIndex,
    substage:stepIndex,
    frequency:band.from+(band.to-band.from)*steppedProgress
  };
}

function getDualSteppedWhineProfile(speed){
  const tuning=MOTOR_SOUND_TUNING.vvvf;
  const bands=getSteppedWhineBands();
  const v=clamp(speed,0,340);
  let bandIndex=bands.length-1;
  for(let i=0;i<bands.length;i++){
    if(v<bands[i].max || i===bands.length-1){bandIndex=i;break;}
  }

  const primary=getSteppedWhineProfileInBand(v,bands[bandIndex],bandIndex);
  const halfWidth=tuning.crossfadeKmh*.5;

  if(bandIndex>0 && Math.abs(v-bands[bandIndex].min)<=halfWidth){
    const boundary=bands[bandIndex].min;
    const mix=clamp((v-(boundary-halfWidth))/tuning.crossfadeKmh,0,1);
    const previous=getSteppedWhineProfileInBand(
      clamp(v,bands[bandIndex-1].min,bands[bandIndex-1].max-.001),
      bands[bandIndex-1],
      bandIndex-1
    );
    return {a:previous,b:primary,mix};
  }

  if(bandIndex<bands.length-1 && Math.abs(v-bands[bandIndex].max)<=halfWidth){
    const boundary=bands[bandIndex].max;
    const mix=clamp((v-(boundary-halfWidth))/tuning.crossfadeKmh,0,1);
    const next=getSteppedWhineProfileInBand(
      clamp(v,bands[bandIndex+1].min,bands[bandIndex+1].max-.001),
      bands[bandIndex+1],
      bandIndex+1
    );
    return {a:primary,b:next,mix};
  }

  return {a:primary,b:null,mix:0};
}

function setContinuousMotorBank(bank,speed,now,braking=false){
  const tuning=MOTOR_SOUND_TUNING.continuous;
  const speedRatio=clamp(speed/300,0,1.15);
  const rotor=(58+238*Math.pow(speedRatio,.72))*MOTOR_LAB.pitch;
  bank.fundamental.frequency.setTargetAtTime(rotor,now,.065);
  bank.harmonic.frequency.setTargetAtTime(rotor*tuning.harmonicRatio,now,.065);
  bank.body.frequency.setTargetAtTime((42+92*Math.pow(speedRatio,.62))*MOTOR_LAB.pitch,now,.08);
  bank.fundamentalGain.gain.setTargetAtTime(
    tuning.fundamentalLevel*(braking?.90:1),
    now,.08
  );
  bank.harmonicGain.gain.setTargetAtTime(
    tuning.harmonicLevel*MOTOR_LAB.harmonic*(braking?.92:1),
    now,.08
  );
  bank.bodyGain.gain.setTargetAtTime(
    tuning.bodyLevel*MOTOR_LAB.body*(braking?1.08:1),
    now,.08
  );
}

function setSteppedWhineBank(bank,profile,mixGain,now,braking=false){
  const tuning=MOTOR_SOUND_TUNING.vvvf;
  const f=profile.frequency*MOTOR_LAB.stepPitch;
  const follow=tuning.frequencyTimeConstant;

  // 毎フレーム予約をキャンセルせず、短い時定数で目標へ追従させる。
  bank.whine.frequency.setTargetAtTime(f,now,follow);
  bank.upper.frequency.setTargetAtTime(f*tuning.upperRatio,now,follow);
  bank.lower.frequency.setTargetAtTime(f*tuning.lowerRatio,now,follow);

  bank.whineGain.gain.setTargetAtTime(
    tuning.mainLevel*(braking?1.08:1),now,.08
  );
  bank.upperGain.gain.setTargetAtTime(
    tuning.upperLevel*(braking?1.05:1),now,.08
  );
  bank.lowerGain.gain.setTargetAtTime(
    tuning.lowerLevel*(braking?1.07:1),now,.08
  );
  bank.crossfadeGain.gain.setTargetAtTime(
    Math.max(.0001,mixGain),
    now,
    tuning.crossfadeSeconds
  );
}

function updateMotorSound(){
  if(!motorSound.initialized) return;
  const c=sound.context, now=c.currentTime, speed=mpsToKmh(train.speedMps);
  const speedRatio=clamp(speed/300,0,1.15);
  const tractionActive=train.running && train.powerNotch>0 && train.brakeNotch===0 && !train.emergencyBrake;
  const coastActive=train.running && speed>1 && train.powerNotch===0 && train.brakeNotch===0 && !train.emergencyBrake && train.atcBrakeDecel<=0;
  const notchRatio=tractionActive ? train.powerNotch/13 : 0;
  const brakingRatio=clamp(Math.max(train.brakeNotch/7,train.atcBrakeDecel/1.35),0,1);
  const positiveAcceleration=clamp(train.acceleration/0.85,0,1);
  const negativeAcceleration=clamp(-train.acceleration/1.35,0,1);
  const profile=getDualSteppedWhineProfile(speed);

  setContinuousMotorBank(motorSound.tractionContinuous,speed,now,false);
  setContinuousMotorBank(motorSound.regenContinuous,speed,now,true);

  const crossfadeAngle=profile.b ? profile.mix*Math.PI*.5 : 0;
  const mixA=profile.b ? Math.cos(crossfadeAngle) : 1;
  const mixB=profile.b ? Math.sin(crossfadeAngle) : .0001;
  setSteppedWhineBank(motorSound.tractionStepA,profile.a,mixA,now,false);
  setSteppedWhineBank(motorSound.tractionStepB,profile.b||profile.a,mixB,now,false);
  setSteppedWhineBank(motorSound.regenStepA,profile.a,mixA,now,true);
  setSteppedWhineBank(motorSound.regenStepB,profile.b||profile.a,mixB,now,true);

  const effects=MOTOR_SOUND_TUNING.effects;
  motorSound.tractionContinuousFilter.frequency.setTargetAtTime(effects.lowpassHz*MOTOR_LAB.filter,now,.08);
  motorSound.tractionStepFilter.frequency.setTargetAtTime((effects.lowpassHz+300)*MOTOR_LAB.filter,now,.08);
  motorSound.regenContinuousFilter.frequency.setTargetAtTime(effects.lowpassHz*MOTOR_LAB.filter,now,.08);
  motorSound.regenStepFilter.frequency.setTargetAtTime((effects.lowpassHz+300)*MOTOR_LAB.filter,now,.08);
  motorSound.windFilter.frequency.setTargetAtTime(520+speed*5.2,now,.08);
  motorSound.windWhistleFilter.frequency.setTargetAtTime(1450+speed*6.3,now,.07);

  const rumbleFrequency=effects.rumbleHz*(1+effects.rumbleSpeedGain*speedRatio);
  motorSound.rumbleOscillator.frequency.setTargetAtTime(rumbleFrequency,now,.08);

  // 速度連動型モーターは走行中ずっと薄く鳴らす。
  // 力行時に厚く、惰行時は控えめ、ブレーキ時は回生側へ自然に受け渡す。
  const rollingMotorBase=train.running && speed>1
    ? .013+.027*Math.pow(clamp(speed/300,0,1),.62)
    : .0001;
  const tractionContinuousLevel=(tractionActive
    ? rollingMotorBase+.030+.080*Math.pow(notchRatio,.74)+.048*positiveAcceleration
    : coastActive
      ? rollingMotorBase*runningSoundMix.coast
      : train.running && brakingRatio>0
        ? rollingMotorBase*.24
        : .0001) * runningSoundMix.motor;

  // 段階VVVF音は力行中のみ。惰行中まで鳴らさないことで、連続モーター層との役割を分ける。
  const tractionStepLevel=(tractionActive
    ? (.014+.062*Math.pow(notchRatio,.78)+.026*positiveAcceleration)*(.60+.40*speedRatio)
    : .0001) * runningSoundMix.motor;

  const regenLowSpeedFade=clamp((speed-8)/10,0,1);
  const regenContinuousLevel=(train.running && brakingRatio>0 && speed>3
    ? (.024+.085*Math.pow(brakingRatio,.72)+.042*negativeAcceleration)*(.52+.58*speedRatio)*regenLowSpeedFade
    : .0001) * runningSoundMix.regen;
  const regenStepLevel=(train.running && brakingRatio>0 && speed>3
    ? (.014+.058*Math.pow(brakingRatio,.76)+.024*negativeAcceleration)*(.55+.50*speedRatio)*regenLowSpeedFade
    : .0001) * runningSoundMix.regen;

  const windLevel=(train.running && speed>8 ? .005+.105*Math.pow(speedRatio,1.72) : .0001) * runningSoundMix.wind;
  const windWhistleLevel=(train.running && speed>35 ? .002+.085*Math.pow(clamp((speed-35)/265,0,1.1),1.55) : .0001) * runningSoundMix.wind;

  // 低速機械ブレーキ。耳鳴りのような固定純音ではなく、金属の擦れと鋭い共鳴を不規則に揺らす。
  const lowSpeedWindow=clamp((19-speed)/5.5,0,1)*clamp(speed/2.8,0,1);
  const brakeNotchPresence=clamp((brakingRatio-.05)/.95,0,1);
  const squealLevel=train.running && brakingRatio>0 && speed<19 && speed>.35
    ? (.014+.125*Math.pow(brakeNotchPresence,.70))*lowSpeedWindow
    : .0001;
  const squealBase=2450+speed*64;
  const irregular=Math.sin(now*7.9)*105+Math.sin(now*16.7)*48+Math.sin(now*2.1)*66;
  const scrapeCenter=squealBase+irregular;
  motorSound.brakeSqueal.scrapeFilter.frequency.setTargetAtTime(scrapeCenter,now,.04);
  motorSound.brakeSqueal.raspFilter.frequency.setTargetAtTime(scrapeCenter*1.56+Math.sin(now*12.8)*155,now,.038);
  motorSound.brakeSqueal.ringA.frequency.setTargetAtTime(scrapeCenter*.98,now,.035);
  motorSound.brakeSqueal.ringB.frequency.setTargetAtTime(scrapeCenter*1.035+Math.sin(now*5.7)*32,now,.032);
  motorSound.brakeSqueal.ringC.frequency.setTargetAtTime(scrapeCenter*1.88+Math.sin(now*9.3)*75,now,.03);

  // パッドが断続的に食いつくような粗い振幅変化。
  const chatter=.55+.45*Math.max(0,Math.sin(now*18.5+Math.sin(now*3.3)*1.7));
  const bite=.68+.32*Math.sin(now*21.2)*Math.sin(now*3.7);
  motorSound.brakeSqueal.scrapeGain.gain.setTargetAtTime(.68+.28*chatter,now,.026);
  motorSound.brakeSqueal.raspGain.gain.setTargetAtTime(.24+.24*Math.max(0,bite),now,.024);
  motorSound.brakeSqueal.ringAGain.gain.setTargetAtTime(.10+.075*chatter,now,.022);
  motorSound.brakeSqueal.ringBGain.gain.setTargetAtTime(.038+.040*Math.max(0,bite),now,.022);
  motorSound.brakeSqueal.ringCGain.gain.setTargetAtTime(.010+.020*chatter,now,.020);

  const masterLevel=sound.enabled ? 1 : .0001;
  motorSound.tractionContinuousGain.gain.setTargetAtTime(Math.max(.0001,tractionContinuousLevel),now,.08);
  motorSound.tractionStepGain.gain.setTargetAtTime(Math.max(.0001,tractionStepLevel),now,.07);
  motorSound.regenContinuousGain.gain.setTargetAtTime(Math.max(.0001,regenContinuousLevel),now,.06);
  motorSound.regenStepGain.gain.setTargetAtTime(Math.max(.0001,regenStepLevel),now,.06);
  motorSound.windGain.gain.setTargetAtTime(Math.max(.0001,windLevel),now,.12);
  motorSound.windWhistleGain.gain.setTargetAtTime(Math.max(.0001,windWhistleLevel),now,.14);
  motorSound.brakeSquealGain.gain.setTargetAtTime(Math.max(.0001,squealLevel),now,.055);
  const activeLoad=tractionActive ? notchRatio : brakingRatio;
  const rumblePulse=1+effects.rumbleBeat*Math.sin(now*5.2);
  const rumbleLevel=train.running && speed>1
    ? effects.rumbleLevel*(.18+.82*activeLoad)*(.45+.55*speedRatio)*rumblePulse
    : .0001;
  motorSound.rumbleGain.gain.setTargetAtTime(Math.max(.0001,rumbleLevel),now,.08);
  motorSound.master.gain.setTargetAtTime(
    masterLevel*effects.masterVolume,
    now,.05
  );
}

function makeDistortionCurve(amount){const n=2048,curve=new Float32Array(n),k=Math.max(0,amount)*120;for(let i=0;i<n;i++){const x=i*2/n-1;curve[i]=(1+k)*x/(1+k*Math.abs(x));}return curve;}
function scheduleEnvelope(gain,start,duration,attack,decay,sustain,release,peak){
  const a=Math.min(attack,duration*.3), d=Math.min(decay,Math.max(.01,duration-a-release));
  const relStart=Math.max(start+a+d,start+duration-release);
  gain.setValueAtTime(.0001,start); gain.exponentialRampToValueAtTime(Math.max(.0002,peak),start+a);
  gain.exponentialRampToValueAtTime(Math.max(.0002,peak*sustain),start+a+d);
  gain.setValueAtTime(Math.max(.0002,peak*sustain),relStart); gain.exponentialRampToValueAtTime(.0001,start+duration);
}
function makeFinalAtcCurve(amount){
  const n=1024,a=Math.max(.001,amount*16),arr=new Float32Array(n);
  for(let i=0;i<n;i++){const x=i*2/n-1;arr[i]=(1+a)*x/(1+a*Math.abs(x));}
  return arr;
}
function makeFinalAtcImpulse(c,seconds=.24,decay=5){
  const len=Math.max(1,Math.floor(c.sampleRate*seconds)),buf=c.createBuffer(2,len,c.sampleRate);
  // reflectionClean=1: ランダムな残響を使わず、音程を濁らせにくい短い初期反射だけを残す。
  for(let ch=0;ch<2;ch++){
    const data=buf.getChannelData(ch);
    for(let i=0;i<len;i++){
      const env=Math.pow(1-i/len,decay),ms=i/c.sampleRate*1000;
      let coherent=0;
      for(const tap of [18,31,47,69,96]){
        const dist=Math.abs(ms-tap);
        if(dist<.8)coherent+=(1-dist/.8)*env*(tap===18?.55:tap===31?.34:tap===47?.22:tap===69?.14:.08);
      }
      data[i]=coherent;
    }
  }
  return buf;
}
function makeFinalAtcPulseWave(c,width){
  const n=64,real=new Float32Array(n),imag=new Float32Array(n);
  for(let harmonic=1;harmonic<n;harmonic++)imag[harmonic]=2*Math.sin(Math.PI*harmonic*width)/(Math.PI*harmonic);
  return c.createPeriodicWave(real,imag,{disableNormalization:false});
}
function scheduleFinalAtcEnvelope(g,t,d,amp){
  const q=FINAL_ATC_CHIME,a=Math.max(.003,q.attack),hold=t+Math.min(d*.35,a+.10),end=t+d;
  g.cancelScheduledValues(t);g.setValueAtTime(.0001,t);
  g.exponentialRampToValueAtTime(Math.max(.0002,amp*(1-q.bloom*.35)),t+a);
  g.linearRampToValueAtTime(Math.max(.0002,amp),hold+q.bloom*d*.18);
  const mid=end-d*.16;
  g.exponentialRampToValueAtTime(Math.max(.00015,amp*(.08+q.releaseShape*.18)),Math.max(hold+.01,mid));
  g.exponentialRampToValueAtTime(.0001,end);
}
function buildFinalAtcChain(c){
  const q=FINAL_ATC_CHIME,input=c.createGain(),hp=c.createBiquadFilter(),lp=c.createBiquadFilter(),sat=c.createWaveShaper(),comp=c.createDynamicsCompressor(),dry=c.createGain(),wet=c.createGain(),conv=c.createConvolver(),master=c.createGain();
  hp.type='highpass';hp.frequency.value=q.speakerLow;hp.Q.value=.65;
  lp.type='lowpass';lp.frequency.value=q.cutoff;lp.Q.value=q.resonance;
  sat.curve=makeFinalAtcCurve(q.saturation);sat.oversample='2x';
  comp.threshold.value=-18;comp.knee.value=12;comp.ratio.value=3;comp.attack.value=.004;comp.release.value=.18;
  input.connect(hp);hp.connect(lp);lp.connect(sat);sat.connect(comp);
  comp.connect(dry);dry.gain.value=1;dry.connect(master);
  conv.buffer=makeFinalAtcImpulse(c,.22+q.room*1.2,5);comp.connect(conv);conv.connect(wet);
  wet.gain.value=q.room*(1-q.reflectionClean*.35);wet.connect(master);
  let prev=master;const hz=[63,125,250,500,1000,2000,4000,8000];
  q.eq.forEach((db,i)=>{const f=c.createBiquadFilter();f.type='peaking';f.frequency.value=hz[i];f.Q.value=1;f.gain.value=db;prev.connect(f);prev=f;});
  const out=c.createGain();out.gain.value=q.volume*q.volumeScale*(sound.volumeScale/DEFAULT_SOUND_SETTINGS.volumeScale);prev.connect(out);out.connect(c.destination);
  return input;
}
function addFinalAtcOsc(c,dest,type,f,t,d,amp,det=0,wave=null){
  const q=FINAL_ATC_CHIME,o=c.createOscillator(),g=c.createGain();
  if(wave)o.setPeriodicWave(wave);else o.type=type;
  o.frequency.setValueAtTime(f,t);o.detune.setValueAtTime(q.glideCents+det,t);o.detune.linearRampToValueAtTime(det,t+q.glideTime);
  scheduleFinalAtcEnvelope(g.gain,t,d,amp);o.connect(g);g.connect(dest);o.start(t);o.stop(t+d+.05);
}
function playSynthNote(kind,startTime){
  const c=ensureAudioContext();if(!c||!sound.enabled)return;
  const q=FINAL_ATC_CHIME,base=kind==='pin'?q.pinFrequency:q.pongFrequency,tuning=kind==='pin'?q.pinTuning:q.pongTuning;
  const f=base*Math.pow(2,tuning/1200),d=kind==='pin'?q.pinDuration:q.pongDuration,input=buildFinalAtcChain(c),pw=makeFinalAtcPulseWave(c,q.pulseWidth);
  addFinalAtcOsc(c,input,'sine',f,startTime,d,.42*q.sineMix);
  addFinalAtcOsc(c,input,'sine',f,startTime,d,.30*q.squareMix,0,pw);
  addFinalAtcOsc(c,input,'sine',f*2,startTime,d*.92,q.h2);
  if(q.h3>0)addFinalAtcOsc(c,input,'sine',f*3,startTime,d*.68,q.h3);
  if(q.h4>0)addFinalAtcOsc(c,input,'sine',f*4,startTime,d*.45,q.h4);
  if(q.noise>0){
    const len=Math.ceil(c.sampleRate*Math.min(.16,d)),b=c.createBuffer(1,len,c.sampleRate),x=b.getChannelData(0);
    for(let i=0;i<len;i++)x[i]=(Math.random()*2-1)*Math.pow(1-i/len,2);
    const src=c.createBufferSource(),bp=c.createBiquadFilter(),g=c.createGain();src.buffer=b;bp.type='bandpass';bp.frequency.value=kind==='pin'?2900:2200;bp.Q.value=1.2;g.gain.value=q.noise;src.connect(bp);bp.connect(g);g.connect(input);src.start(startTime);src.stop(startTime+len/c.sampleRate);
  }
}
function playAtcChime(){
  const c=ensureAudioContext();if(!c||!sound.enabled)return false;
  if(c.state!=="running") return false;
  const now=c.currentTime+.025;playSynthNote('pin',now);playSynthNote('pong',now+FINAL_ATC_CHIME.noteInterval);
  return true;
}

// 自動イベント用。
// suspended 中に「あとで鳴らす」予約は作らない。遅延発音の原因になるため、
// 現在この瞬間に再生できたかだけを返し、呼び出し側が次の物理ステップで再試行する。
function playAtcChimeGuaranteed(){
  const c=ensureAudioContext();
  if(!c||!sound.enabled) return false;
  if(c.state!=="running"){
    Promise.resolve(c.resume?.()).catch(()=>{});
    return false;
  }
  return playAtcChime();
}

// ATC 70ブレーキ警報：A5の短音を任意回数・任意テンポで鳴動
function play70BrakeAlarm(){
  const c=ensureAudioContext();
  if(!c||!sound.enabled)return;
  const start=c.currentTime+0.03;
  const frequency=880; // A5
  const beepDuration=Math.max(0.025,alarm.beepDuration);
  const beepInterval=Math.max(beepDuration+0.005,alarm.beepInterval);
  const beepCount=Math.max(1,Math.round(alarm.beepCount));
  const setCount=Math.max(1,Math.round(alarm.setCount));
  const setGap=Math.max(0,alarm.setGap);

  function beep(at){
    const filter=c.createBiquadFilter();
    filter.type='lowpass';
    filter.frequency.setValueAtTime(2600,at);
    const master=c.createGain();
    master.gain.setValueAtTime(0.0001,at);
    master.gain.exponentialRampToValueAtTime(0.11*sound.volumeScale,at+Math.min(0.006,beepDuration*0.18));
    master.gain.setValueAtTime(0.09*sound.volumeScale,at+beepDuration*0.55);
    master.gain.exponentialRampToValueAtTime(0.0001,at+beepDuration);
    filter.connect(master); master.connect(c.destination);

    [['sine',1],['square',0.16]].forEach(([type,level])=>{
      const osc=c.createOscillator();
      const gain=c.createGain();
      osc.type=type;
      osc.frequency.setValueAtTime(frequency,at);
      gain.gain.value=level;
      osc.connect(gain); gain.connect(filter);
      osc.start(at); osc.stop(at+beepDuration+0.02);
    });
  }

  const setLength=(beepCount-1)*beepInterval+beepDuration;
  for(let set=0;set<setCount;set++){
    const setStart=start+set*(setLength+setGap);
    for(let i=0;i<beepCount;i++)beep(setStart+i*beepInterval);
  }
}

function createNoiseBuffer(context, duration) {
  const frames = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < frames; i += 1) {
    const white = Math.random() * 2 - 1;
    last = last * 0.72 + white * 0.28;
    data[i] = last;
  }
  return buffer;
}

const driverVoice = { enabled: true, rate: 0.90, pitch: 0.72, volume: 0.98 };
let preferredMaleJapaneseVoice = null;
function chooseMaleJapaneseVoice(){
  if(!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const japanese = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith("ja"));
  const maleHint = /(keita|ichiro|takumi|naoki|daichi|kaito|otoya|male|男性|男声)/i;
  const femaleHint = /(haruka|ayumi|nanami|kyoko|sayaka|female|女性|女声)/i;
  preferredMaleJapaneseVoice = japanese.find(v => maleHint.test(`${v.name} ${v.voiceURI}`))
    || japanese.find(v => !femaleHint.test(`${v.name} ${v.voiceURI}`))
    || japanese[0]
    || null;
  return preferredMaleJapaneseVoice;
}
if("speechSynthesis" in window){
  chooseMaleJapaneseVoice();
  window.speechSynthesis.addEventListener?.("voiceschanged", chooseMaleJapaneseVoice);
}
function updateDriverVoiceDisplay(){
  if(ui.driverVoiceToggle) ui.driverVoiceToggle.checked = driverVoice.enabled;
  if(ui.driverVoiceStatus) ui.driverVoiceStatus.textContent = driverVoice.enabled ? "自動喚呼 ON・男性声優先" : "自動喚呼 OFF";
}
function speakDriverCall(text, spokenText = text, {cancel = true} = {}){
  if(!driverVoice.enabled || !sound.enabled || !("speechSynthesis" in window)) return;
  if(cancel) window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.lang = "ja-JP";
  utterance.rate = driverVoice.rate;
  utterance.pitch = driverVoice.pitch;
  utterance.volume = driverVoice.volume;
  const voice = preferredMaleJapaneseVoice || chooseMaleJapaneseVoice();
  if(voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
}
function speakDriverSequence(items){
  if(!driverVoice.enabled || !sound.enabled || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const voice = preferredMaleJapaneseVoice || chooseMaleJapaneseVoice();
  for(const item of items){
    const spoken = typeof item === "string" ? item : item.spoken;
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = "ja-JP";
    utterance.rate = driverVoice.rate;
    utterance.pitch = driverVoice.pitch;
    utterance.volume = driverVoice.volume;
    if(voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }
}
function callSignal(speed){ speakDriverCall(`信号${speed}`, `しんごう、${speed}`); }
function callTarget(speed){ speakDriverCall(`目標${speed}`, `もくひょう、${speed}`); }

const NOTE_SEMITONES={"C":0,"C♯":1,"D":2,"E♭":3,"E":4,"F":5,"F♯":6,"G":7,"A♭":8,"A":9,"B♭":10,"B":11};
function noteFrequency(note,octave,detune=0){const midi=12*(octave+1)+NOTE_SEMITONES[note];return 440*Math.pow(2,(midi-69+detune/100)/12);}

const DEPARTURE_SIGN_SOUND = Object.freeze({
  layers: [
    {wave:"sine",gain:.87,detune:-5},
    {wave:"triangle",gain:.12,detune:4},
    {wave:"square",gain:.05,detune:0},
    {wave:"sawtooth",gain:.38,detune:0}
  ],
  filterHz:8600,
  filterQ:3.6,
  attack:.091,
  release:.55,
  volume:.2,
  stereoWidth:.15,
  duration:.20,
  stepInterval:.22,
  pairGap:0,
  globalDetune:40,
  noteD:{note:"D",octave:5},
  noteFs:{note:"F♯",octave:5}
});

function playFixedDoorTone(freq,start,duration,release,volume,timbre){
  const c=ensureAudioContext(); if(!c||!sound.enabled)return;
  const bus=c.createGain(),filter=c.createBiquadFilter();filter.type="lowpass";filter.frequency.value=5200;filter.Q.value=.35;
  bus.gain.setValueAtTime(.0001,start);bus.gain.exponentialRampToValueAtTime(Math.max(.0001,volume*sound.volumeScale),start+.008);bus.gain.exponentialRampToValueAtTime(.0001,start+duration+release);
  bus.connect(filter).connect(c.destination);
  const osc=c.createOscillator();osc.type=timbre==="sineChime"?"sine":"sine";osc.frequency.value=freq;osc.connect(bus);osc.start(start);osc.stop(start+duration+release+.03);
}
function playDoorOperationChime(){
  const c=ensureAudioContext();if(!c||!sound.enabled)return 0;
  const q=DOOR_CHIME_SETTINGS.doorChime, base=c.currentTime+.025;
  const pairLength=Math.max(q.pinDuration,q.noteGap+q.ponDuration);
  for(let i=0;i<q.repeats;i++){
    const at=base+i*(pairLength+q.repeatGap);
    playFixedDoorTone(noteFrequency(q.pinNote,q.pinOctave,q.detune),at,q.pinDuration,q.release,q.volume,q.timbre);
    playFixedDoorTone(noteFrequency(q.ponNote,q.ponOctave,q.detune),at+q.noteGap,q.ponDuration,q.release,q.volume,q.timbre);
  }
  return q.repeats*pairLength+(q.repeats-1)*q.repeatGap+q.release;
}
function playDoorOpenGuideTone(){
  const c=ensureAudioContext();if(!c||!sound.enabled)return;
  const q=DOOR_CHIME_SETTINGS.doorOpen;
  playFixedDoorTone(noteFrequency(q.note,q.octave,q.detune),c.currentTime+.02,q.duration,q.release,q.volume,q.timbre);
}
function stopDoorOpenGuideTone(){if(doorOpenChimeTimer){clearInterval(doorOpenChimeTimer);doorOpenChimeTimer=null;}}
function startDoorOpenGuideTone(){stopDoorOpenGuideTone();playDoorOpenGuideTone();doorOpenChimeTimer=setInterval(()=>{if(!train.doorsClosed&&(train.stationPhase==="BOARDING"||train.stationPhase==="ARRIVAL_OPEN"))playDoorOpenGuideTone();else stopDoorOpenGuideTone();},DOOR_CHIME_SETTINGS.doorOpen.interval*1000);}

function playDoorPneumatic(kind) {
  const c = ensureAudioContext();
  if (!c || !sound.enabled) return 0;
  const prefix = kind === "open" ? "open" : "close";
  const duration = stationSound[prefix + "AirDuration"];
  const airLevel = stationSound[prefix + "AirLevel"];
  const airPitch = stationSound[prefix + "AirPitch"];
  const lockPitch = stationSound[prefix + "LockPitch"];
  const lockLevel = stationSound[prefix + "LockLevel"];
  const volume = stationSound[prefix + "Volume"] * sound.volumeScale;
  const start = c.currentTime + .03;

  const noise = c.createBufferSource();
  noise.buffer = createNoiseBuffer(c, duration + .18);
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(airPitch, start);
  band.frequency.exponentialRampToValueAtTime(Math.max(180, airPitch * .72), start + duration);
  band.Q.value = 0.55;
  const low = c.createBiquadFilter();
  low.type = "lowpass";
  low.frequency.value = Math.min(5200, airPitch * 2.8);
  const airGain = c.createGain();
  airGain.gain.setValueAtTime(.0001, start);
  airGain.gain.exponentialRampToValueAtTime(Math.max(.001, .22 * airLevel * volume), start + .035);
  airGain.gain.setValueAtTime(Math.max(.001, (.16 + stationSound.doorAirPulse*.045) * airLevel * volume), start + duration * .68);
  airGain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  noise.connect(band); band.connect(low); low.connect(airGain); airGain.connect(c.destination);
  noise.start(start); noise.stop(start + duration + .2);

  // 短く硬い機械式ラッチ音「ガチッ」。低い衝撃＋高い爪音を二段で合成する。
  const lockAt = start + duration + stationSound.doorLockDelay;
  const lockBus = c.createGain();
  const lockFilter = c.createBiquadFilter();
  lockFilter.type = "bandpass";
  lockFilter.frequency.setValueAtTime(Math.min(4200, Math.max(850, lockPitch * 3.1)), lockAt);
  lockFilter.Q.value = 1.15;
  lockFilter.connect(lockBus); lockBus.connect(c.destination);

  lockBus.gain.setValueAtTime(.0001, lockAt);
  lockBus.gain.exponentialRampToValueAtTime(Math.max(.001, .34 * lockLevel * volume), lockAt + .0025);
  lockBus.gain.exponentialRampToValueAtTime(.0001, lockAt + .085);

  // 「ガ」側：重い金属ラッチの衝撃。
  const body = c.createOscillator();
  const bodyGain = c.createGain();
  body.type = "square";
  body.frequency.setValueAtTime(Math.max(105, lockPitch * .78), lockAt);
  body.frequency.exponentialRampToValueAtTime(Math.max(70, lockPitch * .31), lockAt + .055);
  bodyGain.gain.setValueAtTime(.78, lockAt);
  bodyGain.gain.exponentialRampToValueAtTime(.0001, lockAt + .062);
  body.connect(bodyGain); bodyGain.connect(lockFilter);
  body.start(lockAt); body.stop(lockAt + .07);

  // 「チッ」側：爪が噛み合う高いクリック。
  const clickAt = lockAt + .028;
  const click = c.createOscillator();
  const clickGain = c.createGain();
  click.type = "triangle";
  click.frequency.setValueAtTime(Math.min(5200, lockPitch * 4.2), clickAt);
  click.frequency.exponentialRampToValueAtTime(Math.max(600, lockPitch * 2.1), clickAt + .025);
  clickGain.gain.setValueAtTime(.55, clickAt);
  clickGain.gain.exponentialRampToValueAtTime(.0001, clickAt + .038);
  click.connect(clickGain); clickGain.connect(lockFilter);
  click.start(clickAt); click.stop(clickAt + .045);

  // ごく短い広帯域ノイズで金属接触の輪郭を足す。
  const impact = c.createBufferSource();
  impact.buffer = createNoiseBuffer(c, .055);
  const impactHigh = c.createBiquadFilter();
  impactHigh.type = "highpass"; impactHigh.frequency.value = 1250;
  const impactGain = c.createGain();
  impactGain.gain.setValueAtTime(.32, lockAt);
  impactGain.gain.exponentialRampToValueAtTime(.0001, lockAt + .045);
  impact.connect(impactHigh); impactHigh.connect(impactGain); impactGain.connect(lockFilter);
  impact.start(lockAt); impact.stop(lockAt + .055);
  // 採用した「ガチャこん」二段機械音。
  if(stationSound.doorMechanicalStyle === "double"){
    const secondAt=lockAt+.115, second=c.createOscillator(),sg=c.createGain();
    second.type="triangle";second.frequency.setValueAtTime(Math.max(70,lockPitch*.72),secondAt);second.frequency.exponentialRampToValueAtTime(Math.max(45,lockPitch*.38),secondAt+.085);
    sg.gain.setValueAtTime(.24*lockLevel*volume*(.75+stationSound.doorClunkDepth),secondAt);sg.gain.exponentialRampToValueAtTime(.0001,secondAt+.12);
    second.connect(sg).connect(c.destination);second.start(secondAt);second.stop(secondAt+.13);
  }
  return duration + stationSound.doorLockDelay + .18;
}

function playDoorOpenSound(){ return playDoorPneumatic("open"); }
function playDoorCloseSound(){ return playDoorPneumatic("close"); }

function playBoardingBuzzer() {
  const c=ensureAudioContext();if(!c||!sound.enabled)return 0;
  const start=c.currentTime+.02,duration=4.2;

  // v69.1 客終ブザー決定版：95 Hz の鋸波メイン音のみ。
  // 副音、倍音レイヤー、クリック、トレモロ、FM/AM、歪みは使用しない。
  const bus=c.createGain();
  const highpass=c.createBiquadFilter();
  const lowpass=c.createBiquadFilter();
  highpass.type="highpass";highpass.frequency.value=205;highpass.Q.value=.707;
  lowpass.type="lowpass";lowpass.frequency.value=4460;lowpass.Q.value=1+stationSound.boardingResonance*5;

  const peak=.17*.5*sound.volumeScale;
  bus.gain.setValueAtTime(.0001,start);
  bus.gain.exponentialRampToValueAtTime(Math.max(.001,peak),start+.001);
  bus.gain.setValueAtTime(Math.max(.001,peak),start+duration-.2);
  bus.gain.exponentialRampToValueAtTime(.0001,start+duration);
  highpass.connect(lowpass).connect(bus).connect(c.destination);

  const osc=c.createOscillator();
  osc.type="sawtooth";
  osc.frequency.setValueAtTime(95,start);
  osc.connect(highpass);
  osc.start(start);
  osc.stop(start+duration+.03);

  // ごく薄い設備ノイズ。副音ではなく、ブザー筐体の空気感だけを加える。
  const noise=c.createBufferSource();
  const noiseBand=c.createBiquadFilter();
  const noiseGain=c.createGain();
  noise.buffer=createNoiseBuffer(c,duration);
  noiseBand.type="bandpass";noiseBand.frequency.value=1100;noiseBand.Q.value=1.2;
  noiseGain.gain.setValueAtTime(.06*.035,start);
  noiseGain.gain.setValueAtTime(.06*.035,start+duration-.2);
  noiseGain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  noise.connect(noiseBand).connect(noiseGain).connect(bus);
  noise.start(start);noise.stop(start+duration);
  return duration;
}

function updateStationSoundDisplay(){
  const pairs = [
    ["openAirDuration", v => v.toFixed(2) + "秒"], ["openAirLevel", v => Math.round(v*100) + "%"], ["openAirPitch", v => Math.round(v) + "Hz"], ["openLockPitch", v => Math.round(v) + "Hz"], ["openLockLevel", v => Math.round(v*100) + "%"], ["openVolume", v => Math.round(v*100) + "%"],
    ["closeAirDuration", v => v.toFixed(2) + "秒"], ["closeAirLevel", v => Math.round(v*100) + "%"], ["closeAirPitch", v => Math.round(v) + "Hz"], ["closeLockPitch", v => Math.round(v) + "Hz"], ["closeLockLevel", v => Math.round(v*100) + "%"], ["closeVolume", v => Math.round(v*100) + "%"],
    ["boardingFrequency", v => Math.round(v) + "Hz"], ["boardingDuration", v => v.toFixed(2) + "秒"], ["boardingVolume", v => Math.round(v*100) + "%"]
  ];
  pairs.forEach(([key, format]) => {
    const input = ui[key + "Input"], output = ui[key + "Value"];
    if (!input) return;
    const percent = key.endsWith("Level") || key.endsWith("Volume");
    input.value = percent ? Math.round(stationSound[key] * 100) : stationSound[key];
    if (output) output.textContent = format(stationSound[key]);
  });
  if (ui.boardingWaveSelect) ui.boardingWaveSelect.value = stationSound.boardingWave;
}

function saveStationSoundSettings(){
  try { localStorage.setItem("atcStationSoundV24", JSON.stringify(stationSound)); } catch(e) { console.warn(e); }
}
function syncDoorSettings(){
  stationSound.closeAirDuration=stationSound.openAirDuration;
  stationSound.closeAirLevel=stationSound.openAirLevel;
  stationSound.closeAirPitch=stationSound.openAirPitch;
  stationSound.closeLockPitch=stationSound.openLockPitch;
  stationSound.closeLockLevel=stationSound.openLockLevel;
  stationSound.closeVolume=stationSound.openVolume;
}
function loadStationSoundSettings(){
  Object.assign(stationSound, DEFAULT_STATION_SOUND_SETTINGS);
  syncDoorSettings();
}

function applyStationSoundInputs(){
  const numericKeys = ["openAirDuration","openAirLevel","openAirPitch","openLockPitch","openLockLevel","openVolume","closeAirDuration","closeAirLevel","closeAirPitch","closeLockPitch","closeLockLevel","closeVolume","boardingFrequency","boardingDuration","boardingVolume"];
  numericKeys.forEach(key => {
    const input = ui[key + "Input"]; if(!input) return;
    stationSound[key] = (key.endsWith("Level") || key.endsWith("Volume")) ? +input.value / 100 : +input.value;
  });
  if(ui.boardingWaveSelect) stationSound.boardingWave = ui.boardingWaveSelect.value;
  syncDoorSettings();
  updateStationSoundDisplay(); saveStationSoundSettings();
}

function updateAlarmSettingsDisplay(){
  // v19: 警報パターンは固定。
}


function setSoundPreset(){const v=ui.soundPresetSelect.value;if(v==='custom'){sound.preset='custom';updateSoundSettingsDisplay();saveSoundSettings();return;}ui.toneFamilySelect.value=v;applyToneCharacter(v,sound.variation||'B',{preview:true});}
function signedCent(v){return `${v>0?'+':v<0?'−':''}${Math.abs(v)} cent`;}
function updateSoundSettingsDisplay(){
  const set=(el,v)=>{if(el)el.value=String(v)}, text=(el,v)=>{if(el)el.textContent=v};
  set(ui.pinDurationInput,sound.pinDuration.toFixed(2));set(ui.pinReleaseInput,100);set(ui.pongDurationInput,sound.pongDuration.toFixed(2));set(ui.chimeGapInput,sound.gap.toFixed(2));set(ui.chimeOverlapInput,sound.overlap.toFixed(2));set(ui.chimeVolumeInput,Math.round(sound.volumeScale*100));
  set(ui.pinPitchSelect,sound.pinFrequency);set(ui.pongPitchSelect,sound.pongFrequency);set(ui.globalTuningInput,sound.globalTuning);set(ui.pinTuningInput,sound.pinTuning);set(ui.pongTuningInput,sound.pongTuning);
  ['pin','pong'].forEach(k=>{['Sine','Triangle','Square','Saw'].forEach(w=>{set(ui[k+w+'Input'],Math.round(sound[k+w]*100));text(ui[k+w+'Value'],`${Math.round(sound[k+w]*100)}%`)});['Attack','Decay','EnvRelease'].forEach(x=>{set(ui[k+x+'Input'],sound[k+x]);text(ui[k+x+'Value'],`${sound[k+x].toFixed(3)}秒`)});set(ui[k+'SustainInput'],Math.round(sound[k+'Sustain']*100));text(ui[k+'SustainValue'],`${Math.round(sound[k+'Sustain']*100)}%`);set(ui[k+'FilterInput'],sound[k+'Filter']);text(ui[k+'FilterValue'],`${sound[k+'Filter']}Hz`);set(ui[k+'DriveInput'],Math.round(sound[k+'Drive']*100));text(ui[k+'DriveValue'],`${Math.round(sound[k+'Drive']*100)}%`);});
  text(ui.pinDurationValue,`${sound.pinDuration.toFixed(2)}秒`);text(ui.pinReleaseValue,'100%');text(ui.pongDurationValue,`${sound.pongDuration.toFixed(2)}秒`);text(ui.chimeGapValue,`${sound.gap.toFixed(2)}秒`);text(ui.chimeOverlapValue,`${sound.overlap.toFixed(2)}秒`);text(ui.chimeVolumeValue,`${Math.round(sound.volumeScale*100)}%`);
  text(ui.globalTuningValue,signedCent(sound.globalTuning));text(ui.pinTuningValue,signedCent(sound.pinTuning));text(ui.pongTuningValue,signedCent(sound.pongTuning));
  set(ui.mudInput,Math.round(sound.mud*100));set(ui.boxInput,Math.round(sound.box*100));set(ui.speakerInput,Math.round(sound.speaker*100));text(ui.mudValue,`${Math.round(sound.mud*100)}%`);text(ui.boxValue,`${Math.round(sound.box*100)}%`);text(ui.speakerValue,`${Math.round(sound.speaker*100)}%`);
  if(ui.toneFamilySelect)ui.toneFamilySelect.value=sound.family||'softMuddy';if(ui.toneVariationSelect)ui.toneVariationSelect.value=sound.variation||'B';if(ui.soundPresetSelect)ui.soundPresetSelect.value=sound.preset==='custom'?'custom':(sound.family||'softMuddy');if(ui.characterDescription)ui.characterDescription.textContent=(TONE_FAMILIES[sound.family]||TONE_FAMILIES.softMuddy).description;
}
function exportableSettings(){const o={};Object.keys(DEFAULT_SOUND_SETTINGS).forEach(k=>o[k]=sound[k]);return o;}
function saveSoundSettings(){try{localStorage.setItem('atcChimeSettingsV18',JSON.stringify(exportableSettings()));}catch(e){console.warn(e)}}
function loadSoundSettings(){
  // v23: ATCチャイムは正式設定で固定。旧保存値は読み込まない。
  Object.assign(sound, DEFAULT_SOUND_SETTINGS);
  try { localStorage.removeItem('atcChimeSettingsV18'); } catch(e) { console.warn(e); }
}
function applySoundSettingFromInputs({preview=false}={}){
  Object.assign(sound,{preset:'custom',family:sound.family||'softMuddy',globalTuning:+ui.globalTuningInput.value,pinTuning:+ui.pinTuningInput.value,pongTuning:+ui.pongTuningInput.value,pinDuration:+ui.pinDurationInput.value,pongDuration:+ui.pongDurationInput.value,gap:+ui.chimeGapInput.value,overlap:+ui.chimeOverlapInput.value,volumeScale:+ui.chimeVolumeInput.value/100,pinFrequency:+ui.pinPitchSelect.value,pongFrequency:+ui.pongPitchSelect.value});
  ['pin','pong'].forEach(k=>{['Sine','Triangle','Square','Saw'].forEach(w=>sound[k+w]=+ui[k+w+'Input'].value/100);['Attack','Decay','EnvRelease'].forEach(x=>sound[k+x]=+ui[k+x+'Input'].value);sound[k+'Sustain']=+ui[k+'SustainInput'].value/100;sound[k+'Filter']=+ui[k+'FilterInput'].value;sound[k+'Drive']=+ui[k+'DriveInput'].value/100;});
  updateSoundSettingsDisplay();saveSoundSettings();if(preview&&sound.enabled)playAtcChime();
}
function resetSoundSettings(){Object.assign(sound,DEFAULT_SOUND_SETTINGS);updateSoundSettingsDisplay();saveSoundSettings();if(sound.enabled)playAtcChime();}
function exportSoundSettings(){ui.soundJsonArea.value=JSON.stringify(exportableSettings(),null,2);ui.soundJsonArea.select();navigator.clipboard?.writeText(ui.soundJsonArea.value).catch(()=>{});}
function importSoundSettings(){try{const x=JSON.parse(ui.soundJsonArea.value);Object.assign(sound,DEFAULT_SOUND_SETTINGS,x,{preset:'custom'});updateSoundSettingsDisplay();saveSoundSettings();playAtcChime();}catch(e){alert('JSONの形式を確認してね。');}}

function setSoundEnabled(enabled) {
  sound.enabled = enabled;
  ui.soundToggleButton.textContent = enabled ? "SE：ON" : "SE：OFF";
  ui.soundToggleButton.setAttribute("aria-pressed", String(enabled));

  if (enabled) {
    ensureAudioContext();
    initializeMotorSound();
    playAtcChime();
  }
  updateMotorSound();
}

function toggleSound() {
  setSoundEnabled(!sound.enabled);
}

function announceAtcChange(atcKmh) {
  const rounded = Math.round(atcKmh);
  if (sound.lastChimedAtc === rounded) return;

  sound.lastChimedAtc = rounded;
  playAtcChime();
}

function checkFinish() {
  if (train.crashed) return;
  const speedKmh = mpsToKmh(train.speedMps);
  const isInFinishArea = train.position >= ROUTE.stopPosition - 200;

  if (isInFinishArea && speedKmh < 0.35 && train.brakeNotch > 0) {
    train.speedMps = 0;
    train.acceleration = 0;
    train.finished = true;
    train.running = false;
    train.powerNotch = 0;
    train.phase = PHASE.FINISHED;
    train.stationPhase = "ARRIVED";
    train.doorsClosed = true;
    train.doorOpenRatio = 0;
    train.passengerEndActive = false;
    train.arrivalActualSeconds = TIMETABLE.departureSeconds + train.elapsedSeconds;

    const error = train.position - ROUTE.stopPosition;
    showResult(error);
    logEvent(`停車。停止位置誤差 ${formatSigned(error, 1)} m。`);
    speakDriverCall("停車");
    updateDoorScene();
  }
}

function checkBufferCollision() {
  if (train.crashed || train.position < ROUTE.bufferStopPosition) return;
  train.impactSpeedKmh = mpsToKmh(train.speedMps);
  train.crashed = true;
  train.finished = true;
  train.running = false;
  train.powerNotch = 0;
  train.brakeNotch = 7;
  train.emergencyBrake = true;
  train.speedMps = 0;
  train.acceleration = 0;
  train.phase = PHASE.FINISHED;
  train.position = ROUTE.bufferStopPosition;
  showBufferCollision();
  playBufferCollisionSound(train.impactSpeedKmh);
  scenery.collisionShake = Math.min(1.8, 0.55 + train.impactSpeedKmh / 25);
  logEvent(`車止めに衝突！ 衝突速度 ${train.impactSpeedKmh.toFixed(1)} km/h。`);
}

function showBufferCollision() {
  if (!ui.collisionOverlay) return;
  const speed = train.impactSpeedKmh;
  ui.collisionTitle.textContent = speed < 5 ? "車止め接触！" : "車止め衝突！";
  ui.collisionSubtitle.textContent = speed < 5 ? "ゴツン！" : speed < 20 ? "がしゃん！" : "がっしゃーん！！";
  ui.collisionOverlay.classList.remove("hidden");
  ui.collisionOverlay.classList.add("active");
}

function playBufferCollisionSound(speedKmh) {
  const c=ensureAudioContext(); if(!c||!sound.enabled)return;
  const cfg={volume:.72,bodyFreq:180,endFreq:42,duration:1.15,metalFreq:1500,metalQ:.7,noise:.75,debris:.55,creak:.35,distortion:.18};
  const now=c.currentTime, master=c.createGain(), drive=c.createWaveShaper();
  drive.curve=makeDistortionCurve(cfg.distortion);drive.oversample="2x";
  master.gain.setValueAtTime(Math.min(1,cfg.volume*(.65+speedKmh/80))*sound.volumeScale,now);
  master.gain.exponentialRampToValueAtTime(.0001,now+cfg.duration);
  drive.connect(master).connect(c.destination);
  const body=c.createOscillator(),bg=c.createGain();body.type="sawtooth";
  body.frequency.setValueAtTime(cfg.bodyFreq,now);body.frequency.exponentialRampToValueAtTime(cfg.endFreq,now+cfg.duration*.48);
  bg.gain.setValueAtTime(.8,now);bg.gain.exponentialRampToValueAtTime(.0001,now+cfg.duration*.62);
  body.connect(bg).connect(drive);body.start(now);body.stop(now+cfg.duration*.7);
  const len=Math.floor(c.sampleRate*cfg.duration),buffer=c.createBuffer(1,len,c.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<len;i++){const t=i/len;data[i]=(Math.random()*2-1)*Math.pow(1-t,2.2)*cfg.noise;}
  const noise=c.createBufferSource(),filter=c.createBiquadFilter();filter.type="bandpass";filter.frequency.value=cfg.metalFreq;filter.Q.value=cfg.metalQ;
  noise.buffer=buffer;noise.connect(filter).connect(drive);noise.start(now+.025);
  for(let i=0;i<8;i++){const at=now+.08+i*.075+Math.random()*.035,o=c.createOscillator(),g=c.createGain();o.type="triangle";o.frequency.value=480+Math.random()*1800;g.gain.setValueAtTime(cfg.debris*(.13-i*.015),at);g.gain.exponentialRampToValueAtTime(.0001,at+.11);o.connect(g).connect(drive);o.start(at);o.stop(at+.12);}
  const creak=c.createOscillator(),cg=c.createGain();creak.type="sawtooth";creak.frequency.setValueAtTime(92,now+.18);creak.frequency.exponentialRampToValueAtTime(48,now+.95);cg.gain.setValueAtTime(cfg.creak*.16,now+.18);cg.gain.exponentialRampToValueAtTime(.0001,now+1.08);creak.connect(cg).connect(master);creak.start(now+.18);creak.stop(now+1.1);
}

function showResult(errorMeters) {
  const absoluteError = Math.abs(errorMeters);
  let grade;

  if (absoluteError <= 0.5) grade = "神業停車！";
  else if (absoluteError <= 1.5) grade = "かなり正確！";
  else if (absoluteError <= 3) grade = "合格停車";
  else if (absoluteError <= 10) grade = "もう少し！";
  else if (errorMeters > 0) grade = "オーバーラン";
  else grade = "手前で停車";

  ui.resultTitle.textContent = grade;
  const timeDifference = train.arrivalActualSeconds - TIMETABLE.arrivalSeconds;
  ui.resultText.textContent = `停止位置との差は ${formatSigned(errorMeters, 1)} m。到着は ${formatClock(train.arrivalActualSeconds)}（所定比 ${formatTimeDifference(timeDifference)}）でした。記録は保存されません。`;
  ui.resultPanel.classList.remove("hidden");
  ui.resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function formatSigned(value, digits) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}`;
}

function formatClock(totalSeconds) {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(rounded / 3600) % 24;
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  return [hours, minutes, seconds].map(v => String(v).padStart(2, "0")).join(":");
}

function formatTimeDifference(seconds) {
  const rounded = Math.round(seconds);
  if (Math.abs(rounded) <= 1) return "定時";
  return `${Math.abs(rounded)}秒${rounded > 0 ? "遅れ" : "早着"}`;
}

function confirmAtc30({ fromHeldArrival = false, fromPress = false } = {}) {
  const speedKmh = mpsToKmh(train.speedMps);
  const isDecelerating = train.acceleration < -0.005;

  if (!train.atc30ConfirmAvailable || train.atc30Confirmed || speedKmh > 30.2) return false;

  // 成立条件は次のどちらかだけ。
  // 1) 30 km/hより上から押し続け、30 km/h以下へ到達した。
  // 2) 30 km/h以下かつ減速中に、新たに確認ボタンを押した。
  const heldArrivalValid = fromHeldArrival && train.atc30ConfirmArmedAbove30 && train.atcConfirmHeld;
  const pressWhileDeceleratingValid = fromPress && isDecelerating;
  if (!heldArrivalValid && !pressWhileDeceleratingValid) return false;

  train.atc30Confirmed = true;
  train.atc30ConfirmArmedAbove30 = false;
  playAtcChime();
  window.setTimeout(() => {
    speakDriverCall("ATC確認、信号30", "エーティーシー、かくにん。しんごう、さんじゅう");
  }, 850);
  logEvent("ATC確認成立。ピンポーン、ATC確認・信号30。30 km/h保持ブレーキを解放。");
  return true;
}

function clearPassengerEndTimer(){
  if(train.passengerEndTimer){
    clearTimeout(train.passengerEndTimer);
    train.passengerEndTimer=null;
  }
  train.boardingEndsAt=0;
}

function getDoorMotionDurationMs(kind){
  const prefix = kind === "open" ? "open" : "close";
  const airSeconds = Number(stationSound[prefix + "AirDuration"]) || 1.05;
  return Math.max(720, Math.round(airSeconds * 1000));
}

function animateSingleDoor(target, duration=1050, startDelay=30){
  const start=train.doorOpenRatio;
  const started=performance.now()+startDelay;
  function step(now){
    if(now<started){ requestAnimationFrame(step); return; }
    const t=clamp((now-started)/duration,0,1);
    // 実機風：始動と停止だけ少し穏やかにし、中間はほぼ一定速度。
    const eased=t*t*(3-2*t);
    train.doorOpenRatio=start+(target-start)*eased;
    updateDoorScene();
    if(t<1) requestAnimationFrame(step);
    else{
      train.doorOpenRatio=target;
      updateDoorScene();
    }
  }
  requestAnimationFrame(step);
  return startDelay + duration;
}

function finishPassengerBoarding(skipped=false){
  if(train.stationPhase!=="BOARDING" || train.running) return;
  clearPassengerEndTimer();
  train.passengerEndActive=true;
  train.stationPhase="BUZZER_DONE";
  playBoardingBuzzer();
  logEvent(skipped ? "乗降時間をスキップ。客終ランプ点灯、乗降終了ブザー。" : "40秒の乗降扱い終了。客終ランプ点灯、乗降終了ブザー。");
  updateDisplay(getAtcPlan());
  updateDoorScene();
}

function scheduleAutomaticPassengerEnd(){
  clearPassengerEndTimer();
  train.passengerEndActive=false;
  train.boardingEndsAt=Date.now()+train.boardingDurationMs;
  updateDoorScene();
  train.passengerEndTimer=setTimeout(()=>finishPassengerBoarding(false),train.boardingDurationMs);
}

function skipPassengerBoarding(){
  finishPassengerBoarding(true);
}

function updateDoorScene(){
  if(!ui.doorScene) return;
  const stationView=!train.running && [
    "DOORS_CLOSED_WAIT_OPEN","BOARDING","BUZZER_DONE","READY_TO_DEPART","ARRIVED","ARRIVAL_OPEN"
  ].includes(train.stationPhase);
  ui.doorScene.classList.toggle("hidden",!stationView);

  if(ui.singleDoors?.length){
    // 0=閉、1=開。車端の2扉をそれぞれ外側の戸袋方向へ収納する。
    const openRatio=clamp(train.doorOpenRatio,0,1);
    ui.singleDoors.forEach((door)=>{
      const direction=Number(door.dataset.doorDirection)||1;
      // 親のdoor-unitでクリップし、戸袋へ入る途中も車体外へ露出させない。
      door.style.transform=`translate3d(${direction*openRatio*102}%,0,0)`;
      door.style.opacity="1";
    });
  }
  if(ui.passengerEndLamp) ui.passengerEndLamp.classList.toggle("on",train.passengerEndActive);
  if(ui.doorClosedSceneLamp) ui.doorClosedSceneLamp.classList.toggle("on",train.doorsClosed);
  if(ui.doorSceneStation) ui.doorSceneStation.textContent=train.finished?"潮見中央":"旭ヶ丘";

  let message="ドア開操作を行ってください";
  if(train.stationPhase==="BOARDING"){
    const remainingSeconds=Math.max(0,Math.ceil((train.boardingEndsAt-Date.now())/1000));
    message=`乗降中　残り ${remainingSeconds}秒`;
  }
  if(train.stationPhase==="BUZZER_DONE") message="客終合図　ドア閉操作を行ってください";
  if(train.stationPhase==="READY_TO_DEPART") message="ドア閉動作中";
  if(train.stationPhase==="DEPARTED") message="発車";
  if(train.stationPhase==="ARRIVED") message="到着　ドア開操作を行ってください";
  if(train.stationPhase==="ARRIVAL_OPEN") message="ドア開　降車扱い中";
  if(ui.doorSceneMessage) ui.doorSceneMessage.textContent=message;
  if(ui.boardingSkipButton){
    const canSkip=train.stationPhase==="BOARDING";
    ui.boardingSkipButton.classList.toggle("hidden",!canSkip);
    ui.boardingSkipButton.disabled=!canSkip;
  }
}

function operateStationDoors() {
  ensureAudioContext();
  if (train.running) return;

  if (train.stationPhase === "DOORS_CLOSED_WAIT_OPEN") {
    train.doorsClosed = false;
    train.stationPhase = "BOARDING";
    train.passengerEndActive = false;
    playDoorOperationChime();
    window.setTimeout(()=>{
      playDoorOpenSound();
      animateSingleDoor(1, getDoorMotionDurationMs("open"), 30);
      window.setTimeout(startDoorOpenGuideTone,getDoorMotionDurationMs("open")+350);
    },1450);
    logEvent("ドア開。40秒の乗降扱いを開始。乗降スキップも使用できます。");
    scheduleAutomaticPassengerEnd();

  } else if (train.stationPhase === "BUZZER_DONE") {
    clearPassengerEndTimer();
    train.stationPhase = "READY_TO_DEPART";
    train.passengerEndActive = false;
    stopDoorOpenGuideTone();
    playDoorOperationChime();
    const closeMotionMs = getDoorMotionDurationMs("close");
    const closeStartDelay = 1450;
    let closeSoundDuration = (closeMotionMs/1000)+stationSound.doorLockDelay+.18;
    window.setTimeout(()=>{
      closeSoundDuration = playDoorCloseSound();
      animateSingleDoor(0, closeMotionMs, 30);
    },closeStartDelay);
    logEvent("ドア閉操作。");

    // 戸閉成立は可動終了後、ラッチ音が鳴る時点に合わせる。
    const baseDelay = closeStartDelay + Math.max(closeMotionMs + 130, closeSoundDuration * 1000);
    window.setTimeout(() => {
      train.doorsClosed = true;
      logEvent("ドア閉完了。戸閉ランプ点灯。");
      updateDisplay(getAtcPlan());
      updateDoorScene();
    }, baseDelay);

    // 戸閉成立後、車掌がホーム安全確認を行う時間として1.5～3.0秒ランダム待機。
    const conductorDelayMs = 1500 + Math.random() * 1500;
    clearDepartureSequenceTimer();
    train.departureSequenceTimer = window.setTimeout(() => {
      train.departureSequenceTimer=null;
      if(!train.doorsClosed || train.stationPhase!=="READY_TO_DEPART" || train.running) return;
      // 出発許可の成立を音声だけにせず、ATC状態へ確実に反映する。
      setDepartureRouteState(DEPARTURE_ROUTE_STATE.ROUTE_SET);
      setDepartureAtcSignal(DEPARTURE_ROUTE_CONFIG.proceedAtcKmh,{announce:false});
      train.atcPermittedKmh=DEPARTURE_ROUTE_CONFIG.proceedAtcKmh;
      train.running=true;
      train.stationPhase="DEPARTED";
      startDepartureSign();
      speakDriverSequence([
        {spoken:"とじめ、てん"},
        {spoken:"しゅっぱつ、しんこう"},
        {spoken:"しんごう、ななじゅう"}
      ]);
      logEvent(`戸閉成立から${(conductorDelayMs/1000).toFixed(1)}秒後、車掌発車サイン。`);
      logEvent("戸閉め点。出発進行、信号70。");
      updateDisplay(getAtcPlan());
      updateDoorScene();
    }, baseDelay + conductorDelayMs);

  } else if (train.stationPhase === "ARRIVED") {
    train.doorsClosed = false;
    train.stationPhase = "ARRIVAL_OPEN";
    playDoorOperationChime();
    window.setTimeout(()=>{
      playDoorOpenSound();
      animateSingleDoor(1, getDoorMotionDurationMs("open"), 30);
      window.setTimeout(startDoorOpenGuideTone,getDoorMotionDurationMs("open")+350);
    },1450);
    logEvent("到着駅ドア開。降車扱い中。");
  }
  updateDisplay(getAtcPlan());
  updateDoorScene();
}

function resetSimulation() {
  stopDoorOpenGuideTone();
  clearPendingControlCommands();
  stopDepartureSign();
  clearDepartureSequenceTimer();
  clearDeparturePreannounceTimer();
  if("speechSynthesis" in window) window.speechSynthesis.cancel();
  train.position = 0;
  train.speedMps = 0;
  train.acceleration = 0;
  train.powerNotch = 0;
  train.brakeNotch = 7;
  train.requestedPowerNotch = 0;
  train.requestedBrakeNotch = 7;
  train.emergencyBrake = false;
  train.doorsClosed = true;
  train.running = false;
  train.finished = false;
  train.atcPermittedKmh = 30;
  train.atcBrakeDecel = 0;
  train.atcBrakeTarget = 0;
  train.phase = PHASE.READY;
  train.passedStation = false;
  train.eventFlags = new Set();
  train.previousSpeedKmh = 0;
  train.stationPhase = "DOORS_CLOSED_WAIT_OPEN";
  train.elapsedSeconds = 0;
  train.timetableClockSeconds = TIMETABLE.departureSeconds - 60;
  train.passActualSeconds = null;
  train.arrivalActualSeconds = null;
  train.atc30ConfirmAvailable = false;
  train.atc30Confirmed = false;
  train.atcConfirmHeld = false;
  train.atc30ConfirmArmedAbove30 = false;
  train.curveStationPassed = false;
  train.doorOpenRatio = 0;
  train.passengerEndActive = false;
  train.boardingEndsAt = 0;
  train.crashed = false;
  train.impactSpeedKmh = 0;
  train.departurePreannounceDone = false;
  train.departureRouteState = DEPARTURE_ROUTE_STATE.GROUND_STOP;
  train.departureRouteSetDone = false;
  train.departureRouteChimePlayed = false;
  train.departureAtcSignalKmh = DEPARTURE_ROUTE_CONFIG.groundStopAtcKmh;
  train.departureSignPhase = 0;
  finishAtcPatternFlash();
  previousStationTarget = null;
  clearPassengerEndTimer();
  sound.lastChimedAtc = null;

  ui.resultPanel.classList.add("hidden");
  ui.collisionOverlay?.classList.add("hidden");
  ui.collisionOverlay?.classList.remove("active");
  ui.eventLog.innerHTML = "<li>旭ヶ丘駅に停車中。ドア扱い待ち。</li>";
  updateDisplay(getAtcPlan());
}


const CONTROL_GATAN_SOUND = Object.freeze({
  normal: Object.freeze({
    hit1: Object.freeze({
      startHz: 100,
      endHz: 48,
      level: 1.12,
      decay: 0.07
    }),
    hit2: Object.freeze({
      delayMs: 20,
      startHz: 380,
      endHz: 170,
      level: 0.31,
      decay: 0.06
    })
  }),
  specialDouble: Object.freeze({
    delayMs: 82,
    level: 0.88,
    pitch: 0.82,
    decayScale: 1.15,
    p13Level: 1.10,
    ebLevel: 1.28
  }),
  texture: Object.freeze({
    noiseHz: 1030,
    noiseQ: 0.2,
    noiseLevel: 0.23,
    noiseDecay: 0.13,
    bodyHz: 80,
    bodyLevel: 0.10,
    bodyDecay: 0.44,
    transientLevel: 0.11
  }),
  brake: Object.freeze({
    pitch: 0.87,
    level: 0.83
  }),
  output: Object.freeze({
    masterVolume: 0.60,
    compressorRatio: 12
  })
});

function createControlGatanNoiseBuffer(context,duration){
  const length=Math.max(1,Math.floor(context.sampleRate*duration));
  const buffer=context.createBuffer(1,length,context.sampleRate);
  const data=buffer.getChannelData(0);
  let previous=0;

  for(let i=0;i<length;i++){
    previous=.32*previous+.68*(Math.random()*2-1);
    data[i]=previous*Math.pow(1-i/length,2.1);
  }

  return buffer;
}

function createControlGatanMaster(context){
  const gain=context.createGain();
  const compressor=context.createDynamicsCompressor();
  compressor.threshold.value=-18;
  compressor.knee.value=10;
  compressor.ratio.value=CONTROL_GATAN_SOUND.output.compressorRatio;
  compressor.attack.value=.0015;
  compressor.release.value=.13;
  gain.gain.value=CONTROL_GATAN_SOUND.output.masterVolume;
  gain.connect(compressor);
  compressor.connect(context.destination);
  return {gain,compressor};
}

function playSingleControlGatan(type="power",strength=1,pitch=1,decayScale=1){
  const context=ensureAudioContext();
  if(!context) return;

  const config=CONTROL_GATAN_SOUND;
  const now=context.currentTime;
  const {gain:master,compressor}=createControlGatanMaster(context);

  const isBrake=type==="brake" || type==="eb";
  const brakeLevel=isBrake ? config.brake.level : 1;
  const brakePitch=isBrake ? config.brake.pitch : 1;
  const totalLevel=strength*brakeLevel;
  const totalPitch=pitch*brakePitch;

  // 第1打「ガッ」
  const impact=context.createOscillator();
  const impactGain=context.createGain();
  impact.type="triangle";
  impact.frequency.setValueAtTime(config.normal.hit1.startHz*totalPitch,now);
  impact.frequency.exponentialRampToValueAtTime(
    Math.max(20,config.normal.hit1.endHz*totalPitch),
    now+config.normal.hit1.decay*decayScale
  );
  impactGain.gain.setValueAtTime(
    config.normal.hit1.level*totalLevel,
    now
  );
  impactGain.gain.exponentialRampToValueAtTime(
    .0001,
    now+config.normal.hit1.decay*decayScale
  );
  impact.connect(impactGain);
  impactGain.connect(master);

  // 第2成分「タン」
  const hit2=context.createOscillator();
  const hit2Gain=context.createGain();
  const hit2Start=now+config.normal.hit2.delayMs/1000;
  hit2.type="triangle";
  hit2.frequency.setValueAtTime(
    config.normal.hit2.startHz*totalPitch,
    hit2Start
  );
  hit2.frequency.exponentialRampToValueAtTime(
    Math.max(40,config.normal.hit2.endHz*totalPitch),
    hit2Start+config.normal.hit2.decay*decayScale
  );
  hit2Gain.gain.setValueAtTime(.0001,now);
  hit2Gain.gain.setValueAtTime(
    config.normal.hit2.level*totalLevel,
    hit2Start
  );
  hit2Gain.gain.exponentialRampToValueAtTime(
    .0001,
    hit2Start+config.normal.hit2.decay*decayScale
  );
  hit2.connect(hit2Gain);
  hit2Gain.connect(master);

  // 瞬間クリック
  const transient=context.createOscillator();
  const transientGain=context.createGain();
  transient.type="square";
  transient.frequency.setValueAtTime(1250*totalPitch,now);
  transient.frequency.exponentialRampToValueAtTime(
    420*totalPitch,
    now+.025
  );
  transientGain.gain.setValueAtTime(
    config.texture.transientLevel*totalLevel,
    now
  );
  transientGain.gain.exponentialRampToValueAtTime(.0001,now+.035);
  transient.connect(transientGain);
  transientGain.connect(master);

  // 金属・機構ノイズ
  const noise=context.createBufferSource();
  const noiseFilter=context.createBiquadFilter();
  const noiseGain=context.createGain();
  noise.buffer=createControlGatanNoiseBuffer(
    context,
    config.texture.noiseDecay*decayScale*1.2
  );
  noiseFilter.type="bandpass";
  noiseFilter.frequency.value=config.texture.noiseHz*totalPitch;
  noiseFilter.Q.value=config.texture.noiseQ;
  noiseGain.gain.setValueAtTime(
    config.texture.noiseLevel*totalLevel,
    now
  );
  noiseGain.gain.exponentialRampToValueAtTime(
    .0001,
    now+config.texture.noiseDecay*decayScale
  );
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);

  // 運転台筐体の低い余韻
  const body=context.createOscillator();
  const bodyGain=context.createGain();
  body.type="sine";
  body.frequency.value=config.texture.bodyHz*totalPitch;
  bodyGain.gain.setValueAtTime(
    config.texture.bodyLevel*totalLevel,
    now
  );
  bodyGain.gain.exponentialRampToValueAtTime(
    .0001,
    now+config.texture.bodyDecay*decayScale
  );
  body.connect(bodyGain);
  bodyGain.connect(master);

  [impact,hit2,transient,body].forEach(node=>node.start(now));
  noise.start(now);

  const endTime=now+Math.max(
    config.texture.bodyDecay,
    config.normal.hit1.decay,
    config.normal.hit2.delayMs/1000+config.normal.hit2.decay
  )*decayScale+.08;

  [impact,hit2,transient,body].forEach(node=>node.stop(endTime));
  noise.stop(endTime);

  window.setTimeout(()=>{
    try{
      [
        impact,impactGain,
        hit2,hit2Gain,
        transient,transientGain,
        noise,noiseFilter,noiseGain,
        body,bodyGain,
        master,compressor
      ].forEach(node=>node.disconnect());
    }catch(_){}
  },900);
}

function playDoubleControlGatan(type="p13"){
  const config=CONTROL_GATAN_SOUND.specialDouble;
  const firstStrength=
    type==="eb" ? config.ebLevel : config.p13Level;
  const soundType=type==="eb" ? "eb" : "power";

  playSingleControlGatan(soundType,firstStrength,1,1);

  window.setTimeout(()=>{
    playSingleControlGatan(
      soundType,
      firstStrength*config.level,
      config.pitch,
      config.decayScale
    );
  },config.delayMs);
}

function playControlGatanForPower(previous,target){
  if(target===previous) return;
  if(target===13 && previous!==13){
    playDoubleControlGatan("p13");
  }else{
    playSingleControlGatan("power",1,1,1);
  }
}

function playControlGatanForBrake(previousIndex,targetIndex){
  if(targetIndex===previousIndex) return;
  if(targetIndex>=8 && previousIndex<8){
    playDoubleControlGatan("eb");
  }else{
    playSingleControlGatan("brake",1,1,1);
  }
}

const POWER_UP_DELAY_MS = 350;
const POWER_DOWN_DELAY_MS = 200;
const BRAKE_APPLY_DELAY_MS = 200;
const BRAKE_RELEASE_DELAY_MS = 150;
const DEPARTURE_SIGN_STOP_AFTER_POWER_MS = 700;

function cancelPowerCommandTimers(){
  for(const id of train.powerCommandTimers) clearTimeout(id);
  train.powerCommandTimers.clear();
  train.powerCommandTimer=null;
}

function cancelBrakeCommandTimers(){
  for(const id of train.brakeCommandTimers) clearTimeout(id);
  train.brakeCommandTimers.clear();
  train.brakeCommandTimer=null;
}

function refreshPendingControlTimerFlags(){
  train.powerCommandTimer=train.powerCommandTimers.size ? [...train.powerCommandTimers][train.powerCommandTimers.size-1] : null;
  train.brakeCommandTimer=train.brakeCommandTimers.size ? [...train.brakeCommandTimers][train.brakeCommandTimers.size-1] : null;
}

function clearPendingControlCommands(){
  cancelPowerCommandTimers();
  cancelBrakeCommandTimers();
  train.requestedPowerNotch=train.powerNotch;
  train.requestedBrakeNotch=train.brakeNotch;
}

function applyPowerCommand(target){
  if(train.finished) return;
  initializeMotorSound();
  const previous=train.powerNotch;
  train.emergencyBrake=false;
  train.powerNotch=clamp(target,0,13);
  if(train.powerNotch>0 && train.brakeNotch>0){
    train.brakeNotch=0;
    train.requestedBrakeNotch=0;
  }
  playControlGatanForPower(previous,train.powerNotch);
}

function queuePowerCommand(target){
  const previousRequested=Number.isFinite(train.requestedPowerNotch)?train.requestedPowerNotch:train.powerNotch;
  const snapshot=clamp(target,0,13);
  train.requestedPowerNotch=snapshot;
  const delayMs=snapshot>previousRequested ? POWER_UP_DELAY_MS : POWER_DOWN_DELAY_MS;

  // 力行と制動は相互排他。ただし同じ系統のノッチ指令は消さず、順番に反映する。
  cancelBrakeCommandTimers();
  train.requestedBrakeNotch=train.brakeNotch;
  let timerId=null;
  timerId=window.setTimeout(()=>{
    train.powerCommandTimers.delete(timerId);
    applyPowerCommand(snapshot);
    refreshPendingControlTimerFlags();
  },delayMs);
  train.powerCommandTimers.add(timerId);
  refreshPendingControlTimerFlags();

  if(train.departureSignStopTimer){clearTimeout(train.departureSignStopTimer);train.departureSignStopTimer=null;}
  if(snapshot>0 && train.departureSignActive){
    train.departureSignStopTimer=window.setTimeout(()=>{
      train.departureSignStopTimer=null;
      stopDepartureSign();
    },DEPARTURE_SIGN_STOP_AFTER_POWER_MS);
  }
}

function changePower(delta) {
  if (train.finished) return;
  const base=Number.isFinite(train.requestedPowerNotch)?train.requestedPowerNotch:train.powerNotch;
  queuePowerCommand(base+delta);
}

function setPowerNeutral() {
  if (train.finished) return;
  queuePowerCommand(0);
}

function applyBrakeCommand(target){
  if(train.finished) return;
  initializeMotorSound();
  const previousIndex=train.emergencyBrake ? 8 : train.brakeNotch;
  train.emergencyBrake=false;
  train.brakeNotch=clamp(target,0,7);
  if(train.brakeNotch>0){
    train.powerNotch=0;
    train.requestedPowerNotch=0;
  }
  playControlGatanForBrake(previousIndex,train.brakeNotch);
}

function queueBrakeCommand(target){
  const previousRequested=Number.isFinite(train.requestedBrakeNotch)?train.requestedBrakeNotch:train.brakeNotch;
  const snapshot=clamp(target,0,7);
  train.requestedBrakeNotch=snapshot;
  const delayMs=snapshot>previousRequested ? BRAKE_APPLY_DELAY_MS : BRAKE_RELEASE_DELAY_MS;

  cancelPowerCommandTimers();
  train.requestedPowerNotch=train.powerNotch;
  let timerId=null;
  timerId=window.setTimeout(()=>{
    train.brakeCommandTimers.delete(timerId);
    applyBrakeCommand(snapshot);
    refreshPendingControlTimerFlags();
  },delayMs);
  train.brakeCommandTimers.add(timerId);
  refreshPendingControlTimerFlags();
}

function changeBrake(delta) {
  if (train.finished) return;
  const base=Number.isFinite(train.requestedBrakeNotch)?train.requestedBrakeNotch:train.brakeNotch;
  queueBrakeCommand(base+delta);
}

function releaseBrakeFully() {
  if (train.finished) return;
  queueBrakeCommand(0);
}

function setEmergencyBrake() {
  if (train.finished) return;
  // 非常ブレーキだけは安全上タイムラグなし。
  clearPendingControlCommands();
  const previousIndex=train.emergencyBrake ? 8 : train.brakeNotch;
  train.emergencyBrake=true;
  train.brakeNotch=7;
  train.requestedBrakeNotch=7;
  train.powerNotch=0;
  train.requestedPowerNotch=0;
  playControlGatanForBrake(previousIndex,8);
  logEvent("非常ブレーキ動作。 ");
}

function setSimulationRate(rate) {
  train.simulationRate = rate;
  ui.rateButtons.forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.rate) === rate);
  });
}

function getStatus(plan) {
  const speedKmh = mpsToKmh(train.speedMps);

  if (train.finished) {
    return {
      className: "",
      title: "運転終了",
      message: "停車結果を確認してください。"
    };
  }

  if (!train.running) {
    return {
      className: "",
      title: "始発駅で停車中",
      message: train.stationPhase === "BOARDING" ? "乗降中。終了合図を鳴らしてください。" : train.stationPhase === "BUZZER_DONE" ? "乗降終了。ドアを閉めてください。" : train.stationPhase === "READY_TO_DEPART" ? "戸閉確認中。自動で発車扱いへ移行します。" : "ドア扱いを開始してください。"
    };
  }

  if (plan.manualStop) {
    return {
      className: "braking",
      title: "ATC 30・手動停車",
      message: !train.atc30Confirmed ? "ATC確認を扱ってください。未確認の間はブレーキが保持されます。" : "停止位置までの残距離を見ながら、自分でブレーキを操作してください。"
    };
  }

  if (train.atcBrakeDecel > 0.08) {
    return {
      className: "braking",
      title: "ATC作動",
      message: `${speedKmh.toFixed(0)} km/h。ATC制限 ${train.atcPermittedKmh.toFixed(0)} km/hまで自動減速中。`
    };
  }

  return {
    className: "running",
    title: "走行中",
    message: `ATC ${train.atcPermittedKmh.toFixed(0)}。マスコンとブレーキを操作できます。`
  };
}



const scenery = {
  initialized: false,
  failed: false,
  renderer: null,
  scene: null,
  camera: null,
  world: null,
  opposingTrains: [],
  routeChunks: [],
  clock: 0
};

// v69.5: 物理距離・ATC・時刻は変更せず、景色の流れだけを従来比1.2倍にする。
// 線路、ホーム、屋根、架線、駅設備、対向列車の長手寸法も同じ係数で変換し、
// 描画上の駅構内や線路が途中で途切れたり、車両だけ長く見えたりしないよう統一。
// ポイント音の判定は物理距離のままなので、ATC・停車位置・音のタイミングは変えない。
const VISUAL_MOTION_TUNING = Object.freeze({
  // Physical metres, station positions, ATC and timetable stay one-to-one.
  worldUnitsPerMeter: 1.0,
  fixedStepSeconds: 1 / 60,
  maxRealDeltaSeconds: 0.25,
  maxPhysicsStepsPerFrame: 12,

  // v70.7.4: camera-only visual-flow enhancement.
  cameraLookAheadBaseM: 76,
  cameraLookAheadSpeedSeconds: 0.24,
  cameraFovLowDeg: 65,
  cameraFovHighDeg: 74,
  cameraHeightLowM: 3.08,
  cameraHeightHighM: 2.78,
  cameraFovResponse: 0.10
});
const VISUAL_SPEED_MULTIPLIER = 1;
const SCENERY_SCALE = VISUAL_MOTION_TUNING.worldUnitsPerMeter;
const sceneDistance = meters => meters * SCENERY_SCALE;
const sceneZ = meters => -sceneDistance(meters);
const SCENERY_ENCOUNTERS = [3600, 16800, 31800];
const SHINKANSEN_CAR_LENGTH_M = window.ATC_CONFIG?.real?.vehicleLengthM ?? 25.0;
const SHINKANSEN_CARS = window.ATC_CONFIG?.real?.cars ?? 16;
const SHINKANSEN_TRAIN_LENGTH_M = window.ATC_CONFIG?.real?.formationLengthM ?? (SHINKANSEN_CAR_LENGTH_M * SHINKANSEN_CARS);
const ROUTE_LAYOUT = window.ATC_ROUTE_V675;
const TRACK_GEOMETRY = ROUTE_LAYOUT?.geometry || {
  carWidthM:3.36, platformGapM:.08, platformWidthM:9.0, yellowLineInsetM:.8,
  trackToPlatformEdgeM:1.76, islandTrackSpacingM:12.52,
  mainTrackCentersM:[-2.5,2.5], outerSidingOffsetM:16.22, islandCenterOffsetM:9.36
};
const DEPARTURE_WORLD_SPEC = window.StationWorldSpec?.resolve("asahigaoka") || null;
const MAIN_LEFT_TRACK = DEPARTURE_WORLD_SPEC?.spacing.mainLeft ?? TRACK_GEOMETRY.mainTrackCentersM?.[0] ?? -2.5;
const MAIN_RIGHT_TRACK = DEPARTURE_WORLD_SPEC?.spacing.mainRight ?? TRACK_GEOMETRY.mainTrackCentersM?.[1] ?? 2.5;
const OUTER_SIDING = Math.abs(DEPARTURE_WORLD_SPEC?.spacing.rightOuter ?? TRACK_GEOMETRY.outerSidingOffsetM);
const ISLAND_CENTER = Math.abs(DEPARTURE_WORLD_SPEC?.platformCenters?.[1] ?? TRACK_GEOMETRY.islandCenterOffsetM);
const RELATIVE_OUTER_TRACK = window.StationWorldSpec?.resolve("sakurano")?.spacing.rightOuter ?? TRACK_GEOMETRY.relativeOuterTrackOffsetM ?? (Math.abs(MAIN_LEFT_TRACK) + (TRACK_GEOMETRY.parallelTrackSpacingM ?? 4.8));
const SIDE_PLATFORM_WIDTH = window.StationWorldSpec?.resolve("sakurano")?.platformWidth ?? TRACK_GEOMETRY.sidePlatformWidthM ?? 5.0;
const TRACK_TO_PLATFORM_EDGE = DEPARTURE_WORLD_SPEC?.spacing.trackToPlatformEdge ?? TRACK_GEOMETRY.trackToPlatformEdgeM ?? 1.76;

// 駅断面の寸法整合性を起動時に検証する。
(function validateStationCrossSection(){
  const expectedClearance = (TRACK_GEOMETRY.carWidthM ?? 3.36) / 2 + (TRACK_GEOMETRY.platformGapM ?? .18);
  const actualClearance = TRACK_GEOMETRY.islandTrackSpacingM / 2 - TRACK_GEOMETRY.platformWidthM / 2;
  if (Math.abs(actualClearance - expectedClearance) > 0.001) {
    console.warn('[route geometry] 車体・ホーム離隔が不整合です', {expectedClearance, actualClearance});
  }
})();

function opposingPassDurationSeconds(ownSpeedKmh, opposingSpeedKmh = 300) {
  const relativeMps = Math.max(1, (ownSpeedKmh + opposingSpeedKmh) / 3.6);
  return SHINKANSEN_TRAIN_LENGTH_M / relativeMps;
}


function getSceneryArea(position) {
  if (position < 28000) return "曲線試験区間";
  if (position < 34500) return "右急カーブ・170 km/h通過駅";
  return "曲線試験区間";
}

function makeCanvasLabel(text, width = 512, height = 128, background = "#f5f7f8", foreground = "#163a69") {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const x = c.getContext("2d");
  x.fillStyle = background;
  x.fillRect(0, 0, width, height);
  x.strokeStyle = "#30424f";
  x.lineWidth = 8;
  x.strokeRect(4, 4, width - 8, height - 8);
  x.fillStyle = foreground;
  x.font = "bold 48px sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, width / 2, height / 2);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function boxMesh(w, h, d, color, roughness = 0.75, metalness = 0.05) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness, metalness })
  );
}


function smoothStep01(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

// ============================================================
// v61 真の曲線線形エンジン
// 横座標を後付けで揺らすのではなく、曲率を積分して中心線を作る。
// 通常曲線は R=4,000m、熱海型駅は緩和曲線を挟んだ R=1,500m。
// ============================================================
const ROUTE_SAMPLE_M = 5;

// ============================================================
// v65 路線エンジン
// 距離[m]を渡すと、中心位置・進行方向・左右方向・曲率を連続的に返す。
// レール、高架、架線、ホーム、列車、カメラは全てこの出力を共有する。
// ============================================================
function cosineRamp(t) {
  t = clamp(t, 0, 1);
  return (1 - Math.cos(Math.PI * t)) * 0.5;
}

function curveWindow(m, start, entry, constant, exit, direction, radius) {
  const end1 = start + entry;
  const end2 = end1 + constant;
  const end3 = end2 + exit;
  if (m < start || m > end3) return 0;
  let gain = 1;
  if (m < end1) gain = cosineRamp((m - start) / entry);
  else if (m > end2) gain = 1 - cosineRamp((m - end2) / exit);
  return direction * gain / radius;
}

function routeCurvature(m) {
  let k = 0;
  k += curveWindow(m,  5200, 500, 1500, 500, +1, 4000);
  k += curveWindow(m, 11800, 500, 1500, 500, -1, 4000);
  k += curveWindow(m, 19600, 500, 1500, 500, +1, 4000);
  k += curveWindow(m, 24400, 450, 1000, 450, -1, 4000);
  k += curveWindow(m, 30600, 350, 900, 350, +1, 1500);
  k += curveWindow(m, 38200, 500, 1500, 500, -1, 4000);
  k += curveWindow(m, 44400, 500, 1500, 500, +1, 4000);
  return k;
}


// v70.1.1: 勾配描画修正（ホーム・景色の標高追従、長手部材のピッチ対応）。
// v70.1: 縦断勾配エンジン。正は上り、負は下り（‰）。
// transitionM の範囲で前区間から滑らかに接続し、加速度と前面展望へ反映する。
const GRADIENT_SECTIONS = Object.freeze([
  Object.freeze({ startM: 0, endM: 6000, gradientPermille: 0, transitionM: 0 }),
  Object.freeze({ startM: 6000, endM: 12000, gradientPermille: 8, transitionM: 450 }),
  Object.freeze({ startM: 12000, endM: 17000, gradientPermille: 15, transitionM: 500 }),
  Object.freeze({ startM: 17000, endM: 23000, gradientPermille: -12, transitionM: 550 }),
  Object.freeze({ startM: 23000, endM: 29000, gradientPermille: 10, transitionM: 500 }),
  Object.freeze({ startM: 29000, endM: 32500, gradientPermille: 18, transitionM: 450 }),
  Object.freeze({ startM: 32500, endM: 40000, gradientPermille: -15, transitionM: 600 }),
  Object.freeze({ startM: 40000, endM: 45500, gradientPermille: 8, transitionM: 500 }),
  Object.freeze({ startM: 45500, endM: 50000, gradientPermille: -6, transitionM: 450 }),
  Object.freeze({ startM: 50000, endM: 52350, gradientPermille: 0, transitionM: 350 })
]);

function gradientAt(meters) {
  const m = clamp(meters, 0, ROUTE.length);
  let previous = GRADIENT_SECTIONS[0].gradientPermille;
  for (const section of GRADIENT_SECTIONS) {
    if (m < section.startM) return previous;
    if (m <= section.endM) {
      const transition = Math.max(0, section.transitionM || 0);
      if (transition > 0 && m < section.startM + transition) {
        const t0 = clamp((m - section.startM) / transition, 0, 1);
        const t = t0 * t0 * (3 - 2 * t0);
        return lerp(previous, section.gradientPermille, t);
      }
      return section.gradientPermille;
    }
    previous = section.gradientPermille;
  }
  return previous;
}

function gradientAccelerationAt(meters) {
  // 小角近似: a = -g * gradient / 1000
  return -9.80665 * (gradientAt(meters) / 1000);
}

class RouteEngine {
  constructor(lengthMeters, sampleMeters, curvatureFunction) {
    this.length = lengthMeters;
    this.sampleMeters = sampleMeters;
    this.curvatureFunction = curvatureFunction;
    this.samples = [];
    this.build();
  }

  build() {
    this.samples.length = 0;
    let x = 0;
    let z = 0;
    let heading = 0;
    let elevationM = 0;
    this.samples.push({m:0,x,z,y:0,elevationM,heading,curvature:this.curvatureFunction(0),gradientPermille:gradientAt(0)});

    for (let m = this.sampleMeters; m <= this.length; m += this.sampleMeters) {
      const mid = m - this.sampleMeters * 0.5;
      const k = this.curvatureFunction(mid);
      heading += k * this.sampleMeters;
      const dsWorld = sceneDistance(this.sampleMeters);
      x += Math.sin(heading) * dsWorld;
      z -= Math.cos(heading) * dsWorld;
      elevationM += gradientAt(mid) / 1000 * this.sampleMeters;
      this.samples.push({m,x,z,y:sceneDistance(elevationM),elevationM,heading,curvature:this.curvatureFunction(m),gradientPermille:gradientAt(m)});
    }
  }

  sample(meters, lateral = 0) {
    const m = clamp(meters, 0, this.length);
    const f = m / this.sampleMeters;
    const i = Math.min(this.samples.length - 2, Math.floor(f));
    const t = clamp(f - i, 0, 1);
    const a = this.samples[i];
    const b = this.samples[i + 1];

    // cubic Hermite補間。各サンプル点の接線を使うため、
    // SmoothStepのように5mごとに速度がゼロへ寄らず、前面展望が連続して流れる。
    const segmentWorld = sceneDistance(this.sampleMeters);
    const h00 = 2*t*t*t - 3*t*t + 1;
    const h10 = t*t*t - 2*t*t + t;
    const h01 = -2*t*t*t + 3*t*t;
    const h11 = t*t*t - t*t;

    const aTx = Math.sin(a.heading), aTz = -Math.cos(a.heading);
    const bTx = Math.sin(b.heading), bTz = -Math.cos(b.heading);
    const centerX = h00*a.x + h10*segmentWorld*aTx + h01*b.x + h11*segmentWorld*bTx;
    const centerZ = h00*a.z + h10*segmentWorld*aTz + h01*b.z + h11*segmentWorld*bTz;
    const centerY = lerp(a.y || 0, b.y || 0, t);
    const elevationM = lerp(a.elevationM || 0, b.elevationM || 0, t);

    // Hermite曲線の微分から、その瞬間の正確な向きを求める。
    const dh00 = 6*t*t - 6*t;
    const dh10 = 3*t*t - 4*t + 1;
    const dh01 = -6*t*t + 6*t;
    const dh11 = 3*t*t - 2*t;
    let dx = dh00*a.x + dh10*segmentWorld*aTx + dh01*b.x + dh11*segmentWorld*bTx;
    let dz = dh00*a.z + dh10*segmentWorld*aTz + dh01*b.z + dh11*segmentWorld*bTz;
    const tangentLength = Math.hypot(dx,dz) || 1;
    dx /= tangentLength;
    dz /= tangentLength;

    const rx = -dz;
    const rz = dx;
    const heading = Math.atan2(dx, -dz);
    return {
      x: centerX + rx * lateral,
      y: centerY,
      elevationM,
      z: centerZ + rz * lateral,
      tx: dx,
      tz: dz,
      rx,
      rz,
      yaw: -heading,
      heading,
      pitch: Math.atan(gradientAt(m) / 1000),
      gradientPermille: gradientAt(m),
      curvature: lerp(a.curvature, b.curvature, t)
    };
  }
}

const routeEngine = new RouteEngine(ROUTE.length, ROUTE_SAMPLE_M, routeCurvature);
function routePose(meters, lateral = 0) {
  return routeEngine.sample(meters, lateral);
}

// v67.5: 始発駅のホームは0mより後方へ伸びるため、負の距離だけ
// 始点の接線方向へ素直に外挿する。routeEngine.sample()の0m固定により
// ホーム部品が先端へ折り重なる現象を防ぐ。
function routePoseExtended(meters, lateral = 0) {
  if (meters >= 0) return routePose(meters, lateral);
  const origin = routePose(0, lateral);
  const distance = sceneDistance(meters);
  return {
    ...origin,
    x: origin.x + origin.tx * distance,
    y: origin.y + sceneDistance(meters * gradientAt(0) / 1000),
    elevationM: origin.elevationM + meters * gradientAt(0) / 1000,
    z: origin.z + origin.tz * distance
  };
}

function applyRoutePose(mesh, pose, yOffset = 0, pitchEnabled = true) {
  mesh.position.set(pose.x, pose.y + yOffset, pose.z);
  mesh.rotation.order = "YXZ";
  mesh.rotation.y = pose.yaw || 0;
  mesh.rotation.x = pitchEnabled ? (pose.pitch || 0) : 0;
  return mesh;
}

function routeCantRadians(meters) {
  const k = routeCurvature(meters);
  // 通常曲線 約1.5度、R1500 約4度。右カーブでは右側が下がる。
  return clamp(k * 105, -0.072, 0.072);
}

function performanceResourceLabel(prefix, geometry, material) {
  const stack = new Error().stack || "";
  const caller = stack.split("\n").map(line => line.trim()).find(line =>
    line && line !== "Error" && line.startsWith("at ") &&
    !line.includes("performanceResourceLabel") &&
    !line.includes("makeInstancedRouteBoxes") &&
    !line.includes("addInstances") &&
    !line.includes("tagPerformanceResource")
  ) || "unknown";
  const fn = (caller.match(/at\s+([^\s(]+)/) || [])[1] || "anonymous";
  const color = material?.color?.getHexString?.() || "none";
  const type = geometry?.type || "Geometry";
  const params = geometry?.parameters || {};
  const dims = [params.width, params.height, params.depth, params.radius, params.radiusTop, params.radiusBottom]
    .filter(Number.isFinite).map(v => Number(v).toFixed(2)).join("x");
  return `${prefix}:${fn}:${type}${dims ? `(${dims})` : ""}:#${color}`;
}

function tagPerformanceResource(mesh, label) {
  mesh.name = label;
  mesh.userData.performanceOwner = label;
  return mesh;
}

function makeInstancedRouteBoxes(parent, geometry, material, records) {
  const mesh = tagPerformanceResource(new THREE.InstancedMesh(geometry, material, records.length), performanceResourceLabel("route", geometry, material));
  // Route infrastructure is already built in short route chunks, so each
  // InstancedMesh can use its computed bounds for normal frustum culling.
  mesh.frustumCulled = true;
  mesh.userData.isCriticalRouteObject = false;
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  records.forEach((r, i) => {
    pos.set(r.x, r.y, r.z);
    euler.set(r.pitch || 0, r.yaw || 0, r.roll || 0, "YXZ");
    quat.setFromEuler(euler);
    scale.set(r.sx, r.sy, r.sz);
    matrix.compose(pos, quat, scale);
    mesh.setMatrixAt(i, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox?.();
  mesh.computeBoundingSphere?.();
  parent.add(mesh);
  return mesh;
}

function addCurvedDoubleTrack(parent, startM = 0, endM = ROUTE.length) {
  // 近景で形が崩れない範囲まで密度を抑え、チャンク単位で描画する。
  const stepM = 8;
  const ballastRecords = [];
  const leftRailRecords = [];
  const rightRailRecords = [];
  const sleeperRecords = [];

  for (let m = startM; m < endM; m += stepM) {
    const m2 = Math.min(endM, m + stepM);
    const mid = (m + m2) / 2;
    const segLength = sceneDistance(m2 - m) * 1.025;
    const bed = routePose(mid, 0);
    ballastRecords.push({x:bed.x,y:bed.y,z:bed.z,yaw:bed.yaw,pitch:bed.pitch,sx:10.4,sy:.20,sz:segLength});
    for (const trackOffset of [-2.5, 2.5]) {
      const p = routePose(mid, trackOffset);
      for (const railOffset of [-RAIL_CENTER_OFFSET, RAIL_CENTER_OFFSET]) {
        const rp = routePose(mid, trackOffset + railOffset);
        (railOffset < 0 ? leftRailRecords : rightRailRecords)
          .push({x:rp.x,y:rp.y + .25,z:rp.z,yaw:rp.yaw,pitch:rp.pitch,sx:.12,sy:.12,sz:segLength});
      }
    }
  }

  // 枕木は実感を戻しつつ、InstancedMeshでまとめて描画。
  for (let m = startM; m <= endM; m += 4.0) {
    for (const trackOffset of [-2.5, 2.5]) {
      const p = routePose(m, trackOffset);
      sleeperRecords.push({x:p.x,y:p.y + .13,z:p.z,yaw:p.yaw,pitch:p.pitch,sx:2.65,sy:.12,sz:.32});
    }
  }

  makeInstancedRouteBoxes(parent, new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({color:0x6d675d,roughness:.95}), ballastRecords);
  const railMat = new THREE.MeshStandardMaterial({color:0xc4cbd0,roughness:.35,metalness:.72});
  makeInstancedRouteBoxes(parent, new THREE.BoxGeometry(1,1,1), railMat, leftRailRecords);
  makeInstancedRouteBoxes(parent, new THREE.BoxGeometry(1,1,1), railMat, rightRailRecords);
  makeInstancedRouteBoxes(parent, new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({color:0x4b4138,roughness:.95}), sleeperRecords);
}


function smoothTrackTransition(t) {
  return smoothStep01(clamp(t, 0, 1));
}

// v67.5: 旭ヶ丘は停車標を0mとし、ホームは進行方向後方へ配置。
// 発車後はホーム先端を越えて十分な直線を走ってから本線へ合流する。
function operatingTrackLateral(meters) {
  // 停車標0mでは外側待避線上。ホーム先端をわずかに越えた位置から分岐を開始する。
  const { switchStartM, switchEndM } = DEPARTURE_GEOMETRY;
  if (meters <= switchStartM) return DEPARTURE_STATION_WORLD.spacing.leftOuter;
  if (meters < switchEndM) {
    const t = smoothTrackTransition((meters - switchStartM) / (switchEndM - switchStartM));
    return lerp(DEPARTURE_STATION_WORLD.spacing.leftOuter, DEPARTURE_STATION_WORLD.spacing.mainLeft, t);
  }
  return DEPARTURE_STATION_WORLD.spacing.mainLeft;
}


function opposingDepartureTrackLateral(meters) {
  const { switchStartM, switchEndM } = DEPARTURE_GEOMETRY;
  if (meters <= switchStartM) return DEPARTURE_STATION_WORLD.spacing.rightOuter;
  if (meters < switchEndM) {
    const t = smoothTrackTransition((meters - switchStartM) / (switchEndM - switchStartM));
    return lerp(DEPARTURE_STATION_WORLD.spacing.rightOuter, DEPARTURE_STATION_WORLD.spacing.mainRight, t);
  }
  return DEPARTURE_STATION_WORLD.spacing.mainRight;
}

// 横変位そのものの変化も接線へ反映する。これにより分岐線のレール、枕木、
// カメラが同じ滑らかな線形を共有し、本線合流部のねじれや食い違いを防ぐ。
function variableTrackPose(meters, lateralAt, localOffset = 0) {
  const sample = 1.5;
  const m0 = clamp(meters - sample, 0, ROUTE.length);
  const m1 = clamp(meters + sample, 0, ROUTE.length);
  const c = routePose(meters, lateralAt(meters));
  const a = routePose(m0, lateralAt(m0));
  const b = routePose(m1, lateralAt(m1));
  let tx = b.x - a.x, tz = b.z - a.z;
  const length = Math.hypot(tx, tz) || 1;
  tx /= length; tz /= length;
  const rx = -tz, rz = tx;
  const heading = Math.atan2(tx, -tz);
  return {x:c.x + rx*localOffset, y:c.y, elevationM:c.elevationM, z:c.z + rz*localOffset, tx, tz, rx, rz, heading, yaw:-heading, pitch:c.pitch, gradientPermille:c.gradientPermille};
}

function addVariableTrack(parent, startM, endM, lateralAt, options = {}) {
  const stepM = options.stepM || 6;
  const ballastRecords = [], leftRailRecords = [], rightRailRecords = [], sleeperRecords = [];
  for (let m = startM; m < endM; m += stepM) {
    const m2 = Math.min(endM, m + stepM);
    const mid = (m + m2) / 2;
    const p = variableTrackPose(mid, lateralAt);
    const len = sceneDistance(m2 - m) * 1.08;
    ballastRecords.push({x:p.x,y:p.y + .01,z:p.z,yaw:p.yaw,pitch:p.pitch,sx:4.25,sy:.16,sz:len});
    for (const railOffset of [-RAIL_CENTER_OFFSET, RAIL_CENTER_OFFSET]) {
      const rp = variableTrackPose(mid, lateralAt, railOffset);
      (railOffset < 0 ? leftRailRecords : rightRailRecords).push({x:rp.x,y:rp.y + .27,z:rp.z,yaw:rp.yaw,pitch:rp.pitch,sx:.12,sy:.12,sz:len});
    }
  }
  for (let m = startM; m <= endM; m += 3.2) {
    const p = variableTrackPose(m, lateralAt);
    sleeperRecords.push({x:p.x,y:p.y + .14,z:p.z,yaw:p.yaw,pitch:p.pitch,sx:2.62,sy:.12,sz:.30});
  }
  const ballastMat = new THREE.MeshStandardMaterial({color:0x70695f,roughness:.96});
  const railMat = new THREE.MeshStandardMaterial({color:0xc8cfd3,roughness:.30,metalness:.76});
  const sleeperMat = new THREE.MeshStandardMaterial({color:0x4a4037,roughness:.96});
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),ballastMat,ballastRecords);
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),railMat,leftRailRecords);
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),railMat,rightRailRecords);
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),sleeperMat,sleeperRecords);
}

function makeDiamondStopTexture(label = "停") {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,256,256);
  ctx.save();
  ctx.translate(128,128);
  ctx.rotate(Math.PI/4);
  ctx.fillStyle = "#d5222a";
  ctx.fillRect(-88,-88,176,176);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-68,-68,136,136);
  ctx.restore();
  ctx.fillStyle = "#111111";
  ctx.font = "900 76px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label,128,130);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function addStationStopMarker(parent, markerM, trackLateral, label = "停") {
  const p = routePose(markerM, trackLateral - 2.55);
  const pole = boxMesh(.16,2.3,.16,0x5d666c,.7,.25);
  pole.position.set(p.x,p.y + 1.15,p.z); pole.rotation.y=p.yaw; parent.add(pole);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02,1.02),
    new THREE.MeshBasicMaterial({map:makeDiamondStopTexture(label),transparent:true,alphaTest:.05,side:THREE.DoubleSide})
  );
  sign.position.set(p.x,p.y + 2.42,p.z);
  sign.rotation.y=p.yaw;
  parent.add(sign);
}

// 始発駅専用の島式ホーム。ホーム幅を先に確保し、車体半幅と隙間から
// 両側の線路中心を外へ配置する。ホームを狭めて線路へ押し込まない。
function addDepartureIslandPlatform(parent, startM, endM, lateral, stationName, platformWidth = TRACK_GEOMETRY.platformWidthM) {
  const step = 8;
  const platformMat = new THREE.MeshStandardMaterial({color:0xb8bec1,roughness:.9});
  const yellowMat = new THREE.MeshStandardMaterial({color:0xe5c23f,roughness:.8});
  const roofMat = new THREE.MeshStandardMaterial({color:0xd9dfe2,roughness:.82});
  const pillarMat = new THREE.MeshStandardMaterial({color:0x77838a,roughness:.72,metalness:.18});
  for (let m=startM; m<endM; m+=step) {
    const m2=Math.min(endM,m+step), mid=(m+m2)/2;
    const len=sceneDistance(m2-m)*1.035;
    const p=routePoseExtended(mid,lateral);
    const slab=new THREE.Mesh(new THREE.BoxGeometry(platformWidth,.55,len),platformMat);
    applyRoutePose(slab,p,(window.TrainVerticalDimensions?.routeRailTopOffsetY ?? .33) + (window.TrainVerticalDimensions?.platformTopAboveRail ?? 1.25) - .275); parent.add(slab);
    const yellowInset = TRACK_GEOMETRY.yellowLineInsetM ?? 0.8;
    for (const edgeLat of [lateral-platformWidth/2+yellowInset,lateral+platformWidth/2-yellowInset]) {
      const e=routePoseExtended(mid,edgeLat);
      const yellow=new THREE.Mesh(new THREE.BoxGeometry(.18,.05,len),yellowMat);
      applyRoutePose(yellow,e,(window.TrainVerticalDimensions?.routeRailTopOffsetY ?? .33) + (window.TrainVerticalDimensions?.platformTopAboveRail ?? 1.25) + .035); parent.add(yellow);
    }
  }
  for (let m=startM+20; m<=endM-18; m+=36) {
    const p=routePoseExtended(m,lateral);
    const pillar=new THREE.Mesh(new THREE.BoxGeometry(.16,2.65,.16),pillarMat);
    pillar.position.set(p.x,p.y + 2.70,p.z); pillar.rotation.y=p.yaw; parent.add(pillar);
  }
  for (let m=startM; m<endM; m+=16) {
    const m2=Math.min(endM,m+16), mid=(m+m2)/2;
    const p=routePoseExtended(mid,lateral);
    const roof=new THREE.Mesh(new THREE.BoxGeometry(Math.min(TRACK_GEOMETRY.roofWidthM ?? 8.4, platformWidth-1.2),.16,sceneDistance(m2-m)*1.02),roofMat);
    applyRoutePose(roof,p,4.00); parent.add(roof);
  }
  const signP=routePoseExtended((startM+endM)/2,lateral);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(3.4,.9),new THREE.MeshBasicMaterial({map:makeCanvasLabel(stationName),side:THREE.DoubleSide}));
  sign.position.set(signP.x,signP.y + 3.12,signP.z); sign.rotation.y=signP.yaw+Math.PI/2; parent.add(sign);
}

function addExtendedStraightTrack(parent,startM,endM,lateral) {
  const stepM=6;
  const ballast=[],left=[],right=[],sleepers=[];
  for(let m=startM;m<endM;m+=stepM){
    const m2=Math.min(endM,m+stepM),mid=(m+m2)/2,p=routePoseExtended(mid,lateral),len=sceneDistance(m2-m)*1.06;
    ballast.push({x:p.x,y:p.y + .01,z:p.z,yaw:p.yaw,pitch:p.pitch,sx:4.25,sy:.16,sz:len});
    for(const ro of [-RAIL_CENTER_OFFSET,RAIL_CENTER_OFFSET]){
      const rp=routePoseExtended(mid,lateral+ro);
      (ro<0?left:right).push({x:rp.x,y:rp.y + .27,z:rp.z,yaw:rp.yaw,pitch:rp.pitch,sx:.12,sy:.12,sz:len});
    }
  }
  for(let m=startM;m<=endM;m+=3.2){const p=routePoseExtended(m,lateral);sleepers.push({x:p.x,y:p.y + .14,z:p.z,yaw:p.yaw,pitch:p.pitch,sx:2.62,sy:.12,sz:.30});}
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x70695f,roughness:.96}),ballast);
  const railMat=new THREE.MeshStandardMaterial({color:0xc8cfd3,roughness:.30,metalness:.76});
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),railMat,left);
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),railMat,right);
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x4a4037,roughness:.96}),sleepers);
}

function addDepartureStation(parent) {
  // v68.6 旭ヶ丘：上下線とも島式ホームを備えた完全な2面4線。
  // 4本の駅構内線をホーム端まで連続生成し、左右の外側待避線を同じ開始・終了距離で本線へ接続する。
  const { platformStartM, platformEndM, switchStartM, switchEndM } = DEPARTURE_GEOMETRY;
  const tracks = DEPARTURE_WORLD_SPEC?.trackCenters || [-OUTER_SIDING, MAIN_LEFT_TRACK, MAIN_RIGHT_TRACK, OUTER_SIDING];
  const platforms = DEPARTURE_WORLD_SPEC?.platformCenters || [-ISLAND_CENTER, ISLAND_CENTER];

  for(const lat of tracks) addExtendedStraightTrack(parent,platformStartM-80,switchStartM,lat);

  // 停車ビューと同じWorldSpecのホーム中心・線路中心を使用。
  platforms.forEach(center => addDepartureIslandPlatform(parent,platformStartM,platformEndM,center,'旭ヶ丘',DEPARTURE_WORLD_SPEC?.platformWidth || TRACK_GEOMETRY.platformWidthM));
  addStationStopMarker(parent,0,DEPARTURE_WORLD_SPEC.spacing.leftOuter,'停');
  addStationStopMarker(parent,0,DEPARTURE_WORLD_SPEC.spacing.rightOuter,'停');

  // ホーム先端の直線からポイントへ入り、分岐終了点で本線の位置・接線へ完全一致させる。
  addVariableTrack(parent,switchStartM,switchEndM,operatingTrackLateral,{stepM:3});
  addVariableTrack(parent,switchStartM,switchEndM,opposingDepartureTrackLateral,{stepM:3});

  // 分岐後の本線を明示的に重ねて生成し、後続の通常軌道との微小な描画隙間を防止。
  addExtendedStraightTrack(parent,switchEndM-8,switchEndM+320,DEPARTURE_WORLD_SPEC.spacing.mainLeft);
  addExtendedStraightTrack(parent,switchEndM-8,switchEndM+320,DEPARTURE_WORLD_SPEC.spacing.mainRight);

  // 始発駅外周の防音壁。通常高架側の clearanceZone で省略される区間を、
  // StationWorldSpec から派生した外側位置で連続補完する。
  const structure = window.StationStructureSpec?.resolve("asahigaoka");
  if (structure) {
    const wallStart = platformStartM - 120;
    const wallEnd = switchEndM + 360;
    for (const lateral of [structure.walls.leftZ, structure.walls.rightZ]) {
      addRouteStrip(parent, wallStart, wallEnd, lateral,
        structure.walls.thickness, structure.walls.height,
        structure.walls.centerAboveRail, 0xc1c9cc, 8);
    }
  }
}

function addFourTrackStation(parent, markerM, stationName, options = {}) {
  const stationId = options.stationId || (stationName === "潮見中央" ? "shiomichuo" : "asahigaoka");
  const world = window.StationWorldSpec.resolve(stationId);
  const length = options.length || world.platformLengthM || 420;
  const startM = markerM - length;
  const endM = markerM + (options.tail || world.turnout.parallelAfter || 80);
  const downSiding = world.tracks.find(t=>t.id==="down-siding");
  const upSiding = world.tracks.find(t=>t.id==="up-siding");
  const downMain = world.tracks.find(t=>t.id==="down-main");
  const upMain = world.tracks.find(t=>t.id==="up-main");
  if(!downSiding||!upSiding||!downMain||!upMain) return;
  addVariableTrack(parent,startM-180,endM+180,()=>downSiding.centerZ);
  addVariableTrack(parent,startM-180,endM+180,()=>upSiding.centerZ);
  const tr=world.turnout.transitionLength;
  const gap=world.turnout.approachLength;
  addVariableTrack(parent,startM-tr-gap,startM-gap,m=>lerp(downMain.centerZ,downSiding.centerZ,smoothTrackTransition((m-(startM-tr-gap))/tr)));
  addVariableTrack(parent,startM-tr-gap,startM-gap,m=>lerp(upMain.centerZ,upSiding.centerZ,smoothTrackTransition((m-(startM-tr-gap))/tr)));
  addVariableTrack(parent,endM+gap,endM+gap+tr,m=>lerp(downSiding.centerZ,downMain.centerZ,smoothTrackTransition((m-(endM+gap))/tr)));
  addVariableTrack(parent,endM+gap,endM+gap+tr,m=>lerp(upSiding.centerZ,upMain.centerZ,smoothTrackTransition((m-(endM+gap))/tr)));
  world.platforms.forEach(p=>addIslandPlatform(parent,startM,endM,p.centerZ,stationName,p.width));
  addStationStopMarker(parent,markerM,downMain.centerZ);
}

// 桜野専用：相対式2面4線。外側待避線だけにホームを設け、
// 中央2本の通過線（±2.5m）にはホームを一切置かない。
function addRelativeFourTrackStation(parent, markerM, stationName, options = {}) {
  const stationId=options.stationId||"sakurano";
  const world=window.StationWorldSpec.resolve(stationId);
  const length=options.length||world.platformLengthM||420;
  const startM=markerM-length, endM=markerM+(options.tail||80);
  const downSiding=world.tracks.find(t=>t.id==="down-siding"), upSiding=world.tracks.find(t=>t.id==="up-siding");
  const downMain=world.tracks.find(t=>t.id==="down-main"), upMain=world.tracks.find(t=>t.id==="up-main");
  const tr=world.turnout.transitionLength, gap=world.turnout.approachLength;
  for(const t of [downSiding,upSiding]) addVariableTrack(parent,startM-180,endM+180,()=>t.centerZ);
  addVariableTrack(parent,startM-tr-gap,startM-gap,m=>lerp(downMain.centerZ,downSiding.centerZ,smoothTrackTransition((m-(startM-tr-gap))/tr)));
  addVariableTrack(parent,startM-tr-gap,startM-gap,m=>lerp(upMain.centerZ,upSiding.centerZ,smoothTrackTransition((m-(startM-tr-gap))/tr)));
  addVariableTrack(parent,endM+gap,endM+gap+tr,m=>lerp(downSiding.centerZ,downMain.centerZ,smoothTrackTransition((m-(endM+gap))/tr)));
  addVariableTrack(parent,endM+gap,endM+gap+tr,m=>lerp(upSiding.centerZ,upMain.centerZ,smoothTrackTransition((m-(endM+gap))/tr)));
  addSidePlatform(parent,startM,endM,downSiding.centerZ,-1,stationName,world.platforms[0].width);
  addSidePlatform(parent,startM,endM,upSiding.centerZ,1,stationName,world.platforms[1].width);
  addStationStopMarker(parent,markerM,downMain.centerZ);
}


const STRUCTURE_SEGMENTS = (window.ATCRoadbedEngine && window.ATCRoadbedEngine.sections) || window.ATC_STRUCTURE_SEGMENTS || [
  {startM:0,endM:ROUTE.length,type:"viaduct",label:"高架区間"}
];
const STRUCTURE_SETTINGS = (window.ATCRoadbedEngine && window.ATCRoadbedEngine.settings) || window.ATC_STRUCTURE_SETTINGS || {};

function structureSegmentAt(meters) {
  if (window.ATCRoadbedEngine) return window.ATCRoadbedEngine.at(meters);
  return STRUCTURE_SEGMENTS.find(segment => meters >= segment.startM && meters < segment.endM)
    || STRUCTURE_SEGMENTS[STRUCTURE_SEGMENTS.length - 1];
}

function addRouteStrip(parent, startM, endM, lateral, widthM, heightM, yM, color, stepM = 10, diagnostic = {}) {
  // alpha21 performance test: make each RouteStrip segment twice as long.
  // Geometry shape and route following remain unchanged; only subdivision density is reduced.
  const effectiveStepM = Math.max(1, stepM * 2);
  const records = [];
  for (let m = startM; m < endM; m += effectiveStepM) {
    const m2 = Math.min(endM, m + effectiveStepM);
    const mid = (m + m2) * 0.5;
    const p = routePose(mid, lateral);
    records.push({x:p.x,y:p.y + yM,z:p.z,yaw:p.yaw,pitch:p.pitch,sx:widthM,sy:heightM,sz:sceneDistance(m2-m)*1.05});
  }
  const mesh = makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color,roughness:.94}),records);
  mesh.userData.performanceStructure = diagnostic.structure || parent?.userData?.structureType || "unknown";
  mesh.userData.performancePurpose = diagnostic.purpose || "route-strip-other";
  mesh.userData.performanceChunkStartM = parent?.userData?.startM;
  mesh.userData.performanceChunkEndM = parent?.userData?.endM;
  return mesh;
}

function tagStructureDiagnostic(mesh, parent, structure, purpose) {
  if (!mesh) return mesh;
  mesh.userData.performanceStructure = structure || parent?.userData?.structureType || "unknown";
  mesh.userData.performancePurpose = purpose || "other";
  mesh.userData.performanceChunkStartM = parent?.userData?.startM;
  mesh.userData.performanceChunkEndM = parent?.userData?.endM;
  return mesh;
}

function isStructureClearanceZone(meters){
  const zones = STRUCTURE_SETTINGS.clearanceZones || [
    {startM:0,endM:1500},
    {startM:17400,endM:18600},
    {startM:51000,endM:52000}
  ];
  return zones.some(zone => meters >= zone.startM && meters <= zone.endM);
}

function addViaductStructure(parent,startM,endM) {
  const cfg=STRUCTURE_SETTINGS.viaduct || {deckWidthM:13.2,stationDeckWidthM:42.0,wallOffsetM:6.25,pierIntervalM:48,barrierHeightM:2.1};
  const stepM=10;
  const deckRecords=[], leftWallRecords=[], rightWallRecords=[];
  for(let m=startM;m<endM;m+=stepM){
    const m2=Math.min(endM,m+stepM), mid=(m+m2)*.5;
    const clearance=isStructureClearanceZone(mid);
    const width=clearance ? cfg.stationDeckWidthM : cfg.deckWidthM;
    const p=routePose(mid,0);
    deckRecords.push({x:p.x,y:p.y - .36,z:p.z,yaw:p.yaw,pitch:p.pitch,sx:width,sy:.72,sz:sceneDistance(m2-m)*1.06});
    if(!clearance){
      for(const side of [-1,1]){
        const w=routePose(mid,side*cfg.wallOffsetM);
        (side<0?leftWallRecords:rightWallRecords).push({x:w.x,y:w.y + .92,z:w.z,yaw:w.yaw,pitch:w.pitch,sx:.28,sy:cfg.barrierHeightM,sz:sceneDistance(m2-m)*1.06});
      }
    }
  }
  tagStructureDiagnostic(makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x9aa3a7,roughness:.92}),deckRecords),parent,"viaduct","deck");
  const wallMat=new THREE.MeshStandardMaterial({color:0xc1c9cc,roughness:.86});
  if(leftWallRecords.length) tagStructureDiagnostic(makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),wallMat,leftWallRecords),parent,"viaduct","barrier-wall");
  if(rightWallRecords.length) tagStructureDiagnostic(makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),wallMat,rightWallRecords),parent,"viaduct","barrier-wall");
  // 高架下の地面を十分低く置き、床版の外側を空間として見せる。
  addRouteStrip(parent,startM,endM,0,90,.45,-9.0,0x5f7652,24,{structure:"viaduct",purpose:"ground-below"});
  for(let m=Math.ceil(startM/cfg.pierIntervalM)*cfg.pierIntervalM;m<endM;m+=cfg.pierIntervalM){
    const clearance=isStructureClearanceZone(m);
    const p=routePose(m,0);
    const pier=boxMesh(clearance?2.8:2.1,8.2,2.4,0x858f94);
    pier.position.set(p.x,p.y - 4.55,p.z); pier.rotation.y=p.yaw; parent.add(pier);
    const cap=boxMesh(clearance?Math.min(cfg.stationDeckWidthM-4,28):10.5,.72,2.9,0x9ca5a9);
    cap.position.set(p.x,p.y - .82,p.z); cap.rotation.y=p.yaw; parent.add(cap);
  }
}

function addGroundStructure(parent,startM,endM) {
  const cfg=STRUCTURE_SETTINGS.ground || {formationWidthM:12.4,terrainWidthM:78,ditchOffsetM:6.8,fenceOffsetM:8.0};
  // 周囲の自然地盤は線路面とほぼ同じ高さ。路盤だけ色と高さを分離する。
  addRouteStrip(parent,startM,endM,0,Math.max(106,cfg.terrainWidthM),.36,-.60,0x6e8758,18,{structure:"ground",purpose:"terrain"});
  addRouteStrip(parent,startM,endM,0,34,.26,-.43,0x76866a,10,{structure:"ground",purpose:"subgrade"});
  addRouteStrip(parent,startM,endM,0,22,.28,-.32,0x8d8a7f,8,{structure:"ground",purpose:"roadbed"});
  addRouteStrip(parent,startM,endM,0,cfg.formationWidthM,.30,-.22,0x8c887d,8,{structure:"ground",purpose:"formation"});
  for(const side of [-1,1]){
    addRouteStrip(parent,startM,endM,side*cfg.ditchOffsetM,.58,.34,-.30,0x4e6368,12,{structure:"ground",purpose:"ditch"});
    // 細いフェンス柱を一定間隔で配置。
    for(let m=Math.ceil(startM/55)*55;m<endM;m+=55){
      const p=routePose(m,side*cfg.fenceOffsetM);
      const post=boxMesh(.12,1.55,.12,0x53605d);
      post.position.set(p.x,p.y + .35,p.z); post.rotation.y=p.yaw; parent.add(post);
    }
  }
}

function addEmbankmentStructure(parent,startM,endM) {
  const cfg=STRUCTURE_SETTINGS.embankment || {topWidthM:15.5,slopeWidthM:9.5,heightM:5.2,terrainWidthM:92};
  const topHalf=cfg.topWidthM*.5;
  const formationWidth=Math.min(10.8,cfg.topWidthM-3.6);
  const shoulderWidth=Math.max(1.6,(cfg.topWidthM-formationWidth)*.5);
  const shoulderCenter=formationWidth*.5+shoulderWidth*.5;

  // 法面下の元地盤。線路面との差を実座標として明確にする。
  addRouteStrip(parent,startM,endM,0,cfg.terrainWidthM,.42,-cfg.heightM-.72,0x668451,18,{structure:"embankment",purpose:"terrain"});

  // 中央路盤と左右の平らな路肩（天端）を別素材で描く。
  addRouteStrip(parent,startM,endM,0,formationWidth,.34,-.22,0x858178,8,{structure:"embankment",purpose:"formation"});
  for(const side of [-1,1]){
    addRouteStrip(parent,startM,endM,side*shoulderCenter,shoulderWidth,.22,-.20,0xa39b84,8,{structure:"embankment",purpose:"shoulder"});
    // 路肩外端の排水・縁石。天端と法面の境界線をはっきり見せる。
    addRouteStrip(parent,startM,endM,side*(topHalf-.24),.42,.20,-.12,0x5d696a,8,{structure:"embankment",purpose:"curb-drain"});
  }

  // 法面は細い水平板の積層ではなく、十分な密度で連続斜面に見せる。
  // Performance trial: embankment slope layers reduced from 40 to 15.
  // Cutting remains at 18 so this A/B test changes only the confirmed hotspot.
  const layers=15;
  for(let i=0;i<layers;i++){
    const t=(i+.5)/layers;
    const lateral=topHalf+cfg.slopeWidthM*t;
    const stripWidth=cfg.slopeWidthM/layers+.18;
    const y=-.38-cfg.heightM*t;
    const color=i<4?0x6f8954:(i<14?0x60804b:0x557244);
    for(const side of [-1,1]) addRouteStrip(parent,startM,endM,side*lateral,stripWidth,cfg.heightM/layers+.12,y,color,6,{structure:"embankment",purpose:"slope-layer"});
  }

  // 肩の連続柵。支柱だけでなく横桟を通して、盛り土上端を視覚的に固定する。
  for(const side of [-1,1]){
    const fenceLat=side*(topHalf-.62);
    addRouteStrip(parent,startM,endM,fenceLat,.12,.12,.52,0x4f5c59,8,{structure:"embankment",purpose:"fence-rail"});
    addRouteStrip(parent,startM,endM,fenceLat,.10,.10,1.02,0x4f5c59,8,{structure:"embankment",purpose:"fence-rail"});
    for(let m=Math.ceil(startM/32)*32;m<endM;m+=32){
      const pp=routePose(m,fenceLat);
      const post=boxMesh(.12,1.35,.12,0x4f5c59);
      post.position.set(pp.x,pp.y+.42,pp.z); post.rotation.y=pp.yaw; parent.add(post);
    }
  }
}

function addCuttingStructure(parent,startM,endM,segment={}) {
  const cfg={...(STRUCTURE_SETTINGS.cutting||{}),...segment};
  const depth=cfg.depthM||5.0;
  const formation=cfg.formationWidthM||13.0;
  const shoulder=cfg.bottomShoulderM||3.0;
  const slopeWidth=cfg.slopeWidthM||10.5;
  const wallType=cfg.wallType||"mixed";
  addRouteStrip(parent,startM,endM,0,formation,.30,-.22,0x8c887d,10,{structure:"cutting",purpose:"formation"});
  for(const side of [-1,1]){
    const layers=18;
    for(let i=0;i<layers;i++){
      const t=(i+.5)/layers;
      const lateral=side*(formation/2+shoulder+slopeWidth*t);
      const width=slopeWidth/layers+0.35;
      const y=-.35+depth*t;
      const concrete=wallType==="concrete" || (wallType==="mixed" && t<.48);
      const color=concrete?0x8b9293:(wallType==="rock"?0x6f7168:0x647c4d);
      addRouteStrip(parent,startM,endM,lateral,width,depth/layers+.12,y,color,8,{structure:"cutting",purpose:"slope-layer"});
    }
    for(let m=Math.ceil(startM/70)*70;m<endM;m+=70){
      const pp=routePose(m,side*(formation/2+shoulder+.3));
      const post=boxMesh(.12,1.35,.12,0x56615d);
      post.position.set(pp.x,pp.y+.35,pp.z); post.rotation.y=pp.yaw; parent.add(post);
    }
  }
}

function addBridgeStructure(parent,startM,endM) {
  const cfg=STRUCTURE_SETTINGS.bridge||STRUCTURE_SETTINGS.viaduct||{};
  addViaductStructure(parent,startM,endM);
  // 水面を線路より低く置き、橋梁区間だと視覚的に分かるようにする。
  addRouteStrip(parent,startM,endM,0,120,.18,-10.2,0x4f91b5,18,{structure:"bridge",purpose:"water"});
}

function addTunnelStructure(parent,startM,endM) {
  const cfg=STRUCTURE_SETTINGS.tunnel || {innerWidthM:12.6,innerHeightM:7.7,wallThicknessM:.65,lampIntervalM:110};
  const half=cfg.innerWidthM/2;
  addRouteStrip(parent,startM,endM,-half,cfg.wallThicknessM,cfg.innerHeightM,3.55,0x34393b,8,{structure:"tunnel",purpose:"wall"});
  addRouteStrip(parent,startM,endM, half,cfg.wallThicknessM,cfg.innerHeightM,3.55,0x34393b,8,{structure:"tunnel",purpose:"wall"});
  addRouteStrip(parent,startM,endM,0,cfg.innerWidthM+.8,.70,cfg.innerHeightM-.05,0x2d3234,8,{structure:"tunnel",purpose:"ceiling"});
  addRouteStrip(parent,startM,endM,0,cfg.innerWidthM,.28,-.20,0x565553,8,{structure:"tunnel",purpose:"floor"});
  for(let m=startM+55;m<endM;m+=cfg.lampIntervalM){
    for(const side of [-1,1]){
      const p=routePose(m,side*(half-.55));
      const lamp=boxMesh(.24,.18,1.0,0xffe6a8,0,0);
      lamp.material=new THREE.MeshBasicMaterial({color:0xffe6a8});
      lamp.position.set(p.x,p.y + 6.25,p.z); lamp.rotation.y=p.yaw; parent.add(lamp);
    }
  }
  // 坑口は区間端の接線に合わせる。
  for(const m of [startM,endM]){
    const c=routePose(m,0);
    const lintel=boxMesh(cfg.innerWidthM+2.2,1.4,1.0,0x646a6c);
    lintel.position.set(c.x,c.y + cfg.innerHeightM-.45,c.z); lintel.rotation.y=c.yaw; parent.add(lintel);
    for(const side of [-1,1]){
      const p=routePose(m,side*(half+.65));
      const portal=boxMesh(1.35,cfg.innerHeightM+.5,1.0,0x646a6c);
      portal.position.set(p.x,p.y + 3.45,p.z); portal.rotation.y=p.yaw; parent.add(portal);
    }
  }
}

function addStructureSegment(parent,startM,endM,type,segment={}){
  const context={parent,startM,endM,segment,helpers:{addGroundStructure,addEmbankmentStructure,addCuttingStructure,addTunnelStructure,addViaductStructure,addBridgeStructure}};
  if(window.ATCRoadbedRenderer && window.ATCRoadbedRenderer.types().length){
    window.ATCRoadbedRenderer.render(type,context);
    return;
  }
  switch(type){
    case "ground": addGroundStructure(parent,startM,endM); break;
    case "embankment": addEmbankmentStructure(parent,startM,endM); break;
    case "cutting": addCuttingStructure(parent,startM,endM,segment); break;
    case "bridge": addBridgeStructure(parent,startM,endM); break;
    case "tunnel": addTunnelStructure(parent,startM,endM); break;
    case "viaduct":
    default: addViaductStructure(parent,startM,endM); break;
  }
}

if(window.ATCRoadbedRenderer){
  ATCRoadbedRenderer.register("ground",c=>c.helpers.addGroundStructure(c.parent,c.startM,c.endM));
  ATCRoadbedRenderer.register("embankment",c=>c.helpers.addEmbankmentStructure(c.parent,c.startM,c.endM));
  ATCRoadbedRenderer.register("cutting",c=>c.helpers.addCuttingStructure(c.parent,c.startM,c.endM,c.segment));
  ATCRoadbedRenderer.register("bridge",c=>c.helpers.addBridgeStructure(c.parent,c.startM,c.endM));
  ATCRoadbedRenderer.register("tunnel",c=>c.helpers.addTunnelStructure(c.parent,c.startM,c.endM));
  ATCRoadbedRenderer.register("viaduct",c=>c.helpers.addViaductStructure(c.parent,c.startM,c.endM));
}

function addCurvedElevatedDeck(parent, startM = 0, endM = ROUTE.length) {
  const stepM = 10;
  const slabRecords = [];
  const leftWallRecords = [];
  const rightWallRecords = [];
  for (let m = startM; m < endM; m += stepM) {
    const m2 = Math.min(endM, m + stepM);
    const mid = (m + m2) / 2;
    const len = sceneDistance(m2 - m) * 1.04;
    const c = routePose(mid, 0);
    slabRecords.push({x:c.x,y:c.y - .20,z:c.z,yaw:c.yaw,pitch:c.pitch,sx:(OUTER_SIDING*2+5.0),sy:.55,sz:len});
    const l = routePose(mid,-(OUTER_SIDING+2.2)), r = routePose(mid,(OUTER_SIDING+2.2));
    leftWallRecords.push({x:l.x,y:l.y + 1.15,z:l.z,yaw:l.yaw,pitch:l.pitch,sx:.42,sy:2.6,sz:len});
    rightWallRecords.push({x:r.x,y:r.y + 1.15,z:r.z,yaw:r.yaw,pitch:r.pitch,sx:.42,sy:2.6,sz:len});
  }
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({color:0x9ca4a7,roughness:.92}),slabRecords);
  const wallMat=new THREE.MeshStandardMaterial({color:0xb8c0c2,roughness:.88});
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),wallMat,leftWallRecords);
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),wallMat,rightWallRecords);
}

function addCurvedGantries(parent, startM = 0, endM = ROUTE.length) {
  // v65.1: 線路間を横切る横梁は一切生成しない。
  // 左右の柱と、各柱から担当線へ向かう短い片持ち腕だけを描く。
  const poleMat = new THREE.MeshStandardMaterial({color:0x59636a,roughness:.65,metalness:.42});
  const poleRecords = [];
  for (let m = Math.max(80, startM + 40); m < endM; m += 120) {
    for (const side of [-1, 1]) {
      const pole = routePose(m, side * (OUTER_SIDING + 1.8));
      poleRecords.push({x:pole.x,y:pole.y + 3.75,z:pole.z,yaw:pole.yaw,sx:.25,sy:7.5,sz:.25});

      const wire = routePose(m, side * 2.5);
      const dx = wire.x - pole.x;
      const dz = wire.z - pole.z;
      const length = Math.hypot(dx, dz);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(length, .14, .14), poleMat);
      arm.position.set((wire.x + pole.x) * .5, (wire.y + pole.y) * .5 + 6.85, (wire.z + pole.z) * .5);
      arm.rotation.y = -Math.atan2(dz, dx);
      parent.add(arm);
    }
  }
  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),poleMat,poleRecords);
}

// v65: 各線の接触線だけを滑らかに描画する。
// 吊架線・ハンガー・線路中央のワイヤーを生成しないため、前面からは各線1本に見える。
function addCurvedCatenary(parent, startM = 0, endM = ROUTE.length) {
  const wireMat = new THREE.MeshBasicMaterial({color:0x242b2f});
  const contactRecords = [];
  const stepM = 8;

  for (let m = startM; m < endM; m += stepM) {
    const m2 = Math.min(endM, m + stepM);
    const mid = (m + m2) * 0.5;
    const len = sceneDistance(m2 - m) * 1.035;
    for (const trackOffset of [-2.5, 2.5]) {
      const p = routePose(mid, trackOffset);
      contactRecords.push({x:p.x,y:p.y + 5.72,z:p.z,yaw:p.yaw,pitch:p.pitch,sx:.032,sy:.032,sz:len});
    }
  }

  makeInstancedRouteBoxes(parent,new THREE.BoxGeometry(1,1,1),wireMat,contactRecords);
}

function addRouteAlignedScenery(parent) {
  const trunkMat = new THREE.MeshStandardMaterial({color:0x60452f,roughness:1});
  const treeMats = [0x35643a,0x437848,0x2e5834].map(color => new THREE.MeshStandardMaterial({color,roughness:1}));
  const buildingMats = [0x87949a,0xa1a8aa,0x71828b,0xb4afa4].map(color => new THREE.MeshStandardMaterial({color,roughness:.92}));
  const roofMats = [0x59666c,0x6e625d,0x58616a].map(color => new THREE.MeshStandardMaterial({color,roughness:.9}));

  // 全線に最低限の街並みを置く。中心線からの相対距離だけで配置し、カーブにも追従。
  for (let m = 120, i = 0; m < ROUTE.length - 120; m += 110, i++) {
    for (const side of [-1,1]) {
      const stationNear = Math.abs(m-ROUTE.passStation.position)<1800 || Math.abs(m-ROUTE.curveStation.position)<1800 || m>47000;
      const curvature = routeCurvature(m);
      const curveClearance = Math.min(18, Math.abs(curvature) * 22000);
      const insideCurve = Math.sign(curvature) === side;
      const insideExtra = insideCurve ? 12 : 0;
      const lateral = side * ((stationNear ? 30 : 36) + curveClearance + insideExtra + ((i*5 + (side>0?4:0))%18));
      const p = routePose(m + (side > 0 ? 35 : 0), lateral);

      const makeBuilding = stationNear || (i + (side>0?1:0)) % 3 !== 1;
      if (makeBuilding) {
        const highRise = stationNear && i % 5 === 0;
        const w = highRise ? 16 : 8 + (i%3)*2.2;
        const d = highRise ? 18 : 10 + (i%4)*1.8;
        const h = highRise ? 38 + (i%4)*8 : 9 + (i%5)*3.0;
        const building = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), buildingMats[i%buildingMats.length]);
        building.position.set(p.x,p.y + h/2-.15,p.z);
        building.rotation.y=p.yaw;
        parent.add(building);

        const roof = new THREE.Mesh(new THREE.BoxGeometry(w*.86,.28,d*.86),roofMats[i%roofMats.length]);
        roof.position.set(p.x,p.y + h-.02,p.z);
        roof.rotation.y=p.yaw;
        parent.add(roof);
      } else {
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.16,.23,1.6,6),trunkMat);
        trunk.position.set(p.x,p.y + .7,p.z);
        parent.add(trunk);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.25+(i%3)*.18,3.6+(i%2),6),treeMats[i%treeMats.length]);
        crown.position.set(p.x,p.y + 2.7,p.z);
        parent.add(crown);
      }
    }
  }
}

function addTerminalBallastAndBuffer(parent) {
  const ballastMat = new THREE.MeshStandardMaterial({color:0x655f57,roughness:1});
  const step=8;
  for(let m=51000;m<ROUTE.bufferStopPosition;m+=step){
    const m2=Math.min(ROUTE.bufferStopPosition,m+step), mid=(m+m2)/2;
    const p=routePose(mid,0);
    const bed=new THREE.Mesh(new THREE.BoxGeometry(24.5,.24,sceneDistance(m2-m)*1.04),ballastMat);
    applyRoutePose(bed,p,.03); parent.add(bed);
  }
  const group=new THREE.Group();
  const steel=new THREE.MeshStandardMaterial({color:0x3e4448,roughness:.55,metalness:.75});
  const hazard=new THREE.MeshStandardMaterial({color:0xe1a929,roughness:.7});
  const red=new THREE.MeshStandardMaterial({color:0xd93131,emissive:0x5a0000,emissiveIntensity:.8});
  const p=routePose(ROUTE.bufferStopPosition,MAIN_LEFT_TRACK);
  const cross=new THREE.Mesh(new THREE.BoxGeometry(4.2,.42,.42),hazard); cross.position.set(0,1.05,0); group.add(cross);
  for(const x of [-1.55,1.55]){
    const leg=new THREE.Mesh(new THREE.BoxGeometry(.28,1.55,.28),steel); leg.position.set(x,.62,.25); leg.rotation.x=.28; group.add(leg);
    const lamp=new THREE.Mesh(new THREE.SphereGeometry(.18,12,8),red); lamp.position.set(x,1.38,-.12); group.add(lamp);
  }
  group.position.set(p.x,p.y + .08,p.z); group.rotation.y=p.yaw; group.rotation.x=p.pitch || 0; parent.add(group);
}

function addPlatformStructure(parent, startM, endM, centerLateral, widthM, stationName, yellowEdges) {
  const step = 8;
  const platformMat = new THREE.MeshStandardMaterial({color:0xb8bec1,roughness:.9});
  const yellowMat = new THREE.MeshStandardMaterial({color:0xe5c23f,roughness:.8});
  const roofMat = new THREE.MeshStandardMaterial({color:0xd9dfe2,roughness:.82});
  const pillarMat = new THREE.MeshStandardMaterial({color:0x77838a,roughness:.72,metalness:.18});
  const yellowInset = TRACK_GEOMETRY.yellowLineInsetM ?? .8;

  for (let m=startM; m<endM; m+=step) {
    const m2=Math.min(endM,m+step), mid=(m+m2)/2;
    const len=sceneDistance(m2-m)*1.035;
    const p=routePose(mid,centerLateral);
    const slab=new THREE.Mesh(new THREE.BoxGeometry(widthM,.55,len),platformMat);
    applyRoutePose(slab,p,(window.TrainVerticalDimensions?.routeRailTopOffsetY ?? .33) + (window.TrainVerticalDimensions?.platformTopAboveRail ?? 1.25) - .275); parent.add(slab);
    for (const edgeSign of yellowEdges) {
      const edgeLat=centerLateral + edgeSign*(widthM/2-yellowInset);
      const e=routePose(mid,edgeLat);
      const yellow=new THREE.Mesh(new THREE.BoxGeometry(.18,.05,len),yellowMat);
      applyRoutePose(yellow,e,(window.TrainVerticalDimensions?.routeRailTopOffsetY ?? .33) + (window.TrainVerticalDimensions?.platformTopAboveRail ?? 1.25) + .035); parent.add(yellow);
    }
  }
  for (let m=startM+20; m<=endM-18; m+=36) {
    const p=routePose(m,centerLateral);
    const pillar=new THREE.Mesh(new THREE.BoxGeometry(.18,2.65,.18),pillarMat);
    pillar.position.set(p.x,p.y + 2.70,p.z); pillar.rotation.y=p.yaw; parent.add(pillar);
  }
  for (let m=startM; m<endM; m+=16) {
    const m2=Math.min(endM,m+16), mid=(m+m2)/2;
    const p=routePose(mid,centerLateral);
    const roofWidth=Math.min(TRACK_GEOMETRY.roofWidthM ?? 10,widthM-1.2);
    const roof=new THREE.Mesh(new THREE.BoxGeometry(roofWidth,.16,sceneDistance(m2-m)*1.02),roofMat);
    applyRoutePose(roof,p,4.00); parent.add(roof);
  }
  const signP=routePose((startM+endM)/2,centerLateral);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(4.6,1.15),new THREE.MeshBasicMaterial({map:makeCanvasLabel(stationName),side:THREE.DoubleSide}));
  sign.position.set(signP.x,signP.y + 3.15,signP.z); sign.rotation.y=signP.yaw+Math.PI/2; parent.add(sign);
}

function addIslandPlatform(parent,startM,endM,centerLateral,stationName,widthM=TRACK_GEOMETRY.platformWidthM){
  addPlatformStructure(parent,startM,endM,centerLateral,widthM,stationName,[-1,1]);
}

function addSidePlatform(parent,startM,endM,trackCenterLateral,outwardSign,stationName,widthM=SIDE_PLATFORM_WIDTH){
  // outwardSign=-1 は線路の左外側、+1 は右外側。
  const center=trackCenterLateral + outwardSign*(TRACK_TO_PLATFORM_EDGE + widthM/2);
  // 黄色線は線路に面する片側だけ。左外側ホームなら右端(+1)、右外側なら左端(-1)。
  const facingEdge=outwardSign < 0 ? 1 : -1;
  addPlatformStructure(parent,startM,endM,center,widthM,stationName,[facingEdge]);
}

function createSceneTrain(purpose = "running") {
  if (!window.TrainRenderAdapter) throw new Error("TrainRenderAdapter is not loaded.");
  const factory = purpose === "opposing" ? window.TrainRenderAdapter.forOpposing
    : purpose === "siding" ? window.TrainRenderAdapter.forSiding
    : window.TrainRenderAdapter.forRunning;
  return factory({ THREE, axis: "z", direction: 1, doorsOpen: 0, detailLevel: "full" });
}

// 各車両を線路上の別々の地点へ置き、連結部で少しずつ折れるようにする。
function placeTrainAlongRoute(group, frontMeters, lateral, reverseDirection = false, bob = 0) {
  if (!window.TrainPlacement) throw new Error("TrainPlacement is not loaded.");
  window.TrainPlacement.placeAlongRoute(group, {
    frontMeters, lateral, reverseDirection, bob, routePose, routeLength: ROUTE.length,
    originOffsetY: window.TrainVerticalDimensions?.routeTrainOriginOffsetY ?? .25
  });
}

function addPlatform(parent, x, zCenter, length, stationName, side = 1) {
  const platform = boxMesh(4.4, 0.55, length, 0xb8bec1);
  platform.position.set(x, 0.5, zCenter);
  parent.add(platform);

  const yellow = boxMesh(0.28, 0.05, length - 1, 0xe5c23f);
  yellow.position.set(x - side * 1.8, 0.81, zCenter);
  parent.add(yellow);

  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x454d53, roughness: 0.7, metalness: 0.3 });
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0x6f777c, roughness: 0.65, metalness: 0.28 });
  for (let z = zCenter + length / 2 - 8; z > zCenter - length / 2 + 8; z -= 12) {
    for (const px of [x - 1.35, x + 1.35]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.0, 0.16), postMaterial);
      post.position.set(px, 2.7, z);
      parent.add(post);
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.2, length - 8), roofMaterial);
  roof.position.set(x, 4.7, zCenter);
  parent.add(roof);

  for (const z of [zCenter + length * 0.27, zCenter - length * 0.27]) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.9, 0.95),
      new THREE.MeshBasicMaterial({ map: makeCanvasLabel(stationName), side: THREE.DoubleSide })
    );
    sign.position.set(x - side * 2.18, 3.2, z);
    sign.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    parent.add(sign);
  }
}

function addBuilding(parent, x, z, w, h, d, color = 0x81939c) {
  const body = boxMesh(w, h, d, color);
  body.position.set(x, h / 2 - 0.15, z);
  parent.add(body);

  const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xbfe8ff });
  const rows = Math.max(1, Math.floor(h / 3));
  for (let row = 0; row < rows; row++) {
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.8, w * 0.16), 0.48), windowMaterial);
      win.position.set(x + side * (w / 2 + 0.012), 1.6 + row * 2.6, z);
      win.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      parent.add(win);
    }
  }
}

function addUrbanZone(parent, startM, endM, density = 1) {
  const startZ = sceneZ(startM), endZ = sceneZ(endM);
  const length = Math.abs(endZ - startZ);
  const centerZ = (startZ + endZ) / 2;
  const road = boxMesh(72, 0.12, length, 0x697178);
  road.position.set(0, -0.05, centerZ);
  parent.add(road);

  const spacingM = 420 / density;
  let i = 0;
  for (let m = startM + 180; m < endM - 100; m += spacingM) {
    for (const side of [-1, 1]) {
      const h = 7 + ((i * 11 + (side > 0 ? 7 : 2)) % 18);
      const w = 7 + ((i * 3) % 5);
      const d = 12 + ((i * 5) % 9);
      const x = side * (17 + ((i * 7) % 24));
      const palette = [0x8799a3, 0x72848e, 0xa0a6a8, 0x667982];
      addBuilding(parent, x, sceneZ(m), w, h, d, palette[i % palette.length]);
      if (i % 3 === 0) addBuilding(parent, side * (34 + ((i * 4) % 12)), sceneZ(m + 110), w * .82, h * .65, d * .8, palette[(i + 1) % palette.length]);
    }
    i++;
  }
}

function addFieldZone(parent, startM, endM) {
  const startZ = sceneZ(startM), endZ = sceneZ(endM);
  const length = Math.abs(endZ - startZ);
  const centerZ = (startZ + endZ) / 2;
  const colors = [0x7fae55, 0x99ba59, 0x6d9d48, 0xc4b85b];
  for (const side of [-1, 1]) {
    for (let lane = 0; lane < 4; lane++) {
      const field = boxMesh(10.5, 0.08, length, colors[(lane + (side > 0 ? 1 : 0)) % colors.length]);
      field.position.set(side * (13.5 + lane * 11), -0.08, centerZ);
      parent.add(field);
    }
  }
  const treeMat = new THREE.MeshStandardMaterial({ color: 0x3f7138, roughness: .95 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6c4b31, roughness: 1 });
  for (let m = startM + 260, i = 0; m < endM; m += 520, i++) {
    for (const side of [-1, 1]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.18, .24, 1.5, 7), trunkMat);
      trunk.position.set(side * (12 + (i % 4) * 8), .65, sceneZ(m));
      parent.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.15 + (i % 3) * .2, 8, 6), treeMat);
      crown.position.set(trunk.position.x, 1.8, trunk.position.z);
      parent.add(crown);
    }
  }
}

function addForestZone(parent, startM, endM) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a402b, roughness: 1 });
  const greens = [0x315f34, 0x3b713b, 0x28532e];
  let i = 0;
  for (let m = startM + 80; m < endM; m += 150) {
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        const x = side * (12 + row * 8 + ((i * 3) % 5));
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.17, .25, 2.2, 7), trunkMat);
        trunk.position.set(x, .9, sceneZ(m + row * 35));
        parent.add(trunk);
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.7 + row * .25, 4.5 + (i % 3), 8), new THREE.MeshStandardMaterial({ color: greens[(i + row) % greens.length], roughness: 1 }));
        crown.position.set(x, 3.2, trunk.position.z);
        parent.add(crown);
      }
    }
    i++;
  }
}

function addRiverZone(parent, startM, endM) {
  const startZ = sceneZ(startM), endZ = sceneZ(endM);
  const length = Math.abs(endZ - startZ);
  const centerZ = (startZ + endZ) / 2;
  const water = boxMesh(110, 0.12, length, 0x3b91bd);
  water.position.set(0, -0.02, centerZ);
  parent.add(water);
  const deck = boxMesh(18, 0.42, length + sceneDistance(40), 0x676f73);
  deck.position.set(0, .06, centerZ);
  parent.add(deck);
  for (let m = startM + 180; m < endM; m += 360) {
    for (const x of [-6.5, 0, 6.5]) {
      const pier = boxMesh(1.1, 5.2, 1.5, 0x8b9498);
      pier.position.set(x, -2.2, sceneZ(m));
      parent.add(pier);
    }
  }
  for (const x of [-9.2, 9.2]) {
    const rail = boxMesh(.25, 1.35, length, 0x58636a);
    rail.position.set(x, .75, centerZ);
    parent.add(rail);
  }
}

function addTunnelZone(parent, startM, endM) {
  const startZ = sceneZ(startM), endZ = sceneZ(endM);
  const length = Math.abs(endZ - startZ);
  const centerZ = (startZ + endZ) / 2;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x303638, roughness: .95, side: THREE.DoubleSide });
  for (const x of [-10.2, 10.2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(.8, 8.8, length), wallMat);
    wall.position.set(x, 3.65, centerZ);
    parent.add(wall);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(21.2, .8, length), wallMat);
  roof.position.set(0, 8.0, centerZ);
  parent.add(roof);
  const entranceMat = new THREE.MeshStandardMaterial({ color: 0x626768, roughness: .9 });
  for (const z of [startZ, endZ]) {
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(22.5, 2.1, 1.2), entranceMat);
    lintel.position.set(0, 7.1, z);
    parent.add(lintel);
    for (const x of [-10.8, 10.8]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9.5, 1.2), entranceMat);
      side.position.set(x, 3.7, z);
      parent.add(side);
    }
  }
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6a8 });
  for (let m = startM + 90; m < endM; m += 150) {
    for (const x of [-7.5, 7.5]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(.45, .22, 1.3), lampMat);
      lamp.position.set(x, 6.9, sceneZ(m));
      parent.add(lamp);
    }
  }
}

function sceneryGroundY(distanceM, lateralM = 0) {
  const rp = routePose(distanceM, lateralM);
  // v70.7.8: 景観と地形メッシュで同じ横断面関数を使う。
  // これにより、建物・道路・樹木が地形から浮いたり沈んだりしない。
  const structure = structureSegmentAt(distanceM);
  const offset = terrainCrossSectionV7078(structure, lateralM);
  if (!terrainContainsLateralV7078(lateralM)) return rp.y - 0.38;
  // トンネル内の既存景観は覆工の外側へ退避し、従来互換を保つ。
  if (offset == null) return rp.y + 7.9;
  return rp.y + offset;
}

function placeSceneryOnGround(mesh, distanceM, lateralM, baseLiftM = 0, rotateToRoute = true) {
  const rp = routePose(distanceM, lateralM);
  mesh.position.set(rp.x, sceneryGroundY(distanceM, lateralM) + baseLiftM, rp.z);
  if (rotateToRoute) mesh.rotation.y = rp.yaw;
  return rp;
}

function addDepartureUrbanDistrict(parent){
  // 旭ヶ丘専用の駅前都市。一般のurban生成より密度を高くし、駅構内を中心に道路・駅ビル・中高層建物を配置する。
  const groundDrop=9.22;
  const groundY=(m,lateral)=>routePoseExtended(m,lateral).y-groundDrop;
  const addGroundBox=(m,lateral,w,h,d,color,yLift=0)=>{
    const rp=routePoseExtended(m,lateral);
    const mesh=boxMesh(w,h,d,color);
    mesh.position.set(rp.x,groundY(m,lateral)+h*.5+yLift,rp.z);
    mesh.rotation.y=rp.yaw;
    parent.add(mesh);
    return mesh;
  };

  // 駅前の並行道路と歩道。高架下の地上面に敷く。
  for(let m=-420;m<1900;m+=70){
    const len=sceneDistance(Math.min(70,1900-m))*1.06;
    for(const side of [-1,1]){
      const roadLat=side*29;
      const rp=routePoseExtended(m+35,roadLat);
      const road=boxMesh(10,.10,len,0x454b50);
      road.position.set(rp.x,groundY(m+35,roadLat)+.05,rp.z); road.rotation.y=rp.yaw; parent.add(road);
      const walkLat=side*22.8;
      const wp=routePoseExtended(m+35,walkLat);
      const walk=boxMesh(2.8,.16,len,0xb0aca1);
      walk.position.set(wp.x,groundY(m+35,walkLat)+.08,wp.z); walk.rotation.y=wp.yaw; parent.add(walk);
    }
  }

  // 駅ビル・駅前広場。ホームの横と高架下を埋め、始発駅の拠点感を出す。
  addGroundBox(-170,-38,28,16,62,0x7c8d98);
  addGroundBox(-170, 38,28,16,62,0x87939a);
  addGroundBox(  80,-43,34,22,48,0x718590);
  addGroundBox(  80, 43,34,22,48,0x7e8f99);
  for(const side of [-1,1]){
    const plazaLat=side*31;
    const rp=routePoseExtended(-330,plazaLat);
    const plaza=boxMesh(20,.12,sceneDistance(120),0xb7b09d);
    plaza.position.set(rp.x,groundY(-330,plazaLat)+.06,rp.z); plaza.rotation.y=rp.yaw; parent.add(plaza);
  }

  // 前方1.8kmを都市景観として明確化。左右に奥行きの異なる建物列を作る。
  const colors=[0x71828d,0x87959c,0x667985,0x9a9b95,0x7d8991];
  for(let m=160,i=0;m<1900;m+=150,i++){
    for(const side of [-1,1]){
      for(let row=0;row<2;row++){
        const lat=side*(40+row*22+(i%3)*3);
        const w=12+(i+row)%4*4;
        const h=(row===0?18:25)+(i%5)*5;
        const d=18+((i+row)%3)*7;
        addGroundBox(m+row*38,lat,w,h,d,colors[(i+row+(side>0?1:0))%colors.length]);
      }
    }
  }

  // 高架沿いの防音壁と都市境界。駅構内の開放部を避け、発車後から連続させる。
  for(const side of [-1,1]){
    const lat=side*8.0;
    addRouteStrip(parent,520,1900,lat,.22,1.7,.68,0x87969b,8);
  }
}

function addUrbanZoneV2(parent,startM,endM,density=1){
  const clearance=window.ATCClearanceManager;
  for(let m=startM+160,i=0;m<endM-120;m+=Math.max(150,330/density),i++){
    for(const side of [-1,1]){
      const radius=6+(i%4)*1.5;
      const lateral=clearance.safeLateral(side*(28+(i%4)*9),radius,5);
      const w=8+(i%4)*3,h=8+(i%5)*4,d=12+(i%3)*5;
      const body=boxMesh(w,h,d,[0x8799a3,0x72848e,0xa0a6a8,0x667982][i%4]);
      placeSceneryOnGround(body,m,lateral,h/2, true);
      parent.add(body);
    }
  }
}
function addFieldZoneV2(parent,startM,endM){
  for(let m=startM;m<endM;m+=80){
    const len=Math.min(80,endM-m),mid=m+len/2;
    for(const side of [-1,1]) for(let lane=0;lane<3;lane++){
      const lateral=side*(20+lane*12);
      const rp=routePose(mid,lateral);
      const field=boxMesh(10,.10,sceneDistance(len)*1.08,[0x7fae55,0x99ba59,0x6d9d48,0xc4b85b][(lane+(side>0?1:0))%4]);
      field.position.set(rp.x,sceneryGroundY(mid,lateral)+.05,rp.z);
      field.rotation.y=rp.yaw;
      field.rotation.x=rp.pitch;
      parent.add(field);
    }
  }
}
function addForestZoneV2(parent,startM,endM){
  const clearance=window.ATCClearanceManager;
  for(let m=startM+90,i=0;m<endM;m+=115,i++) for(const side of [-1,1]){
    const lateral=clearance.safeLateral(side*(25+(i%5)*7),2,4);
    const ground=sceneryGroundY(m,lateral);
    const rp=routePose(m,lateral);
    const trunk=boxMesh(.7,3,.7,0x60452f);
    trunk.position.set(rp.x,ground+1.5,rp.z); trunk.rotation.y=rp.yaw; parent.add(trunk);
    const crown=new THREE.Mesh(new THREE.ConeGeometry(2.4+(i%3)*.4,6+(i%2),9),new THREE.MeshStandardMaterial({color:[0x35643a,0x437848,0x2e5834][i%3],roughness:1}));
    crown.position.set(rp.x,ground+6.0,rp.z); crown.rotation.y=rp.yaw; parent.add(crown);
  }
}
function addRiverZoneV2(parent,startM,endM){
  for(let m=startM;m<endM;m+=100){
    const len=Math.min(100,endM-m),mid=m+len/2,rp=routePose(mid,0);
    const water=boxMesh(115,.14,sceneDistance(len)*1.08,0x4c91b7);
    water.position.set(rp.x,sceneryGroundY(mid,0)-.12,rp.z);water.rotation.y=rp.yaw;water.rotation.x=rp.pitch;parent.add(water);
  }
}
function addHills(parent,startM,endM,intensity=1){
  for(let m=startM+220,i=0;m<endM;m+=620,i++){
    for(const side of [-1,1]){
      const lateral=ATCClearanceManager.safeLateral(side*(42+(i%3)*9),10,8);
      const rp=routePose(m,lateral);
      const radius=10+intensity*7;
      const hill=new THREE.Mesh(new THREE.SphereGeometry(radius,18,10),new THREE.MeshStandardMaterial({color:intensity>1?0x48613f:0x60794f,roughness:1}));
      hill.scale.set(1.7,0.65+intensity*.25,1.2);
      const halfHeight=radius*hill.scale.y;
      hill.position.set(rp.x,sceneryGroundY(m,lateral)-halfHeight*.18,rp.z); parent.add(hill);
    }
  }
}
function addIndustrialZone(parent,startM,endM,density=1){
  for(let m=startM+180,i=0;m<endM-100;m+=380/density,i++){
    for(const side of [-1,1]){
      const lat=ATCClearanceManager.safeLateral(side*(30+(i%3)*12),8,6);
      const rp=routePose(m,lat);
      const h=7+(i%4)*3;
      const b=boxMesh(15+(i%3)*5,h,22+(i%2)*8,[0x77838a,0x8b8e86,0x69777f][i%3]);
      b.position.set(rp.x,sceneryGroundY(m,lat)+h/2,rp.z); b.rotation.y=rp.yaw; parent.add(b);
      if(i%2===0){
        const tankLat=lat+side*8; const tp=routePose(m,tankLat);
        const tank=new THREE.Mesh(new THREE.CylinderGeometry(4,4,8,18),new THREE.MeshStandardMaterial({color:0xa5aa9f,roughness:.7,metalness:.2}));
        tank.position.set(tp.x,sceneryGroundY(m,tankLat)+4,tp.z);parent.add(tank);
      }
    }
  }
}
function addCoastZone(parent,startM,endM,density=1){
  const side=1;
  for(let m=startM;m<endM;m+=120){
    const len=Math.min(120,endM-m),mid=m+len/2,lateral=side*58,rp=routePose(mid,lateral);
    const water=boxMesh(70,.12,sceneDistance(len)*1.1,0x4e97bd);
    water.position.set(rp.x,sceneryGroundY(mid,lateral)-.18,rp.z);water.rotation.y=rp.yaw;water.rotation.x=rp.pitch;parent.add(water);
  }
  addUrbanZoneV2(parent,startM,endM,.65*density);
}


const SCENERY_PERFORMANCE=Object.freeze({
  chunkSizeM:1000,
  visibleAheadM:3600,
  keepBehindM:1400,
  maxFrameDeltaSeconds:.05,
  distantParallax:.92
});

const SCENERY_SHARED={geometries:new Map(),materials:new Map()};

function getSharedBoxGeometry(width,height,depth){
  const key=`box:${width}:${height}:${depth}`;
  if(!SCENERY_SHARED.geometries.has(key)){
    SCENERY_SHARED.geometries.set(key,new THREE.BoxGeometry(width,height,depth));
  }
  return SCENERY_SHARED.geometries.get(key);
}

function getSharedMaterial(color,roughness=.92,metalness=0,basic=false){
  const key=`mat:${color}:${roughness}:${metalness}:${basic}`;
  if(!SCENERY_SHARED.materials.has(key)){
    SCENERY_SHARED.materials.set(
      key,
      basic
        ? new THREE.MeshBasicMaterial({color,fog:true})
        : new THREE.MeshStandardMaterial({color,roughness,metalness})
    );
  }
  return SCENERY_SHARED.materials.get(key);
}

function addDistantGroundSideV707(parent,side){
  const geometry=new THREE.PlaneGeometry(1450,6200,10,24);
  const position=geometry.attributes.position;
  for(let i=0;i<position.count;i++){
    const x=position.getX(i),y=position.getY(i);
    position.setZ(i,
      Math.sin(x*.0042)*5.5+
      Math.sin(y*.0021)*8.5+
      Math.sin((x+y)*.0013)*4
    );
  }
  geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,getSharedMaterial(0x758961,.98,0,true));
  mesh.rotation.x=-Math.PI/2;
  mesh.position.set(side*1120,-11,-850);
  mesh.castShadow=false;
  mesh.receiveShadow=false;
  mesh.frustumCulled=true;
  parent.add(mesh);
}

function addDistantMountainRowV707(parent,distance,baseHeight,color,seed){
  const material=getSharedMaterial(color,1,0,true);
  for(const side of [-1,1]){
    for(let i=0;i<14;i++){
      const width=125+(Math.sin(i*1.71+seed)+1)*72;
      const height=baseHeight+Math.sin(i*.82+seed)*18+Math.sin(i*.27+seed)*25;
      const mountain=new THREE.Mesh(new THREE.ConeGeometry(width*.54,height,5),material);
      // The closest distant object stays at least 620 m from track centre.
      mountain.position.set(
        side*(650+i*128),
        height/2-8,
        -distance-(i%4)*85
      );
      mountain.rotation.y=(i*.41+seed)%Math.PI;
      mountain.castShadow=false;
      mountain.receiveShadow=false;
      parent.add(mountain);
    }
  }
}

function addDistantSkylineV707(parent){
  const material=getSharedMaterial(0x71818d,1,0,true);
  for(const side of [-1,1]){
    for(let i=0;i<18;i++){
      const width=24+(i%4)*8;
      const height=32+(i%7)*11;
      const building=new THREE.Mesh(getSharedBoxGeometry(width,height,20),material);
      building.position.set(
        side*(620+i*62),
        height/2-5,
        -1650-(i%5)*34
      );
      building.castShadow=false;
      building.receiveShadow=false;
      parent.add(building);
    }
  }
}

function addDistantSceneryV707(parent){
  const group=new THREE.Group();
  group.name="v707-distant-scenery";
  group.userData.routeAnchored=true;
  addDistantGroundSideV707(group,-1);
  addDistantGroundSideV707(group,1);
  addDistantMountainRowV707(group,1900,82,0x748694,.5);
  addDistantMountainRowV707(group,2500,110,0x8c9aa4,1.8);
  addDistantMountainRowV707(group,3050,138,0xa6b0b7,3.1);
  addDistantSkylineV707(group);
  parent.add(group);
}

function updateDistantSceneryParallaxV707(){
  const sceneRoot=scenery?.scene;
  const group=sceneRoot?.getObjectByName?.("v707-distant-scenery");
  if(!group)return;

  // Anchor the layer to route distance rather than camera world coordinates.
  // This prevents the parallax multiplier from gradually dragging mountains
  // and the large ground plane into the train on long curves.
  const anchorM=Math.min(ROUTE.length-1,Math.max(0,train.position+1450));
  const pose=routePose(anchorM,0);
  group.position.set(pose.x,pose.y,pose.z);
  group.rotation.order="YXZ";
  group.rotation.y=pose.yaw;
  group.rotation.x=pose.pitch*.18;
}


function optimizeSceneryTreeV707(root){
  root?.traverse?.(object=>{
    if(!object.isMesh)return;
    if(object.userData?.isCriticalRouteObject){
      object.frustumCulled=false;
      return;
    }
    object.frustumCulled=true;
    if(object.geometry&&!object.geometry.boundingSphere){
      object.geometry.computeBoundingSphere?.();
    }
  });
}

function sceneryMaterialV706(color,roughness=.92,metalness=0){
  return new THREE.MeshStandardMaterial({color,roughness,metalness});
}

function addResidentialZoneV2(parent,startM,endM,density=1,variant=""){
  const clearance=window.ATCClearanceManager;
  const wall=[0xd4c6af,0xb7c1c6,0xc7a991,0xe0d4bd,0xaeb9b0];
  const roof=[0x43494d,0x654a43,0x3d5560,0x5a5a57];

  for(const side of [-1,1]){
    const roadLat=side*(variant==="dense-houses"?25:29);
    for(let m=startM;m<endM;m+=140){
      const len=Math.min(140,endM-m),mid=m+len/2,rp=routePose(mid,roadLat);
      const road=boxMesh(5.8,.08,sceneDistance(len)*1.04,0x4b5054);
      road.position.set(rp.x,sceneryGroundY(mid,roadLat)+.04,rp.z);
      road.rotation.y=rp.yaw; road.rotation.x=rp.pitch; parent.add(road);
    }
  }

  const spacing=Math.max(82,135/density);
  for(let m=startM+75,i=0;m<endM-50;m+=spacing,i++){
    for(const side of [-1,1]){
      const rows=variant==="dense-houses"?2:1;
      for(let row=0;row<rows;row++){
        const dm=m+row*26;
        const lateral=clearance.safeLateral(side*(34+row*14+(i%3)*2),4,5);
        const w=6.2+(i%3)*1.2,h=4.8+(i%2),d=8+(i%4)*1.4;
        const rp=routePose(dm,lateral);
        const house=boxMesh(w,h,d,wall[(i+row+(side>0?2:0))%wall.length]);
        house.position.set(rp.x,sceneryGroundY(dm,lateral)+h/2,rp.z);
        house.rotation.y=rp.yaw; parent.add(house);

        const cap=new THREE.Mesh(
          new THREE.ConeGeometry(Math.max(w,d)*.62,2.2,4),
          sceneryMaterialV706(roof[(i+row)%roof.length],.88)
        );
        cap.rotation.y=rp.yaw+Math.PI/4;
        cap.position.set(rp.x,sceneryGroundY(dm,lateral)+h+1,rp.z);
        parent.add(cap);
      }
    }
    if(i%5===0){
      const lat=(i%10===0?1:-1)*22,rp=routePose(m,lat);
      const pole=boxMesh(.35,8,.35,0x55504a);
      pole.position.set(rp.x,sceneryGroundY(m,lat)+4,rp.z); parent.add(pole);
    }
  }

  if(variant==="park-school"){
    const m=(startM+endM)/2,lat=-44,rp=routePose(m,lat);
    const school=boxMesh(24,10,42,0xd6d0bc);
    school.position.set(rp.x,sceneryGroundY(m,lat)+5,rp.z);
    school.rotation.y=rp.yaw; parent.add(school);
    const yard=boxMesh(34,.08,54,0xb49a65);
    yard.position.set(rp.x,sceneryGroundY(m,lat)+.04,rp.z);
    yard.rotation.y=rp.yaw; parent.add(yard);
  }
}

function addCommercialZoneV2(parent,startM,endM,density=1,variant=""){
  const clearance=window.ATCClearanceManager;
  const colors=[0x697984,0x86949a,0x9d9b92,0x63717a,0x8c8582];
  for(let m=startM+120,i=0;m<endM-100;m+=Math.max(135,245/density),i++){
    for(const side of [-1,1]){
      const lat=clearance.safeLateral(side*(34+(i%4)*7),9,6);
      const h=variant==="aomine-gateway"?18+(i%5)*6:12+(i%4)*5;
      const w=12+(i%3)*5,d=16+(i%4)*5,rp=routePose(m,lat);
      const b=boxMesh(w,h,d,colors[(i+(side>0?2:0))%colors.length]);
      b.position.set(rp.x,sceneryGroundY(m,lat)+h/2,rp.z);
      b.rotation.y=rp.yaw; parent.add(b);
      if(i%2===0){
        const rooftop=boxMesh(w*.42,1.4,d*.35,0x4f595e);
        rooftop.position.set(rp.x,sceneryGroundY(m,lat)+h+.7,rp.z);
        rooftop.rotation.y=rp.yaw; parent.add(rooftop);
      }
    }
  }
  for(let m=startM+260,i=0;m<endM;m+=620,i++){
    const lat=(i%2?1:-1)*52,rp=routePose(m,lat);
    const lot=boxMesh(26,.07,42,0x50555a);
    lot.position.set(rp.x,sceneryGroundY(m,lat)+.035,rp.z);
    lot.rotation.y=rp.yaw; parent.add(lot);
    const post=boxMesh(1.3,9,.7,0xd8d4c8);
    post.position.set(rp.x,sceneryGroundY(m,lat)+4.5,rp.z); parent.add(post);
    const sign=boxMesh(6,3,.5,[0x2e7fa3,0xa34d3f,0x6f8b45][i%3]);
    sign.position.set(rp.x,sceneryGroundY(m,lat)+8.5,rp.z);
    sign.rotation.y=rp.yaw; parent.add(sign);
  }
}

function addOrchardZoneV2(parent,startM,endM,density=1){
  for(let m=startM+50,i=0;m<endM;m+=Math.max(58,78/density),i++){
    for(const side of [-1,1]) for(let row=0;row<3;row++){
      const dm=m+(row%2)*18,lat=side*(22+row*10),rp=routePose(dm,lat);
      const trunk=boxMesh(.45,2,.45,0x69503b);
      trunk.position.set(rp.x,sceneryGroundY(dm,lat)+1,rp.z); parent.add(trunk);
      const crown=new THREE.Mesh(
        new THREE.SphereGeometry(1.65+(i%2)*.15,8,6),
        sceneryMaterialV706((i+row)%4===0?0x789248:0x4d7840)
      );
      crown.position.set(rp.x,sceneryGroundY(dm,lat)+3,rp.z); parent.add(crown);
    }
  }
  for(let m=startM+360,i=0;m<endM;m+=720,i++){
    const lat=(i%2?1:-1)*48,rp=routePose(m,lat);
    const barn=boxMesh(12,6,18,0x9c7658);
    barn.position.set(rp.x,sceneryGroundY(m,lat)+3,rp.z);
    barn.rotation.y=rp.yaw; parent.add(barn);
    const slat=lat+(lat>0?5:-5),srp=routePose(m+28,slat);
    const silo=new THREE.Mesh(
      new THREE.CylinderGeometry(2.7,2.7,9,12),
      sceneryMaterialV706(0xa8aaa3,.7,.1)
    );
    silo.position.set(srp.x,sceneryGroundY(m+28,slat)+4.5,srp.z); parent.add(silo);
  }
}

function addSolarZoneV2(parent,startM,endM,density=1){
  const mat=sceneryMaterialV706(0x183d58,.45,.25);
  for(let m=startM+70;m<endM-50;m+=Math.max(62,85/density)){
    for(const side of [-1,1]) for(let row=0;row<3;row++){
      const dm=m+(row%2)*16,lat=side*(26+row*11),rp=routePose(dm,lat);
      const panel=new THREE.Mesh(new THREE.BoxGeometry(7,.18,3.6),mat);
      panel.position.set(rp.x,sceneryGroundY(dm,lat)+1.35,rp.z);
      panel.rotation.y=rp.yaw; panel.rotation.x=-.28*side; parent.add(panel);
      const leg=boxMesh(.18,1.3,.18,0x666b6e);
      leg.position.set(rp.x,sceneryGroundY(dm,lat)+.65,rp.z); parent.add(leg);
    }
  }
  addHills(parent,startM,endM,.55);
}

function addHighwayZoneV2(parent,startM,endM){
  const lat=-34;
  for(let m=startM;m<endM;m+=120){
    const len=Math.min(120,endM-m),mid=m+len/2,rp=routePose(mid,lat);
    const road=boxMesh(10,.10,sceneDistance(len)*1.05,0x3f454a);
    road.position.set(rp.x,sceneryGroundY(mid,lat)+.05,rp.z);
    road.rotation.y=rp.yaw; road.rotation.x=rp.pitch; parent.add(road);
  }
  for(let m=startM+90,i=0;m<endM;m+=220){
    const vl=lat+(i%2?2.2:-2.2),rp=routePose(m,vl);
    const truck=boxMesh(2.6,2.8,7.5,[0xe6e1d7,0x517b99,0x9c4f42][i%3]);
    truck.position.set(rp.x,sceneryGroundY(m,vl)+1.4,rp.z);
    truck.rotation.y=rp.yaw; parent.add(truck);
  }
}

function addHarborZoneV2(parent,startM,endM,density=1){
  for(let m=startM;m<endM;m+=110){
    const len=Math.min(110,endM-m),mid=m+len/2,lat=60,rp=routePose(mid,lat);
    const water=boxMesh(86,.10,sceneDistance(len)*1.08,0x357fa5);
    water.position.set(rp.x,sceneryGroundY(mid,lat)-.20,rp.z);
    water.rotation.y=rp.yaw; water.rotation.x=rp.pitch; parent.add(water);
  }
  const colors=[0xb44f3e,0x3f7590,0xc39038,0x56724c];
  for(let m=startM+120,i=0;m<endM-80;m+=230/density,i++){
    const lat=-38-(i%3)*8,rp=routePose(m,lat);
    const warehouse=boxMesh(20,8,30,0x7d8585);
    warehouse.position.set(rp.x,sceneryGroundY(m,lat)+4,rp.z);
    warehouse.rotation.y=rp.yaw; parent.add(warehouse);
    for(let c=0;c<3;c++){
      const clat=32+c*5,cm=m+c*18,crp=routePose(cm,clat);
      const box=boxMesh(3.2,2.6,7.2,colors[(i+c)%colors.length]);
      box.position.set(crp.x,sceneryGroundY(cm,clat)+1.3,crp.z);
      box.rotation.y=crp.yaw; parent.add(box);
    }
    if(i%2===0){
      const cm=m+35,clat=48,crp=routePose(cm,clat);
      const mast=boxMesh(1.2,18,1.2,0xe0b441);
      mast.position.set(crp.x,sceneryGroundY(cm,clat)+9,crp.z); parent.add(mast);
      const arm=boxMesh(16,.8,.8,0xe0b441);
      arm.position.set(crp.x,sceneryGroundY(cm,clat)+17.5,crp.z);
      arm.rotation.y=crp.yaw; parent.add(arm);
    }
  }
}

function addSceneryLandmarksV706(parent){
  for(const m of [22620,25280]) for(const side of [-1,1]){
    const lat=side*34,rp=routePose(m,lat);
    const bank=boxMesh(16,2.2,90,0x6d8d56);
    bank.position.set(rp.x,sceneryGroundY(m,lat)+1.1,rp.z);
    bank.rotation.y=rp.yaw; parent.add(bank);
  }

  {
    const m=27050,lat=-45,rp=routePose(m,lat);
    const leg=boxMesh(1.2,8,1.2,0x727779);
    leg.position.set(rp.x,sceneryGroundY(m,lat)+4,rp.z); parent.add(leg);
    const tank=new THREE.Mesh(
      new THREE.CylinderGeometry(4.2,3.4,8,14),
      sceneryMaterialV706(0xb4b8b0,.7,.1)
    );
    tank.position.set(rp.x,sceneryGroundY(m,lat)+12,rp.z); parent.add(tank);
  }

  for(let i=0;i<3;i++){
    const m=36000+i*480,lat=58+(i%2)*12,rp=routePose(m,lat);
    const mast=boxMesh(.9,22,.9,0xd7dcda);
    mast.position.set(rp.x,sceneryGroundY(m,lat)+11,rp.z); parent.add(mast);
    const hub=new THREE.Mesh(new THREE.SphereGeometry(1.2,8,6),sceneryMaterialV706(0xe5e8e6));
    hub.position.set(rp.x,sceneryGroundY(m,lat)+22,rp.z); parent.add(hub);
    for(let blade=0;blade<3;blade++){
      const arm=boxMesh(.35,9,.45,0xe5e8e6);
      arm.position.set(rp.x,sceneryGroundY(m,lat)+22,rp.z);
      arm.rotation.z=blade*Math.PI*2/3; parent.add(arm);
    }
  }

  for(let i=0;i<4;i++){
    const m=50800+i*320,lat=-38-(i%2)*9,rp=routePose(m,lat),h=18+i*4;
    const hotel=boxMesh(18,h,24,[0xd1c7b5,0xaebbc1,0xc7b8a6,0x9eb0b6][i]);
    hotel.position.set(rp.x,sceneryGroundY(m,lat)+h/2,rp.z);
    hotel.rotation.y=rp.yaw; parent.add(hotel);
  }
}


function addLayeredSceneryCorridorV7074(parent){
  const dummy=new THREE.Object3D();

  const addInstances=(geometry,material,records,{frustumCulled=true,label="layered"}={})=>{
    if(!records.length)return null;
    const mesh=tagPerformanceResource(new THREE.InstancedMesh(geometry,material,records.length), `${label}:${geometry.type}:#${material?.color?.getHexString?.()||"none"}`);
    mesh.frustumCulled=frustumCulled;
    records.forEach((r,index)=>{
      dummy.position.set(r.x,r.y,r.z);
      dummy.rotation.set(r.rx||0,r.ry||0,r.rz||0);
      dummy.scale.set(r.sx||1,r.sy||1,r.sz||1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index,dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;
    mesh.computeBoundingBox?.();
    mesh.computeBoundingSphere?.();
    parent.add(mesh);
    return mesh;
  };

  const ultraNearPosts=[];
  const nearShrubs=[];
  const middleTrees=[];
  const middleHomes=[];
  const middleFarBlocks=[];
  const roadSegments=[];

  // Layer 5: ultra-near references, 0–10 m outside the route structure.
  // Dense small objects are the strongest source of high-speed optic flow.
  for(let m=24,i=0;m<ROUTE.length-24;m+=34,i++){
    for(const side of [-1,1]){
      const lat=side*(10.8+(i%3)*.65);
      const p=routePose(m,lat);
      ultraNearPosts.push({
        x:p.x,
        y:sceneryGroundY(m,lat)+.55,
        z:p.z,
        ry:p.yaw,
        sx:1,
        sy:1,
        sz:1
      });
    }
  }

  // Layer 4: near scenery, approximately 14–38 m.
  for(let m=55,i=0;m<ROUTE.length-55;m+=58,i++){
    for(const side of [-1,1]){
      const lat=side*(18+(i%4)*3.2);
      const p=routePose(m,lat);
      nearShrubs.push({
        x:p.x,
        y:sceneryGroundY(m,lat)+.75,
        z:p.z,
        ry:p.yaw,
        sx:.80+(i%3)*.16,
        sy:.62+(i%2)*.14,
        sz:.80+(i%4)*.10
      });
    }
  }

  // Layer 3: trees and compact houses, 40–110 m.
  for(let m=90,i=0;m<ROUTE.length-90;m+=118,i++){
    for(const side of [-1,1]){
      const biome=window.ATC_SCENERY_ZONES?.find(z=>m>=z.startM&&m<z.endM)?.biome || "rural";
      const lat=side*(43+(i%5)*8);
      const p=routePose(m+(side>0?28:0),lat);
      const ground=sceneryGroundY(m+(side>0?28:0),lat);

      const urbanLike=["urban","commercial","residential","industrial","harbor"].includes(biome);
      if(urbanLike || i%3===0){
        middleHomes.push({
          x:p.x,
          y:ground+3.2,
          z:p.z,
          ry:p.yaw,
          sx:.78+(i%4)*.17,
          sy:.75+(i%5)*.18,
          sz:.78+(i%3)*.18
        });
      }else{
        middleTrees.push({
          x:p.x,
          y:ground+3.4,
          z:p.z,
          ry:p.yaw,
          sx:.85+(i%3)*.16,
          sy:.85+(i%4)*.14,
          sz:.85+(i%2)*.12
        });
      }
    }
  }

  // Layer 2: broad middle-distance mass, 120–320 m.
  for(let m=150,i=0;m<ROUTE.length-150;m+=245,i++){
    for(const side of [-1,1]){
      const lat=side*(135+(i%4)*46);
      const p=routePose(m+(side>0?62:0),lat);
      const ground=sceneryGroundY(m+(side>0?62:0),lat);
      middleFarBlocks.push({
        x:p.x,
        y:ground+7.5,
        z:p.z,
        ry:p.yaw,
        sx:1+(i%3)*.35,
        sy:.75+(i%5)*.22,
        sz:1+(i%4)*.30
      });
    }
  }

  // Continuous parallel roads create stable mid-ground continuity.
  for(let m=0;m<ROUTE.length;m+=72){
    const m2=Math.min(ROUTE.length,m+72);
    const mid=(m+m2)/2;
    for(const side of [-1,1]){
      const lat=side*31;
      const p=routePose(mid,lat);
      roadSegments.push({
        x:p.x,
        y:sceneryGroundY(mid,lat)+.035,
        z:p.z,
        rx:p.pitch,
        ry:p.yaw,
        sx:1,
        sy:1,
        sz:sceneDistance(m2-m)*1.04
      });
    }
  }

  addInstances(
    new THREE.BoxGeometry(.13,1.1,.13),
    getSharedMaterial(0x59625f,.92,.05,false),
    ultraNearPosts,
    {frustumCulled:true,label:"ultra-near-posts"}
  );

  addInstances(
    new THREE.SphereGeometry(1.05,6,4),
    getSharedMaterial(0x4f7b43,.98,0,false),
    nearShrubs,
    {frustumCulled:true,label:"near-shrubs"}
  );

  addInstances(
    new THREE.ConeGeometry(2.15,6.2,7),
    getSharedMaterial(0x3d693d,1,0,false),
    middleTrees,
    {frustumCulled:true,label:"middle-trees"}
  );

  addInstances(
    new THREE.BoxGeometry(8.8,6.4,11.5),
    getSharedMaterial(0xc1b7a5,.94,0,false),
    middleHomes,
    {frustumCulled:true,label:"middle-homes"}
  );

  addInstances(
    new THREE.BoxGeometry(18,15,22),
    getSharedMaterial(0x87959b,.96,0,false),
    middleFarBlocks,
    {frustumCulled:true,label:"middle-far-blocks"}
  );

  addInstances(
    new THREE.BoxGeometry(6.2,.07,1),
    getSharedMaterial(0x484d50,.98,0,false),
    roadSegments,
    {frustumCulled:true,label:"parallel-roads"}
  );
}

function addForegroundMotionReferencesV7073(parent){
  // Sparse, lightweight objects close to the railway provide stable optic flow.
  // They are intentionally simple and shared-looking, not a replacement for zones.
  const poleMat=sceneryMaterialV706(0x59636a,.9,.05);
  const bushMat=sceneryMaterialV706(0x507b45,.96,0);
  const poleGeo=new THREE.BoxGeometry(.22,3.8,.22);
  const bushGeo=new THREE.SphereGeometry(1.15,6,4);
  const poleRecords=[];
  const bushRecords=[];
  const dummy=new THREE.Object3D();
  for(let m=80;m<ROUTE.length-80;m+=72){
    for(const side of [-1,1]){
      const lat=side*(18+(Math.floor(m/72)%3)*2.5);
      const p=routePose(m,lat);
      poleRecords.push({p,lat,m});
      if(Math.floor(m/72)%2===0){
        const bm=m+24,blat=side*29,bp=routePose(bm,blat);
        bushRecords.push({p:bp,lat:blat,m:bm});
      }
    }
  }
  const poles=tagPerformanceResource(new THREE.InstancedMesh(poleGeo,poleMat,poleRecords.length), "foreground-motion:poles");
  poles.frustumCulled=true;
  poleRecords.forEach((r,i)=>{
    dummy.position.set(r.p.x,sceneryGroundY(r.m,r.lat)+1.9,r.p.z);
    dummy.rotation.set(0,r.p.yaw,0);dummy.scale.set(1,1,1);dummy.updateMatrix();
    poles.setMatrixAt(i,dummy.matrix);
  });
  poles.instanceMatrix.needsUpdate=true;
  poles.computeBoundingBox?.();
  poles.computeBoundingSphere?.();
  parent.add(poles);
  const bushes=tagPerformanceResource(new THREE.InstancedMesh(bushGeo,bushMat,bushRecords.length), "foreground-motion:bushes");
  bushes.frustumCulled=true;
  bushRecords.forEach((r,i)=>{
    dummy.position.set(r.p.x,sceneryGroundY(r.m,r.lat)+1.05,r.p.z);
    dummy.rotation.set(0,r.p.yaw,0);dummy.scale.set(1+(i%3)*.12,.8+(i%2)*.12,1);dummy.updateMatrix();
    bushes.setMatrixAt(i,dummy.matrix);
  });
  bushes.instanceMatrix.needsUpdate=true;
  bushes.computeBoundingBox?.();
  bushes.computeBoundingSphere?.();
  parent.add(bushes);
}


const TERRAIN_ENGINE_V7078=Object.freeze({
  chunkSizeM:500,
  longitudinalStepM:12,
  visibleAheadM:3600,
  keepBehindM:900,

  // 景観の最大配置幅より十分広く地形を生成する。
  // 0〜600mは指定LOD、600m以遠は遠景用の粗い帯で1500m超まで接続する。
  sceneryCoverageHalfWidthM:1600,
  guaranteedDetailedHalfWidthM:700,
  lateralBandsM:Object.freeze((()=>{
    const positive=[];
    const append=(from,to,step)=>{
      let value=from;
      if(positive.length && Math.abs(positive[positive.length-1]-value)<1e-6) value+=step;
      for(;value<to-1e-6;value+=step) positive.push(Number(value.toFixed(3)));
      if(!positive.length || Math.abs(positive[positive.length-1]-to)>1e-6) positive.push(to);
    };
    append(8,60,4);
    append(60,150,6);
    append(150,300,12);
    append(300,600,20);
    append(600,1500,32);
    append(1500,1600,50);
    return [...positive.slice().reverse().map(v=>-v),...positive];
  })())
});

const TERRAIN_MATERIAL_V7078=new THREE.MeshStandardMaterial({
  vertexColors:true,
  roughness:.98,
  metalness:0,
  side:THREE.DoubleSide
});

function terrainContainsLateralV7078(lateralM){
  return Number.isFinite(lateralM) && Math.abs(lateralM)<=TERRAIN_ENGINE_V7078.sceneryCoverageHalfWidthM;
}

function terrainBiomeColorV7078(distanceM){
  const biome=window.ATC_SCENERY_ZONES?.find(
    zone=>distanceM>=zone.startM&&distanceM<zone.endM
  )?.biome||"rural";
  return {
    urban:0x778078,commercial:0x7d827d,residential:0x6f8c5e,
    rural:0x7fa35d,orchard:0x6f9254,river:0x73915f,
    hilly:0x698256,mountain:0x536d49,solar:0x647a53,
    highway:0x737d6c,industrial:0x737970,harbor:0x707871,
    coast:0x71885c
  }[biome]||0x78945d;
}

function terrainCrossSectionV7078(structure,lateralM){
  const abs=Math.abs(lateralM);
  const type=structure?.type||"ground";
  if(type==="tunnel" || !terrainContainsLateralV7078(lateralM)) return null;

  // 近景の路盤・法面形状を保ちつつ、遠方ほど勾配を弱めて地平線へ接続する。
  const outerBlend=(base,far=-1.15)=>{
    if(abs<=120) return base;
    const t=Math.min(1,(abs-120)/(TERRAIN_ENGINE_V7078.sceneryCoverageHalfWidthM-120));
    const smooth=t*t*(3-2*t);
    const micro=(Math.sin(abs*.015+((structure?.startM||0)*.0007))*0.10)*(1-t);
    return base+(far-base)*smooth+micro;
  };

  if(type==="viaduct") return outerBlend(-9.15-(Math.min(abs,120)/120)*.45,-9.72);
  if(type==="bridge") return outerBlend(-10.25-(Math.min(abs,120)/120)*.25,-10.62);

  if(type==="embankment"){
    const height=structure?.heightM||STRUCTURE_SETTINGS.embankment?.heightM||5.2;
    let y;
    if(abs<=9) y=-.30;
    else if(abs<=24) y=-.30-(abs-9)/15*height*.72;
    else if(abs<=42) y=-.30-height*.72-(abs-24)/18*height*.28;
    else y=-.30-height-Math.min(abs-42,78)/78*.55;
    return outerBlend(y,-.30-height-.58);
  }

  if(type==="cutting"){
    const depth=structure?.depthM||STRUCTURE_SETTINGS.cutting?.depthM||5.0;
    let y;
    if(abs<=10) y=-.30;
    else if(abs<=24) y=-.30+(abs-10)/14*depth*.38;
    else if(abs<=42) y=-.30+depth*.38+(abs-24)/18*depth*.62;
    else y=-.30+depth+Math.min(abs-42,78)/78*.35;
    return outerBlend(y,-.30+depth+.40);
  }

  if(abs<=8) return -.28;
  if(abs<=14) return -.34;
  if(abs<=24) return -.46;
  if(abs<=42) return -.62;
  if(abs<=72) return -.76;
  if(abs<=120) return -.88;
  return outerBlend(-.88,-1.08);
}

function createTerrainChunkV7078(startM,endM){
  if(structureSegmentAt((startM+endM)*0.5)?.type==="tunnel") return null;
  const bands=TERRAIN_ENGINE_V7078.lateralBandsM;
  const step=TERRAIN_ENGINE_V7078.longitudinalStepM;
  const rows=[];
  for(let m=startM;m<endM;m+=step) rows.push(m);
  if(rows[rows.length-1]!==endM) rows.push(endM);

  const positions=[];
  const colors=[];
  const indices=[];
  const color=new THREE.Color();

  rows.forEach(m=>{
    const structure=structureSegmentAt(m);
    color.setHex(terrainBiomeColorV7078(m));
    bands.forEach(lat=>{
      const p=routePose(m,lat);
      const offset=terrainCrossSectionV7078(structure,lat);
      positions.push(p.x,p.y+(offset??-0.38),p.z);
      const shade=1-Math.min(.20,Math.abs(lat)/1600*.18);
      colors.push(color.r*shade,color.g*shade,color.b*shade);
    });
  });

  const cols=bands.length;
  for(let r=0;r<rows.length-1;r++){
    for(let c=0;c<cols-1;c++){
      const a=r*cols+c,b=a+1,d=(r+1)*cols+c,e=d+1;
      indices.push(a,d,b,b,d,e);
    }
  }

  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh=new THREE.Mesh(geometry,TERRAIN_MATERIAL_V7078);
  mesh.name=`terrain-${Math.round(startM)}-${Math.round(endM)}`;
  mesh.castShadow=false;
  mesh.receiveShadow=true;
  mesh.frustumCulled=false;
  mesh.userData.isTerrainChunk=true;
  mesh.userData.startM=startM;
  mesh.userData.endM=endM;
  return mesh;
}

function updateTerrainAndRouteChunksV7078(){
  if(!scenery?.routeChunks)return;
  const start=Math.max(0,train.position-TERRAIN_ENGINE_V7078.keepBehindM);
  const end=Math.min(ROUTE.length,train.position+TERRAIN_ENGINE_V7078.visibleAheadM);
  scenery.routeChunks.forEach(chunk=>{
    chunk.visible=chunk.userData.endM>=start&&chunk.userData.startM<=end;
  });
}

function addFixedScenery(parent) {
  const zones=window.ATC_SCENERY_ZONES||[];
  if(window.ATCSceneryEngine){
    ATCSceneryEngine.build({
      parent,zones,
      addUrbanZone:addUrbanZoneV2,
      addCommercialZone:addCommercialZoneV2,
      addResidentialZone:addResidentialZoneV2,
      addFieldZone:addFieldZoneV2,
      addOrchardZone:addOrchardZoneV2,
      addRiverZone:addRiverZoneV2,
      addForestZone:addForestZoneV2,
      addHills,
      addSolarZone:addSolarZoneV2,
      addHighwayZone:addHighwayZoneV2,
      addIndustrialZone,
      addHarborZone:addHarborZoneV2,
      addCoastZone,
      routePose,boxMesh,
      clearance:window.ATCClearanceManager,
      terrain:window.ATCTerrainSurface,
      sceneryGroundY
    });
    addSceneryLandmarksV706(parent);
    addLayeredSceneryCorridorV7074(parent);
    addDistantSceneryV707(parent);
    optimizeSceneryTreeV707(parent);
  }
}


function initializeThreeScenery() {
  if (scenery.initialized) return true;
  // 読み込み失敗を永久固定しない。Three.jsが後から読み込まれた場合も再試行する。
  if (scenery.failed && typeof THREE === "undefined") return false;
  scenery.failed = false;
  const canvas = ui.sceneryCanvas;
  if (!canvas || typeof THREE === "undefined") {
    scenery.failed = true;
    console.error("Three.js is unavailable. 3D scenery cannot start.");
    return false;
  }

  try {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x91caea);
    scene.fog = new THREE.Fog(0xb7dbea, 900, 5200);

    const camera = new THREE.PerspectiveCamera(VISUAL_MOTION_TUNING.cameraFovLowDeg,16/6,.1,6000);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(ATC_PERFORMANCE_PROFILE.pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene.add(new THREE.HemisphereLight(0xeaf8ff,0x64705f,2.4));
    const sun=new THREE.DirectionalLight(0xffffff,2.0);
    sun.position.set(-35,60,25); scene.add(sun);

    const world = new THREE.Group(); scene.add(world);
    // 全線を一枚の巨大Meshにせず1kmチャンク化。毎フレーム、近傍チャンクだけ表示する。
    const routeChunks = [];
    const chunkMeters = TERRAIN_ENGINE_V7078.chunkSizeM;
    for (let startM = 0; startM < ROUTE.length; startM += chunkMeters) {
      const endM = Math.min(ROUTE.length, startM + chunkMeters);
      const chunk = new THREE.Group();
      chunk.userData.startM = startM;
      chunk.userData.endM = endM;
      const structure = structureSegmentAt((startM + endM) * 0.5);
      chunk.userData.structureType = structure.type;
      const terrainMesh=createTerrainChunkV7078(startM,endM);
      if(terrainMesh) chunk.add(terrainMesh);
      addStructureSegment(chunk, startM, endM, structure.type, structure);
      addCurvedDoubleTrack(chunk, startM, endM);
      if (structure.type !== "tunnel") addCurvedGantries(chunk, startM, endM);
      addCurvedCatenary(chunk, startM, endM);
      world.add(chunk);
      routeChunks.push(chunk);
    }
    addFixedScenery(world);
    addDepartureUrbanDistrict(world);

    // 旭ヶ丘：先頭停止位置を0mへ固定。ホーム・編成はすべて0mより後方。
    // 発車時には停車標が左端付近に見え、進行方向へホームが続かない。
    addDepartureStation(world);

    // 桜野：相対式2面4線。中央の通過線2本にはホームを置かない。
    // 通過判定位置はホーム先端の停車標（ROUTE.passStation.position）。
    addRelativeFourTrackStation(world, ROUTE.passStation.position, ROUTE.passStation.name, {length:420,tail:100});

    // 青峰：通過線なしの2面2線。ホーム終端までR1500のカーブが継続。
    const aomineWorld = window.StationWorldSpec.resolve("aomine");
    const aomineDown = aomineWorld.tracks.find(t=>t.id==="down-main");
    const aomineUp = aomineWorld.tracks.find(t=>t.id==="up-main");
    addSidePlatform(world, ROUTE.curveStation.position-420, ROUTE.curveStation.position, aomineDown.centerZ, -1, ROUTE.curveStation.name, aomineWorld.platforms[0].width);
    addSidePlatform(world, ROUTE.curveStation.position-420, ROUTE.curveStation.position, aomineUp.centerZ, 1, ROUTE.curveStation.name, aomineWorld.platforms[1].width);
    addStationStopMarker(world, ROUTE.curveStation.position, aomineDown.centerZ);

    // 潮見中央：2面4線。本線側へ進入し、左待避線には先着列車を配置。
    addTerminalBallastAndBuffer(world);
    addFourTrackStation(world, ROUTE.stopPosition, "潮見中央", {stationId:"shiomichuo",length:440,tail:0});
    const terminalSidingTrainInstance = createSceneTrain("siding");
    const terminalSidingTrain = terminalSidingTrainInstance.group;
    world.add(terminalSidingTrain);
    // 先頭をホーム先端の停車標付近まで伸ばし、隣列車がホーム全長にかかる配置。
    placeTrainAlongRoute(terminalSidingTrain, ROUTE.stopPosition-4, window.StationWorldSpec.resolve("shiomichuo").spacing.leftOuter, false, 0);

    const opposingTrains = SCENERY_ENCOUNTERS.map((meetingPosition, index) => {
      const instance = createSceneTrain("opposing");
      const t = instance.group;
      world.add(t);
      return { object: t, instance, meetingPosition };
    });

    Object.assign(scenery,{initialized:true,renderer,scene,camera,world,opposingTrains,routeChunks,collisionShake:0});
    console.info("v70.7.8 layered terrain coverage engine",{
      routeChunks:routeChunks.length,
      terrainMeshes:routeChunks.filter(c=>c.children.some(o=>o.userData?.isTerrainChunk)).length,
      chunkSizeM:TERRAIN_ENGINE_V7078.chunkSizeM,
      visibleWindowM:TERRAIN_ENGINE_V7078.visibleAheadM+TERRAIN_ENGINE_V7078.keepBehindM,
      terrainHalfWidthM:TERRAIN_ENGINE_V7078.sceneryCoverageHalfWidthM
    });
    return true;
  } catch (error) {
    console.error("Three.js track initialization failed:", error);
    scenery.failed = true;
    return false;
  }
}

function drawFallbackScenery() {
  const canvas = ui.sceneryCanvas;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(320, Math.round(rect.width * dpr));
  canvas.height = Math.max(220, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = rect.width, H = rect.height;
  ctx.fillStyle = "#86c8ed";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#65735f";
  ctx.fillRect(0, H * 0.42, W, H * 0.58);
  ctx.fillStyle = "#777066";
  ctx.beginPath();
  ctx.moveTo(W * 0.38, H);
  ctx.lineTo(W * 0.48, H * 0.42);
  ctx.lineTo(W * 0.52, H * 0.42);
  ctx.lineTo(W * 0.62, H);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(5,10,14,.78)";
  ctx.fillRect(18, 18, 360, 56);
  ctx.fillStyle = "#fff";
  ctx.font = "16px sans-serif";
  ctx.fillText("3D景色の読み込みに失敗しました", 34, 44);
  ctx.font = "12px sans-serif";
  ctx.fillText("インターネット接続を確認して再読み込みしてください。", 34, 64);
}

function drawScenery(deltaSeconds = 0) {
  const speed = mpsToKmh(train.speedMps);
  const area = getSceneryArea(train.position);
  if (ui.sceneryArea) ui.sceneryArea.textContent = area;
  if (ui.viewSpeed) ui.viewSpeed.textContent = Math.round(speed);
  if (ui.passDurationView) ui.passDurationView.textContent = opposingPassDurationSeconds(speed, 300).toFixed(1);

  if (!initializeThreeScenery()) {
    drawFallbackScenery();
    return;
  }

  const canvas = ui.sceneryCanvas;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(220, Math.floor(rect.height));
  if (canvas.width !== Math.floor(width * scenery.renderer.getPixelRatio()) ||
      canvas.height !== Math.floor(height * scenery.renderer.getPixelRatio())) {
    scenery.renderer.setSize(width, height, false);
    scenery.camera.aspect = width / height;
    scenery.camera.updateProjectionMatrix();
  }

  const ownTrackLateral = operatingTrackLateral(train.position);
  const speedRatio=clamp(speed/300,0,1.08);
  const visualLookAheadM =
    VISUAL_MOTION_TUNING.cameraLookAheadBaseM +
    train.speedMps * VISUAL_MOTION_TUNING.cameraLookAheadSpeedSeconds;
  const lookAheadM = Math.min(
    ROUTE.renderEndPosition,
    train.position + visualLookAheadM
  );

  const targetFov =
    VISUAL_MOTION_TUNING.cameraFovLowDeg +
    (VISUAL_MOTION_TUNING.cameraFovHighDeg-
      VISUAL_MOTION_TUNING.cameraFovLowDeg) *
    Math.pow(clamp(speedRatio,0,1),.82);

  if(Math.abs(scenery.camera.fov-targetFov)>.01){
    scenery.camera.fov +=
      (targetFov-scenery.camera.fov) *
      VISUAL_MOTION_TUNING.cameraFovResponse;
    scenery.camera.updateProjectionMatrix();
  }

  const cameraHeight =
    VISUAL_MOTION_TUNING.cameraHeightLowM +
    (VISUAL_MOTION_TUNING.cameraHeightHighM-
      VISUAL_MOTION_TUNING.cameraHeightLowM) *
    clamp(speedRatio,0,1);
  const aimTrackLateral = operatingTrackLateral(lookAheadM);
  const cam = routePose(train.position, ownTrackLateral);
  // 待避線から本線への分岐を含め、カメラも同じ線形を追従。
  const aim = routePose(lookAheadM, aimTrackLateral);
  let shakeX=0, shakeY=0, shakeZ=0;
  if (scenery.collisionShake > 0.01) {
    shakeX=(Math.random()-.5)*scenery.collisionShake*.42;
    shakeY=(Math.random()-.5)*scenery.collisionShake*.25;
    shakeZ=(Math.random()-.5)*scenery.collisionShake*.12;
    scenery.collisionShake*=0.88;
  }
  scenery.camera.position.set(
    cam.x+shakeX,
    cam.y+cameraHeight+shakeY,
    cam.z+shakeZ
  );
  scenery.camera.up.set(0,1,0);
  scenery.camera.lookAt(
    aim.x,
    aim.y+cameraHeight-.08*clamp(speedRatio,0,1),
    aim.z
  );
  scenery.camera.rotateZ(routeCantRadians(train.position));

  scenery.clock += deltaSeconds;

  updateTerrainAndRouteChunksV7078();

  scenery.opposingTrains.forEach(({ object, meetingPosition }, index) => {
    const opposingPosition = 2 * meetingPosition - train.position;
    const bob = Math.sin(scenery.clock * 8 + index) * 0.012;
    placeTrainAlongRoute(object, opposingPosition, 2.5, true, bob);
    const relativeDistanceM = Math.abs(opposingPosition - train.position);
    const ownSpeedKmh = mpsToKmh(train.speedMps);
    const passDuration = opposingPassDurationSeconds(ownSpeedKmh, 300);
    const visibilityMarginM = SHINKANSEN_TRAIN_LENGTH_M + Math.max(1600, ((ownSpeedKmh + 300) / 3.6) * (passDuration + 5));
    object.visible = opposingPosition >= 0 && opposingPosition <= ROUTE.length && relativeDistanceM < visibilityMarginM;
  });

  updateDistantSceneryParallaxV707();
  scenery.renderer.render(scenery.scene, scenery.camera);
}


const STATION_FORECASTS = [
  {
    name: "桜野", position: ROUTE.passStation.position, action: "通過", predictionLabel: "定通予測", scheduledSeconds: TIMETABLE.passSeconds,
    schedulePoints: [
      { speedKmh: 70, remainingM: 16500 }, { speedKmh: 120, remainingM: 12000 },
      { speedKmh: 170, remainingM: 8500 }, { speedKmh: 230, remainingM: 5500 },
      { speedKmh: 270, remainingM: 3800 }, { speedKmh: 300, remainingM: 3000 }
    ]
  },
  {
    name: "青峰", position: ROUTE.curveStation.position, action: "通過", predictionLabel: "定通予測", scheduledSeconds: TIMETABLE.curvePassSeconds,
    schedulePoints: [
      { speedKmh: 70, remainingM: 11800 }, { speedKmh: 120, remainingM: 8500 },
      { speedKmh: 170, remainingM: 6100 }, { speedKmh: 200, remainingM: 4700 },
      { speedKmh: 230, remainingM: 3500 }
    ]
  },
  {
    name: "潮見中央", position: ROUTE.stopPosition, action: "停車", predictionLabel: "到着予測", scheduledSeconds: TIMETABLE.arrivalSeconds,
    schedulePoints: [
      { speedKmh: 30, remainingM: 900 }, { speedKmh: 70, remainingM: 2400 },
      { speedKmh: 120, remainingM: 5200 }, { speedKmh: 170, remainingM: 8200 },
      { speedKmh: 230, remainingM: 12000 }, { speedKmh: 300, remainingM: 16500 }
    ]
  }
];

function getNextStationForecast() {
  return STATION_FORECASTS.find(station => train.position < station.position - 0.5) || STATION_FORECASTS[STATION_FORECASTS.length - 1];
}

function plannedElapsedAtPosition(positionM) {
  const points = [
    { position: 0, elapsed: 0 },
    { position: ROUTE.passStation.position, elapsed: TIMETABLE.passSeconds - TIMETABLE.departureSeconds },
    { position: ROUTE.curveStation.position, elapsed: TIMETABLE.curvePassSeconds - TIMETABLE.departureSeconds },
    { position: ROUTE.stopPosition, elapsed: TIMETABLE.arrivalSeconds - TIMETABLE.departureSeconds }
  ];
  const p = clamp(positionM, 0, ROUTE.stopPosition);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (p <= b.position) {
      const t = (p - a.position) / Math.max(1, b.position - a.position);
      return lerp(a.elapsed, b.elapsed, t);
    }
  }
  return points[points.length - 1].elapsed;
}

function interpolateSchedulePoint(points, speedKmh) {
  const sorted = [...points].sort((a, b) => a.speedKmh - b.speedKmh);
  const v = clamp(speedKmh, sorted[0].speedKmh, sorted[sorted.length - 1].speedKmh);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (v <= b.speedKmh) {
      const t = (v - a.speedKmh) / Math.max(1, b.speedKmh - a.speedKmh);
      return lerp(a.remainingM, b.remainingM, t);
    }
  }
  return sorted[sorted.length - 1].remainingM;
}

function getDiagramGuide(station, forecastDifferenceSeconds) {
  const remainingM = Math.max(0, station.position - train.position);
  const currentSpeedKmh = mpsToKmh(train.speedMps);
  const points = station.schedulePoints || [];
  let baseSpeedKmh = Math.max(30, Math.min(train.atcPermittedKmh, currentSpeedKmh || 70));

  if (points.length) {
    const sortedByDistance = [...points].sort((a, b) => b.remainingM - a.remainingM);
    if (remainingM >= sortedByDistance[0].remainingM) {
      baseSpeedKmh = sortedByDistance[0].speedKmh;
    } else if (remainingM <= sortedByDistance[sortedByDistance.length - 1].remainingM) {
      baseSpeedKmh = sortedByDistance[sortedByDistance.length - 1].speedKmh;
    } else {
      for (let i = 0; i < sortedByDistance.length - 1; i++) {
        const a = sortedByDistance[i], b = sortedByDistance[i + 1];
        if (remainingM <= a.remainingM && remainingM >= b.remainingM) {
          const t = (a.remainingM - remainingM) / Math.max(1, a.remainingM - b.remainingM);
          baseSpeedKmh = lerp(a.speedKmh, b.speedKmh, t);
          break;
        }
      }
    }
  }

  // 遅れは最大+20km/h、早通傾向は最大-20km/hで調整する。
  const recoveryOffsetKmh = clamp(forecastDifferenceSeconds * 1.25, -20, 20);
  const atcCeiling = Math.max(0, train.atcPermittedKmh - 1);
  const targetSpeedKmh = clamp(baseSpeedKmh + recoveryOffsetKmh, Math.max(0, baseSpeedKmh - 20), Math.min(300, baseSpeedKmh + 20, atcCeiling));
  const scheduleRemainingAtCurrentSpeed = points.length ? interpolateSchedulePoint(points, Math.max(30, currentSpeedKmh)) : remainingM;
  const pointDifferenceM = remainingM - scheduleRemainingAtCurrentSpeed;

  let mode = "定通";
  let className = "diagram-on-time";
  if (forecastDifferenceSeconds > 5) { mode = "回復運転"; className = "diagram-recovery"; }
  else if (forecastDifferenceSeconds < -5) { mode = "早着調整"; className = "diagram-early"; }

  return { targetSpeedKmh, baseSpeedKmh, mode, className, pointDifferenceM };
}

function estimateStationTime(station) {
  return window.ATCTimetableEngine.estimateStationTime(station);
}

function formatForecastDifference(seconds) {
  const rounded = Math.round(seconds);
  if (Math.abs(rounded) <= 1) return "±0秒";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}秒`;
}

function forecastClass(seconds) {
  const abs = Math.abs(seconds);
  if (abs <= 5) return "on-time";
  if (seconds < -5) return "early";
  if (abs <= 15) return "warning";
  return "late";
}


function applyAtcPatternFlashVisual(isBright){
  const shell=ui.atcCircleShell;
  if(!shell) return;

  shell.style.opacity=isBright ? "1" : ".12";
  shell.style.filter=isBright
    ? "brightness(1.75) drop-shadow(0 0 10px rgba(84,255,125,.72))"
    : "brightness(.42)";
}

function finishAtcPatternFlash(){
  if(atcPatternFlashTimer!==null){
    window.clearTimeout(atcPatternFlashTimer);
    atcPatternFlashTimer=null;
  }

  atcPatternFlashPhase=0;
  ui.atcCircleShell?.classList.remove("atc-pattern-flash");

  if(ui.atcCircleShell){
    ui.atcCircleShell.style.opacity="";
    ui.atcCircleShell.style.filter="";
  }

  atcPatternFlashActive=false;
  atcPatternFlashTarget=null;
}

function startAtcPatternFlash(target){
  finishAtcPatternFlash();

  const shell=ui.atcCircleShell;
  if(!shell) return;

  atcPatternFlashActive=true;
  atcPatternFlashTarget=target;
  atcPatternFlashPhase=0;
  shell.classList.add("atc-pattern-flash");

  const totalHalfCycles=ATC_PATTERN_FLASH_CYCLES*2;

  const runNextPhase=()=>{
    if(!atcPatternFlashActive) return;

    const isBright=atcPatternFlashPhase%2===0;
    applyAtcPatternFlashVisual(isBright);
    atcPatternFlashPhase++;

    if(atcPatternFlashPhase>=totalHalfCycles){
      atcPatternFlashTimer=window.setTimeout(()=>{
        finishAtcPatternFlash();
        updateDisplay(getAtcPlan());
      },ATC_PATTERN_FLASH_HALF_CYCLE_MS);
      return;
    }

    atcPatternFlashTimer=window.setTimeout(
      runNextPhase,
      ATC_PATTERN_FLASH_HALF_CYCLE_MS
    );
  };

  runNextPhase();
}


// v71.4.0: timetable/reference-speed calculations live in systems/timetable.
window.ATCTimetableEngine.configure({
  clamp, lerp, mpsToKmh, ROUTE, TIMETABLE,
  getTrain: () => train
});

function getReferenceSpeedAt(positionM){
  return window.ATCTimetableEngine.getReferenceSpeedAt(positionM);
}

function projectedRemainingSeconds(station){
  return window.ATCTimetableEngine.projectedRemainingSeconds(station);
}

function drawDrivingGraph(plan,nextStation,speedKmh){
  window.ATCDrivingGraphView.draw({
    canvas: ui.drivingGraphCanvas,
    train, ROUTE, nextStation, speedKmh,
    clamp, lerp,
    getReferenceSpeedAt,
    getAtcPlan
  });
}

function updateDisplay(plan = getAtcPlan()) {
  const speedKmh = mpsToKmh(train.speedMps);
  const remaining = ROUTE.stopPosition - train.position;
  const routeProgress = clamp((train.position / ROUTE.stopPosition) * 100, 0, 100);
  const status = getStatus(plan);

  ui.speedValue.textContent = speedKmh.toFixed(1);
  ui.speedBar.style.width = `${clamp((speedKmh / 300) * 100, 0, 100)}%`;
  if (ui.atcValue) {
    const stationTarget = plan.stationTarget === 70 || plan.stationTarget === 30
      ? plan.stationTarget
      : null;

    // null→70、または null/70→30 の投入瞬間だけ開始する。
    // 監視速度が毎フレーム下がっても、点滅を再始動しない。
    if (stationTarget !== null && stationTarget !== previousStationTarget) {
      startAtcPatternFlash(stationTarget);
    }
    previousStationTarget = stationTarget;

    const displayedAtc = atcPatternFlashActive && atcPatternFlashTarget !== null
      ? atcPatternFlashTarget
      : Math.max(0, Math.round(train.atcPermittedKmh));
    ui.atcValue.textContent = displayedAtc;
  }
  ui.positionValue.textContent = (train.position / 1000).toFixed(3);
  ui.remainingValue.textContent = remaining >= 0 ? `${(remaining / 1000).toFixed(3)} km` : `オーバーラン ${Math.abs(remaining).toFixed(1)} m`;
  ui.stopDistanceValue.textContent = remaining.toFixed(1);
  if (remaining < 0 && !train.crashed) {
    ui.nextStationActionLabel.textContent = "潮見中央 オーバーラン";
    ui.nextStationDistanceValue.textContent = `+${Math.abs(remaining).toFixed(1)}`;
  }
  ui.manualModeValue.textContent = plan.manualStop ? "手動停車" : "ATC監視";
  const nextStation = getNextStationForecast();
  const nextStationDistance = Math.max(0, nextStation.position - train.position);
  const forecast = estimateStationTime(nextStation);
  const diagramGuide = getDiagramGuide(nextStation, forecast.differenceSeconds);
  drawDrivingGraph(plan,nextStation,speedKmh);
  if (ui.nextStationActionLabel) ui.nextStationActionLabel.textContent = `${nextStation.name} ${nextStation.action}まで`;
  if (ui.nextStationDistanceValue) {
    const signedDistance = nextStation.position - train.position;
    if (signedDistance <= 30 && signedDistance >= -5) {
      ui.nextStationDistanceValue.textContent = signedDistance.toFixed(1);
    } else if (signedDistance < -5) {
      ui.nextStationDistanceValue.textContent = `超過 ${Math.abs(Math.round(signedDistance)).toLocaleString("ja-JP")}`;
    } else {
      ui.nextStationDistanceValue.textContent = Math.round(signedDistance).toLocaleString("ja-JP");
    }
  }
  if (ui.predictionTypeLabel) ui.predictionTypeLabel.textContent = nextStation.predictionLabel;
  if (ui.predictionTimeValue) ui.predictionTimeValue.textContent = formatClock(forecast.predictedSeconds);
  if (ui.nextStationScheduledValue) ui.nextStationScheduledValue.textContent = formatClock(nextStation.scheduledSeconds);
  if (ui.predictionDifferenceValue) ui.predictionDifferenceValue.textContent = formatForecastDifference(forecast.differenceSeconds);
  if (ui.diagramModeValue) {
    ui.diagramModeValue.textContent = diagramGuide.mode;
    ui.diagramModeValue.className = diagramGuide.className;
  }
  if (ui.diagramTargetSpeedValue) ui.diagramTargetSpeedValue.textContent = `${Math.round(diagramGuide.targetSpeedKmh)} km/h`;
  if (ui.predictionCard) ui.predictionCard.className = `meter-card stop-card prediction-card ${forecastClass(forecast.differenceSeconds)}`;
  ui.stopCard.classList.toggle("manual", plan.manualStop);
  ui.powerDisplay.textContent = train.powerNotch === 0 ? "N" : `P${train.powerNotch}`;
  ui.brakeDisplay.textContent = train.emergencyBrake
    ? "EB"
    : train.brakeNotch === 0
      ? "解除"
      : `B${train.brakeNotch}`;
  ui.accelerationValue.textContent = `${formatSigned(train.acceleration, 3)} m/s²`;
  const currentGradient = gradientAt(train.position);
  const currentPose = routePose(train.position, operatingTrackLateral(train.position));
  if (ui.gradientValue) {
    const arrow = currentGradient > 0.25 ? "↗" : currentGradient < -0.25 ? "↘" : "→";
    ui.gradientValue.textContent = `${arrow} ${Math.abs(currentGradient).toFixed(1)}‰`;
  }
  if (ui.elevationValue) ui.elevationValue.textContent = `${currentPose.elevationM.toFixed(1)} m`;
  ui.atcBrakeValue.textContent = `${Math.round((train.atcBrakeDecel / 1.35) * 100)}%`;
  ui.phaseValue.textContent = train.phase;
  ui.passStationValue.textContent = train.curveStationPassed ? "2駅通過済み" : train.passedStation ? "桜野通過済み" : "未通過";
  if (ui.clockValue) ui.clockValue.textContent = formatClock(train.timetableClockSeconds);
  if (ui.passScheduledValue) ui.passScheduledValue.textContent = formatClock(TIMETABLE.passSeconds);
  if (ui.passActualValue) ui.passActualValue.textContent = train.passActualSeconds == null ? "--:--:--" : `${formatClock(train.passActualSeconds)}（${formatTimeDifference(train.passActualSeconds - TIMETABLE.passSeconds)}）`;
  if (ui.arrivalScheduledValue) ui.arrivalScheduledValue.textContent = formatClock(TIMETABLE.arrivalSeconds);
  if (ui.arrivalActualValue) ui.arrivalActualValue.textContent = train.arrivalActualSeconds == null ? "--:--:--" : `${formatClock(train.arrivalActualSeconds)}（${formatTimeDifference(train.arrivalActualSeconds - TIMETABLE.arrivalSeconds)}）`;
  const atcConfirmDisabled = !train.atc30ConfirmAvailable || train.atc30Confirmed || train.finished;
  const atcAttention = train.atc30ConfirmAvailable && !train.atc30Confirmed && !train.atcConfirmHeld;

  if (ui.atcConfirmButton) {
    ui.atcConfirmButton.disabled = atcConfirmDisabled;
    ui.atcConfirmButton.classList.toggle("attention", atcAttention);
    ui.atcConfirmButton.classList.toggle("held", train.atcConfirmHeld && !train.atc30Confirmed);
    ui.atcConfirmButton.textContent =
      train.atc30Confirmed ? "ATC確認済" :
      train.atcConfirmHeld ? "押下中" :
      "ATC確認";
  }

  if (ui.atcConfirmFloatButton) {
    ui.atcConfirmFloatButton.disabled = atcConfirmDisabled;
    ui.atcConfirmFloatButton.classList.toggle("attention", atcAttention);
    ui.atcConfirmFloatButton.classList.toggle("held", train.atcConfirmHeld && !train.atc30Confirmed);
    ui.atcConfirmFloatButton.textContent =
      train.atc30Confirmed ? "ATC確認済" :
      train.atcConfirmHeld ? "押下中" :
      "ATC確認";
  }
  if (ui.atcConfirmStatus) ui.atcConfirmStatus.textContent = !train.atc30ConfirmAvailable ? "待機" : train.atc30Confirmed ? "確認済" : train.atcConfirmHeld ? "押下中・30待ち" : "押下可能";
  ui.trainMarker.style.left = `${routeProgress}%`;
  ui.routeLine.style.setProperty("--route-progress", `${routeProgress}%`);

  ui.statusLamp.className = `status-lamp ${status.className}`.trim();
  ui.statusText.textContent = status.title;
  ui.messageText.textContent = status.message;
  ui.startButton.disabled = train.running || train.stationPhase === "BOARDING" || train.stationPhase === "READY_TO_DEPART" || train.stationPhase === "ARRIVAL_OPEN";
  const stationButtonLabels = {DOORS_CLOSED_WAIT_OPEN:"ドアを開く",BOARDING:"客終待ち",BUZZER_DONE:"ドアを閉じる",READY_TO_DEPART:"戸閉確認中",DEPARTED:"運転中",ARRIVED:"ドアを開く",ARRIVAL_OPEN:"ドア開"};
  ui.startButton.textContent = train.running ? "運転中" : (stationButtonLabels[train.stationPhase] || "駅扱い");

  const doorActionNeeded =
    train.stationPhase === "DOORS_CLOSED_WAIT_OPEN" ||
    train.stationPhase === "BUZZER_DONE" ||
    train.stationPhase === "ARRIVED";

  ui.startButton.classList.toggle(
    "door-attention",
    doorActionNeeded && !train.running
  );

  if (ui.doorLamp) ui.doorLamp.classList.toggle("on", train.doorsClosed);
  updateDoorScene();
}

function logEvent(message) {
  const item = document.createElement("li");
  item.textContent = message;
  ui.eventLog.prepend(item);

  while (ui.eventLog.children.length > 8) {
    ui.eventLog.lastElementChild.remove();
  }
}

ui.startButton.addEventListener("click", operateStationDoors);
if(ui.boardingSkipButton) ui.boardingSkipButton.addEventListener("click", skipPassengerBoarding);
ui.resetButton.addEventListener("click", resetSimulation);
ui.resultResetButton.addEventListener("click", resetSimulation);
ui.powerUpButton.addEventListener("click", () => changePower(1));
ui.powerDownButton.addEventListener("click", () => changePower(-1));
ui.powerNeutralButton.addEventListener("click", setPowerNeutral);
ui.brakeReleaseButton.addEventListener("click", () => changeBrake(-1));
ui.brakeFullReleaseButton.addEventListener("click", releaseBrakeFully);
ui.brakeStrengthenButton.addEventListener("click", () => changeBrake(1));
ui.emergencyButton?.addEventListener("click", setEmergencyBrake);

function updateAtcConfirmPressedVisual(held){
  const buttons=[ui.atcConfirmButton,ui.atcConfirmFloatButton].filter(Boolean);
  for(const target of buttons){
    target.classList.toggle("held",held && !train.atc30Confirmed);
    if(held && !train.atc30Confirmed){
      target.textContent="押下中";
    }else{
      target.textContent=
        train.atc30Confirmed ? "ATC確認済" :
        target===ui.atcConfirmFloatButton ? "ATC確認" :
        "ATC確認";
    }
  }
  if(ui.atcConfirmStatus){
    ui.atcConfirmStatus.textContent=
      held && !train.atc30Confirmed ? "押下中・30待ち" :
      train.atc30Confirmed ? "確認済" :
      train.atc30ConfirmAvailable ? "押下可能" :
      "待機";
  }
}

function bindAtcConfirmHold(button) {
  if (!button) return;

  const holdStart = (event) => {
    event.preventDefault();
    if (button.disabled) return;
    train.atcConfirmHeld = true;
    const speedKmh = mpsToKmh(train.speedMps);
    train.atc30ConfirmArmedAbove30 = speedKmh > 30.2;
    updateAtcConfirmPressedVisual(true);
    if (event.pointerId != null && button.setPointerCapture) {
      try { button.setPointerCapture(event.pointerId); } catch (_) {}
    }
    // 30 km/h以下ですでに減速中なら、押した瞬間に確認成立。
    // 30 km/hより上なら押下状態を保持し、到達時にupdateAtc()側で成立する。
    if (speedKmh <= 30.2) confirmAtc30({ fromPress: true });
  };

  const holdEnd = (event) => {
    train.atcConfirmHeld = false;
    train.atc30ConfirmArmedAbove30 = false;
    updateAtcConfirmPressedVisual(false);
    if (event?.pointerId != null && button.releasePointerCapture) {
      try { button.releasePointerCapture(event.pointerId); } catch (_) {}
    }
  };

  button.addEventListener("pointerdown", holdStart);
  button.addEventListener("pointerup", holdEnd);
  button.addEventListener("pointercancel", holdEnd);
  button.addEventListener("lostpointercapture", holdEnd);
}
bindAtcConfirmHold(ui.atcConfirmButton);
bindAtcConfirmHold(ui.atcConfirmFloatButton);

if (ui.mixerOptionButton && ui.motorMixerPanel) {
  ui.mixerOptionButton.addEventListener("click", () => {
    const willOpen = !ui.motorMixerPanel.open;
    ui.motorMixerPanel.open = willOpen;
    ui.motorMixerPanel.classList.toggle("option-open", willOpen);
    ui.mixerOptionButton.setAttribute("aria-expanded", String(willOpen));
  });
  ui.motorMixerPanel.addEventListener("toggle", () => {
    ui.motorMixerPanel.classList.toggle("option-open", ui.motorMixerPanel.open);
    ui.mixerOptionButton.setAttribute("aria-expanded", String(ui.motorMixerPanel.open));
  });
}
ui.soundToggleButton.addEventListener("click", toggleSound);
ui.soundTestButton.addEventListener("click", () => {
  ensureAudioContext();
  playAtcChime();
});
if(ui.brake70TestButton) ui.brake70TestButton.addEventListener("click", () => {ensureAudioContext();play70BrakeAlarm();});
if(ui.brake70TestButtonPanel) ui.brake70TestButtonPanel.addEventListener("click", () => {ensureAudioContext();play70BrakeAlarm();});
if(ui.doorOpenTestButton) ui.doorOpenTestButton.addEventListener("click",()=>{ensureAudioContext();playDoorOpenSound();});
if(ui.doorCloseTestButton) ui.doorCloseTestButton.addEventListener("click",()=>{ensureAudioContext();playDoorCloseSound();});
if(ui.boardingBuzzerTestButton) ui.boardingBuzzerTestButton.addEventListener("click",()=>{ensureAudioContext();playBoardingBuzzer();});
if(ui.driverVoiceToggle) ui.driverVoiceToggle.addEventListener("change",()=>{driverVoice.enabled=ui.driverVoiceToggle.checked;updateDriverVoiceDisplay();});
if(ui.voiceDoorTestButton) ui.voiceDoorTestButton.addEventListener("click",()=>speakDriverCall("戸閉め点", "とじめてん"));
if(ui.voiceDepartTestButton) ui.voiceDepartTestButton.addEventListener("click",()=>speakDriverCall("出発進行", "しゅっぱつ、しんこう"));
if(ui.voiceSignalTestButton) ui.voiceSignalTestButton.addEventListener("click",()=>callSignal(300));
if(ui.voiceTargetTestButton) ui.voiceTargetTestButton.addEventListener("click",()=>callTarget(70));
if(ui.voice70TestButton) ui.voice70TestButton.addEventListener("click",()=>callSignal(70));
if(ui.voice30TestButton) ui.voice30TestButton.addEventListener("click",()=>callSignal(30));
if(ui.voiceStopTestButton) ui.voiceStopTestButton.addEventListener("click",()=>speakDriverCall("停車", "ていしゃ"));
[
  ui.openAirDurationInput,ui.openAirLevelInput,ui.openAirPitchInput,ui.openLockPitchInput,ui.openLockLevelInput,ui.openVolumeInput,
  ui.boardingFrequencyInput,ui.boardingDurationInput,ui.boardingVolumeInput,ui.boardingWaveSelect
].filter(Boolean).forEach(input=>{input.addEventListener("input",applyStationSoundInputs);input.addEventListener("change",applyStationSoundInputs);});
if(ui.soundPresetSelect) ui.soundPresetSelect.addEventListener("change", setSoundPreset);
[
  ui.globalTuningInput,ui.pinTuningInput,ui.pongTuningInput,ui.pinDurationInput,ui.pongDurationInput,ui.chimeGapInput,ui.chimeOverlapInput,ui.chimeVolumeInput,ui.pinPitchSelect,ui.pongPitchSelect,
  ui.pinSineInput,ui.pinTriangleInput,ui.pinSquareInput,ui.pinSawInput,ui.pongSineInput,ui.pongTriangleInput,ui.pongSquareInput,ui.pongSawInput,
  ui.pinAttackInput,ui.pinDecayInput,ui.pinSustainInput,ui.pinEnvReleaseInput,ui.pongAttackInput,ui.pongDecayInput,ui.pongSustainInput,ui.pongEnvReleaseInput,
  ui.pinFilterInput,ui.pongFilterInput,ui.pinDriveInput,ui.pongDriveInput
].filter(Boolean).forEach(input=>{input.addEventListener("input",()=>applySoundSettingFromInputs());input.addEventListener("change",()=>applySoundSettingFromInputs({preview:true}));});
ui.soundResetButton.addEventListener("click",resetSoundSettings);ui.soundExportButton.addEventListener("click",exportSoundSettings);ui.soundImportButton.addEventListener("click",importSoundSettings);

ui.applyCharacterButton.addEventListener("click",()=>applyToneCharacter(ui.toneFamilySelect.value,ui.toneVariationSelect.value,{preview:true}));
ui.toneFamilySelect.addEventListener("change",()=>{sound.family=ui.toneFamilySelect.value;if(ui.characterDescription)ui.characterDescription.textContent=TONE_FAMILIES[sound.family].description;});
ui.toneVariationSelect.addEventListener("change",()=>{sound.variation=ui.toneVariationSelect.value;});
ui.compareVariationsButton.addEventListener("click",compareVariations);
[ui.mudInput,ui.boxInput,ui.speakerInput].forEach(x=>{x.addEventListener("input",()=>applyMacroControls());x.addEventListener("change",()=>applyMacroControls({preview:true}));});

ui.rateButtons.forEach((button) => {
  button.addEventListener("click", () => setSimulationRate(Number(button.dataset.rate)));
});

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const preventKeys = ["arrowup", "arrowdown", " "];
  if (preventKeys.includes(key)) event.preventDefault();

  if (event.repeat && ["enter", "f", "r", " "].includes(key)) return;

  switch (key) {
    case "enter":
    case "f":
      operateStationDoors();
      break;
    case "r":
      resetSimulation();
      break;
    case "w":
      changePower(1);
      break;
    case "s":
      changePower(-1);
      break;
    case "arrowup":
      changeBrake(-1);
      break;
    case "arrowdown":
      changeBrake(1);
      break;
    case " ":
      setEmergencyBrake();
      break;
    case "c": {
      train.atcConfirmHeld = true;
      updateAtcConfirmPressedVisual(true);
      const speedKmh = mpsToKmh(train.speedMps);
      train.atc30ConfirmArmedAbove30 = speedKmh > 30.2;
      if (speedKmh <= 30.2) confirmAtc30({ fromPress: true });
      break;
    }
    default:
      break;
  }
});

document.addEventListener("keyup", (event) => {
  if (event.key.toLowerCase() === "c") {
    train.atcConfirmHeld = false;
    train.atc30ConfirmArmedAbove30 = false;
    updateAtcConfirmPressedVisual(false);
  }
});

const performanceMetrics = {
  frameMs: 0, physicsMs: 0, worldMs: 0, renderMs: 0, hudMs: 0,
  physicsSteps: 0, frameTimestamp: performance.now(), rendered: false,
  executedFrames: 0, droppedBudgetFrames: 0, maxStepHits: 0,
  frameSamples: [], physicsSamples: [], renderSamples: [],
  framePeakMs: 0, physicsPeakMs: 0, renderPeakMs: 0
};
window.__SHINKANSEN_PERF_METRICS__ = performanceMetrics;

let previousTime = performance.now();
let physicsAccumulatorSeconds = 0;
let lastRenderedSimulationPositionM = train.position;
let lastGameLoopTime = 0;

function gameLoop(currentTime) {
  requestAnimationFrame(gameLoop);
  if (lastGameLoopTime && currentTime - lastGameLoopTime < ATC_PERFORMANCE_PROFILE.frameIntervalMs) return;
  const frameWorkStarted = performance.now();
  lastGameLoopTime = currentTime - ((currentTime - lastGameLoopTime) % ATC_PERFORMANCE_PROFILE.frameIntervalMs);
  const realDelta = Math.min(
    Math.max(0,(currentTime-previousTime)/1000),
    VISUAL_MOTION_TUNING.maxRealDeltaSeconds
  );
  previousTime = currentTime;

  // Never discard elapsed time merely because the scene was expensive to render.
  // Physics advances in equal steps, so 30/60/120 fps cover the same distance.
  physicsAccumulatorSeconds += realDelta * train.simulationRate;
  let steps = 0;
  const physicsStarted = performance.now();
  while(
    physicsAccumulatorSeconds >= VISUAL_MOTION_TUNING.fixedStepSeconds &&
    steps < VISUAL_MOTION_TUNING.maxPhysicsStepsPerFrame
  ){
    train.timetableClockSeconds += VISUAL_MOTION_TUNING.fixedStepSeconds;
    updateDepartureRouteSystem();
    lastRenderedSimulationPositionM = train.position;
    updateTrain(VISUAL_MOTION_TUNING.fixedStepSeconds);
    physicsAccumulatorSeconds -= VISUAL_MOTION_TUNING.fixedStepSeconds;
    steps++;
  }

  // If a very heavy frame creates backlog, retain it for later frames instead of
  // deleting distance. Limit only runaway accumulation after long tab suspension.
  physicsAccumulatorSeconds = Math.min(physicsAccumulatorSeconds,.50);
  performanceMetrics.physicsMs = performance.now() - physicsStarted;
  performanceMetrics.physicsSteps = steps;
  if (steps >= VISUAL_MOTION_TUNING.maxPhysicsStepsPerFrame) performanceMetrics.maxStepHits++;

  const worldStarted = performance.now();
  if(train.departureSignActive && (mpsToKmh(train.speedMps)>=.5 || !train.doorsClosed || train.emergencyBrake)) stopDepartureSign();
  updateMotorSound();
  const boardingHost = document.getElementById("doorScene");
  const boardingSceneVisible = train.stationPhase === "BOARDING" && boardingHost && !boardingHost.classList.contains("hidden");
  performanceMetrics.rendered = !boardingSceneVisible;
  if (!boardingSceneVisible) {
    const renderStarted = performance.now();
    drawScenery(realDelta);
    performanceMetrics.renderMs = performance.now() - renderStarted;
  } else {
    performanceMetrics.renderMs = 0;
  }
  if(train.stationPhase==="BOARDING") updateDoorScene();
  performanceMetrics.worldMs = performance.now() - worldStarted - performanceMetrics.renderMs;
  performanceMetrics.frameMs = performance.now() - frameWorkStarted;
  performanceMetrics.frameTimestamp = currentTime;
  performanceMetrics.executedFrames++;
  if (performanceMetrics.frameMs > ATC_PERFORMANCE_PROFILE.frameIntervalMs) performanceMetrics.droppedBudgetFrames++;
  performanceMetrics.framePeakMs = Math.max(performanceMetrics.framePeakMs, performanceMetrics.frameMs);
  performanceMetrics.physicsPeakMs = Math.max(performanceMetrics.physicsPeakMs, performanceMetrics.physicsMs);
  performanceMetrics.renderPeakMs = Math.max(performanceMetrics.renderPeakMs, performanceMetrics.renderMs);
  const pushSample = (list, value) => { list.push(value); if (list.length > 180) list.shift(); };
  pushSample(performanceMetrics.frameSamples, performanceMetrics.frameMs);
  pushSample(performanceMetrics.physicsSamples, performanceMetrics.physicsMs);
  pushSample(performanceMetrics.renderSamples, performanceMetrics.renderMs);
}

// v65.1.1 diagnostics: ブラウザコンソールから動作状態を確認可能。
window.__SHINKANSEN_BUILD__ = "v74.4.3-alpha21-route-strip-step2x";
window.__SHINKANSEN_TEST__ = {
  getState: () => ({
    build: window.__SHINKANSEN_BUILD__,
    performanceProfile: ATC_PERFORMANCE_PROFILE,
    visualScale: SCENERY_SCALE,
    fixedStepSeconds: VISUAL_MOTION_TUNING.fixedStepSeconds,
    physicsBacklogSeconds: physicsAccumulatorSeconds,
    stationPhase: train.stationPhase,
    doorsClosed: train.doorsClosed,
    departurePreannounceDone: train.departurePreannounceDone,
    departureRouteState: train.departureRouteState,
    departureRouteSetDone: train.departureRouteSetDone,
    departureRouteChimePlayed: train.departureRouteChimePlayed,
    departureAtcSignalKmh: train.departureAtcSignalKmh,
    departureRemainingSeconds: getDepartureRemainingSeconds(),
    audioContextState: sound.context?.state ?? "not-created",
    departurePhysicallyDeparted: train.position>1 || mpsToKmh(train.speedMps)>=0.5,
    doorOpenRatio: train.doorOpenRatio,
    sceneryInitialized: scenery.initialized,
    sceneryFailed: scenery.failed,
    threeLoaded: typeof THREE !== "undefined",
    visualSpeedMultiplier: VISUAL_SPEED_MULTIPLIER,
    pointSoundMarkers: window.__POINT_SOUND_MARKERS__,
    pointSoundLog: window.__POINT_SOUND_LOG__
  }),
  operateDoors: operateStationDoors,
  skipBoarding: skipPassengerBoarding,
  retryScenery: () => { scenery.failed = false; return initializeThreeScenery(); }
};

const focusedDiagnosticState = {
  previousBacklogMs: 0,
  previousSnapshotAt: performance.now(),
  baselineOwnerInstances: new Map(),
  peakOwnerInstances: new Map(),
  initialized: false,
  consecutiveBudgetMisses: 0,
  longestBudgetMissStreak: 0
};

window.__SHINKANSEN_PERF_SNAPSHOT__ = () => {
  const renderer = scenery.renderer;
  const scene = scenery.scene;
  const now = performance.now();
  const elapsedSeconds = Math.max(.001, (now - focusedDiagnosticState.previousSnapshotAt) / 1000);
  const owners = new Map();
  const structureStats = new Map();
  const purposeStats = new Map();
  const chunkStats = new Map();
  let visibleInstancedMeshes = 0;
  let visibleInstances = 0;
  let chunkInstancedMeshes = 0;
  let chunkInstances = 0;
  let globalInstancedMeshes = 0;
  let globalInstances = 0;

  const isInsideRouteChunk = object => {
    let current = object;
    while (current) {
      if (scenery.routeChunks?.includes(current)) return true;
      current = current.parent;
    }
    return false;
  };
  const fallbackOwner = object => {
    const geometry = object.geometry;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    const type = geometry?.type || "Geometry";
    const color = material?.color?.getHexString?.() || "none";
    const parentName = object.parent?.name || object.parent?.type || "Scene";
    return `unnamed:${parentName}:${type}:#${color}`;
  };
  const effectiveVisible = object => {
    let current = object;
    while (current) {
      if (current.visible === false) return false;
      current = current.parent;
    }
    return true;
  };

  scene?.traverse?.(object => {
    if (!object.isInstancedMesh || !effectiveVisible(object)) return;
    const instances = object.count || 0;
    const label = object.userData?.performanceOwner || object.name || fallbackOwner(object);
    const inChunk = isInsideRouteChunk(object);
    const item = owners.get(label) || { meshes:0, instances:0, chunkMeshes:0, chunkInstances:0, geometryIds:new Set(), materialIds:new Set() };
    item.meshes++;
    item.instances += instances;
    if (inChunk) { item.chunkMeshes++; item.chunkInstances += instances; }
    if (object.geometry?.uuid) item.geometryIds.add(object.geometry.uuid);
    const mats = Array.isArray(object.material) ? object.material : [object.material];
    for (const mat of mats) if (mat?.uuid) item.materialIds.add(mat.uuid);
    owners.set(label,item);

    const structure = object.userData?.performanceStructure || (inChunk ? "unclassified-chunk" : "fixed-scenery");
    const purpose = object.userData?.performancePurpose || (inChunk ? "unclassified" : "fixed-scenery");
    const addStat = (map,key) => {
      const stat = map.get(key) || { meshes:0, instances:0 };
      stat.meshes++;
      stat.instances += instances;
      map.set(key,stat);
    };
    addStat(structureStats,structure);
    addStat(purposeStats,`${structure} / ${purpose}`);

    if (inChunk) {
      let current = object;
      while (current && !scenery.routeChunks?.includes(current)) current = current.parent;
      if (current) {
        const startM = Number(current.userData?.startM || 0);
        const endM = Number(current.userData?.endM || 0);
        const type = current.userData?.structureType || "unknown";
        const key = `${Math.round(startM)}–${Math.round(endM)}m / ${type}`;
        const stat = chunkStats.get(key) || { meshes:0, instances:0, startM, endM, type };
        stat.meshes++;
        stat.instances += instances;
        chunkStats.set(key,stat);
      }
    }
    visibleInstancedMeshes++;
    visibleInstances += instances;
    if (inChunk) { chunkInstancedMeshes++; chunkInstances += instances; }
    else { globalInstancedMeshes++; globalInstances += instances; }
  });

  if (!focusedDiagnosticState.initialized) {
    for (const [label,item] of owners) {
      focusedDiagnosticState.baselineOwnerInstances.set(label,item.instances);
      focusedDiagnosticState.peakOwnerInstances.set(label,item.instances);
    }
  }

  const ownerRanking = [...owners.entries()].map(([label,item]) => {
    const baseline = focusedDiagnosticState.baselineOwnerInstances.get(label) || 0;
    const peak = Math.max(focusedDiagnosticState.peakOwnerInstances.get(label) || 0,item.instances);
    focusedDiagnosticState.peakOwnerInstances.set(label,peak);
    return [label,{
      meshes:item.meshes,
      instances:item.instances,
      delta:item.instances-baseline,
      peak,
      avg:item.meshes ? item.instances/item.meshes : 0,
      chunkInstances:item.chunkInstances,
      globalInstances:item.instances-item.chunkInstances,
      geometries:item.geometryIds.size,
      materials:item.materialIds.size
    }];
  }).sort((a,b)=>b[1].instances-a[1].instances).slice(0,14);

  const growthRanking = [...ownerRanking].filter(([,v])=>v.delta!==0).sort((a,b)=>Math.abs(b[1].delta)-Math.abs(a[1].delta)).slice(0,10);
  const meshRanking = [...ownerRanking].sort((a,b)=>b[1].meshes-a[1].meshes).slice(0,10);
  const structureRanking = [...structureStats.entries()].sort((a,b)=>b[1].instances-a[1].instances);
  const purposeRanking = [...purposeStats.entries()].sort((a,b)=>b[1].instances-a[1].instances).slice(0,10);
  const activeChunkRanking = [...chunkStats.entries()].sort((a,b)=>b[1].instances-a[1].instances).slice(0,10);

  const backlogMs = physicsAccumulatorSeconds*1000;
  const backlogRate = (backlogMs-focusedDiagnosticState.previousBacklogMs)/elapsedSeconds;
  const budget = ATC_PERFORMANCE_PROFILE.frameIntervalMs;
  if (performanceMetrics.frameMs>budget) {
    focusedDiagnosticState.consecutiveBudgetMisses++;
    focusedDiagnosticState.longestBudgetMissStreak=Math.max(focusedDiagnosticState.longestBudgetMissStreak,focusedDiagnosticState.consecutiveBudgetMisses);
  } else focusedDiagnosticState.consecutiveBudgetMisses=0;

  const percentile=(values,p)=>{if(!values?.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*p))];};
  const chunks=scenery.routeChunks||[];
  const activeChunks=chunks.filter(chunk=>chunk.visible).length;
  const info=renderer?.info;
  const result={
    build:window.__SHINKANSEN_BUILD__,targetFps:ATC_PERFORMANCE_PROFILE.targetFps,
    speedKmh:mpsToKmh(train.speedMps),distanceM:train.position,
    frameMs:performanceMetrics.frameMs,frameP95Ms:percentile(performanceMetrics.frameSamples,.95),framePeakMs:performanceMetrics.framePeakMs,
    droppedBudgetFrames:performanceMetrics.droppedBudgetFrames,executedFrames:performanceMetrics.executedFrames,
    consecutiveBudgetMisses:focusedDiagnosticState.consecutiveBudgetMisses,longestBudgetMissStreak:focusedDiagnosticState.longestBudgetMissStreak,
    physicsMs:performanceMetrics.physicsMs,physicsSteps:performanceMetrics.physicsSteps,
    physicsPerStepMs:performanceMetrics.physicsSteps?performanceMetrics.physicsMs/performanceMetrics.physicsSteps:0,
    physicsBacklogMs:backlogMs,backlogRateMsPerSec:backlogRate,maxStepHits:performanceMetrics.maxStepHits,
    renderMs:performanceMetrics.renderMs,drawCalls:info?.render?.calls??0,triangles:info?.render?.triangles??0,gpuGeometries:info?.memory?.geometries??0,
    activeChunks,totalChunks:chunks.length,
    visibleInstancedMeshes,visibleInstances,chunkInstancedMeshes,chunkInstances,globalInstancedMeshes,globalInstances,
    ownerRanking,growthRanking,meshRanking,structureRanking,purposeRanking,activeChunkRanking
  };
  focusedDiagnosticState.previousBacklogMs=backlogMs;
  focusedDiagnosticState.previousSnapshotAt=now;
  focusedDiagnosticState.initialized=true;
  return result;
};
window.__SHINKANSEN_PERF_RESET__ = () => {
  Object.assign(performanceMetrics,{executedFrames:0,droppedBudgetFrames:0,maxStepHits:0,frameSamples:[],physicsSamples:[],renderSamples:[],framePeakMs:0,physicsPeakMs:0,renderPeakMs:0});
  Object.assign(focusedDiagnosticState,{
    previousBacklogMs:physicsAccumulatorSeconds*1000,
    previousSnapshotAt:performance.now(),
    baselineOwnerInstances:new Map(),peakOwnerInstances:new Map(),initialized:false,
    consecutiveBudgetMisses:0,longestBudgetMissStreak:0
  });
};

loadSoundSettings();
loadRunningSoundMix();
updateRunningSoundMixDisplay();
bindRunningSoundMixer();
loadStationSoundSettings();
updateStationSoundDisplay();
updateDriverVoiceDisplay();
if(!sound.family||!TONE_FAMILIES[sound.family])Object.assign(sound,{family:'softMuddy',variation:'B',mud:.43,box:.38,speaker:.28});
updateSoundSettingsDisplay();
updateDisplay(getAtcPlan());
updateDoorScene();

function setInitialLoadingProgressV7072(value,label){
  if(typeof window.__ATC_LOADING_PAINT__==="function"){
    window.__ATC_LOADING_PAINT__(value,label);
  }
}

function finishInitialLoadingV7072(){
  const overlay=document.getElementById("initialLoadingOverlay");
  setInitialLoadingProgressV7072(100,"準備完了");
  window.setTimeout(()=>overlay?.classList.add("is-complete"),180);
}

function startSimulatorV7072(){
  setInitialLoadingProgressV7072(18,"路線データを確認しています…");
  requestAnimationFrame(()=>{
    setInitialLoadingProgressV7072(32,"線路と景観を生成しています…");
    window.setTimeout(()=>{
      const started=performance.now();
      drawScenery(0);
      const elapsed=Math.round(performance.now()-started);
      setInitialLoadingProgressV7072(88,`描画エンジンを確認しています… (${elapsed}ms)`);
      requestAnimationFrame(()=>{
        finishInitialLoadingV7072();
        requestAnimationFrame(gameLoop);
      });
    },30);
  });
}

if(document.readyState==="loading"){
  window.addEventListener("DOMContentLoaded",startSimulatorV7072,{once:true});
}else{
  startSimulatorV7072();
}

// v43 direct vertical lever controls ------------------------------------------
(() => {
  const powerDisplay = document.getElementById("powerDisplay");
  const brakeDisplay = document.getElementById("brakeDisplay");
  const powerReadout = document.getElementById("powerTrackReadout");
  const brakeReadout = document.getElementById("brakeTrackReadout");
  const powerHandle = document.getElementById("powerLeverHandle");
  const powerAssembly = document.getElementById("powerLeverAssembly");
  const brakeHandle = document.getElementById("brakeLeverHandle");
  const brakeAssembly = document.getElementById("brakeLeverAssembly");
  if (!powerDisplay || !brakeDisplay || !powerHandle || !brakeHandle ||
      !powerAssembly || !brakeAssembly) return;

  const powerLabel = value => value === 0 ? "N" : `P${value}`;
  const brakeLabel = () => train.emergencyBrake ? "非常" : (train.brakeNotch === 0 ? "解除" : `B${train.brakeNotch}`);

  const sync = () => {
    // レバーは指令位置を即時表示し、物理へ使う実ノッチだけを遅延させる。
    const shownPower = train.powerCommandTimer && Number.isFinite(train.requestedPowerNotch)
      ? train.requestedPowerNotch : train.powerNotch;
    const shownBrake = train.brakeCommandTimer && Number.isFinite(train.requestedBrakeNotch)
      ? train.requestedBrakeNotch : train.brakeNotch;
    powerHandle.style.top = `${4 + (shownPower / 13) * 88}%`;
    const brakeIndex = train.emergencyBrake ? 8 : shownBrake;
    brakeHandle.style.top = `${92 - (brakeIndex / 8) * 88}%`;

    if (powerReadout) powerReadout.textContent = powerLabel(shownPower);
    if (brakeReadout) brakeReadout.textContent = train.emergencyBrake ? "非常" : (shownBrake===0 ? "解除" : `B${shownBrake}`);
  };

  function setPowerDirect(target) {
    if (train.finished) return;
    target=clamp(Math.round(target),0,13);
    queuePowerCommand(target);
    sync();
  }

  function setBrakeDirect(target) {
    if (train.finished) return;
    target=clamp(Math.round(target),0,8);
    if(target>=8) setEmergencyBrake();
    else queueBrakeCommand(target);
    sync();
  }

  function bindVerticalDrag(element, callback) {
    let activePointer = null;

    const apply = event => {
      const rect = element.getBoundingClientRect();
      const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      callback(y);
    };

    element.addEventListener("pointerdown", event => {
      activePointer = event.pointerId;
      element.setPointerCapture?.(event.pointerId);
      apply(event);
      event.preventDefault();
    });

    element.addEventListener("pointermove", event => {
      if (event.pointerId !== activePointer) return;
      apply(event);
      event.preventDefault();
    });

    const finish = event => {
      if (event.pointerId === activePointer) activePointer = null;
    };
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", finish);
  }

  // 表示上の停止位置は4%〜92%。クリック判定も同じ範囲へ正規化する。
  // 以前は0%〜100%で計算していたため、表示位置を触ると1段ずれていた。
  const normalizeLeverStop = y => clamp((y - 0.04) / 0.88, 0, 1);
  bindVerticalDrag(powerAssembly, y => setPowerDirect(normalizeLeverStop(y) * 13));
  bindVerticalDrag(brakeAssembly, y => setBrakeDirect((1 - normalizeLeverStop(y)) * 8));

  new MutationObserver(sync).observe(powerDisplay, { childList:true, subtree:true, characterData:true });
  new MutationObserver(sync).observe(brakeDisplay, { childList:true, subtree:true, characterData:true });
  sync();
})();



// v66.0: landscape-only mobile cockpit and fixed fullscreen mode.
(() => {
  const root = document.documentElement;
  const fullscreenButton = document.getElementById("fullscreenButton");
  const orientationFullscreenButton = document.getElementById("orientationFullscreenButton");
  const orientationGuard = document.getElementById("orientationGuard");

  const isCompactTouchDevice = () =>
    window.matchMedia("(pointer: coarse)").matches &&
    Math.min(screen.width, screen.height) <= 900;

  const refreshOrientationGuard = () => {
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    const shouldGuard = isCompactTouchDevice() && portrait;
    orientationGuard?.classList.toggle("visible", shouldGuard);
    document.body.classList.toggle("orientation-blocked", shouldGuard);
  };

  const refreshFullscreenUi = () => {
    const active = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    document.body.classList.toggle("fullscreen-active", active);
    if (fullscreenButton) fullscreenButton.textContent = active ? "フルスクリーン終了" : "フルスクリーン";
  };

  async function enterCockpitFullscreen() {
    try {
      const target = document.querySelector(".app-shell") || root;
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: "hide" });
        else if (target.webkitRequestFullscreen) target.webkitRequestFullscreen();
      }
      try { await screen.orientation?.lock?.("landscape"); } catch (_) {}
    } catch (error) {
      console.warn("Fullscreen request was rejected:", error);
    } finally {
      refreshFullscreenUi();
      refreshOrientationGuard();
    }
  }

  async function toggleCockpitFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      } catch (_) {}
    } else {
      await enterCockpitFullscreen();
    }
  }

  fullscreenButton?.addEventListener("click", toggleCockpitFullscreen);
  orientationFullscreenButton?.addEventListener("click", enterCockpitFullscreen);
  document.addEventListener("fullscreenchange", refreshFullscreenUi);
  document.addEventListener("webkitfullscreenchange", refreshFullscreenUi);
  window.addEventListener("resize", refreshOrientationGuard, { passive: true });
  window.addEventListener("orientationchange", refreshOrientationGuard, { passive: true });

  // Prevent browser page gestures while operating the cab. Controls keep their own pointer handling.
  document.addEventListener("touchmove", event => {
    if (document.body.classList.contains("fullscreen-active")) event.preventDefault();
  }, { passive: false });

  refreshFullscreenUi();
  refreshOrientationGuard();
})();




