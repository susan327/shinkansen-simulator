"use strict";

// Timetable calculation owns reference profile and dynamic ETA state.
window.ATCTimetableEngine = (() => {
  let deps = null;
  let forecastSpeedEmaKmh = 0;
  const displaySeconds = new Map();

  function configure(options) {
    deps = options;
  }

  function requireDeps() {
    if (!deps) throw new Error("ATCTimetableEngine is not configured");
    return deps;
  }

  function getReferenceSpeedAt(positionM) {
    const { clamp, lerp, ROUTE } = requireDeps();
    const p = clamp(positionM, 0, ROUTE.stopPosition);
    if (p < 18000) {
      if (p < 7500) return Math.min(280, Math.sqrt(Math.max(0, p / 7500)) * 280);
      return 280;
    }
    if (p < 26000) return 280;
    if (p < 32000) return lerp(280, 150, (p - 26000) / 6000);
    if (p < 35500) return lerp(150, 210, (p - 32000) / 3500);
    if (p < 45500) return 265;
    if (p < 50800) return lerp(265, 60, (p - 45500) / 5300);
    if (p < 51850) return lerp(60, 25, (p - 50800) / 1050);
    return Math.max(0, lerp(25, 0, (p - 51850) / 150));
  }

  function projectedRemainingSeconds(station) {
    const { clamp, lerp, mpsToKmh, getTrain } = requireDeps();
    const train = getTrain();
    const start = Math.max(0, train.position);
    const end = Math.max(start, station.position);
    if (end - start <= 0) return 0;

    const currentKmh = mpsToKmh(train.speedMps);
    forecastSpeedEmaKmh = forecastSpeedEmaKmh <= 0
      ? currentKmh
      : lerp(forecastSpeedEmaKmh, currentKmh, 0.08);

    let seconds = 0;
    const stepM = 100;
    for (let p = start; p < end; p += stepM) {
      const segmentM = Math.min(stepM, end - p);
      const midpoint = p + segmentM * 0.5;
      const referenceKmh = Math.max(15, getReferenceSpeedAt(midpoint));
      const aheadM = midpoint - start;
      const currentWeight = clamp(1 - aheadM / 3000, 0, 1) * 0.72;
      const observedKmh = Math.max(train.running ? 8 : 0, forecastSpeedEmaKmh);
      const projectedKmh = lerp(referenceKmh, observedKmh, currentWeight);
      seconds += segmentM / (Math.max(5, projectedKmh) / 3.6);
    }
    return seconds;
  }

  function estimateStationTime(station) {
    const { clamp, lerp, TIMETABLE, getTrain } = requireDeps();
    const train = getTrain();
    let rawPrediction;
    if (!train.running && train.position < 1) {
      const departureDelay = Math.max(0, train.timetableClockSeconds - TIMETABLE.departureSeconds);
      rawPrediction = station.scheduledSeconds + departureDelay;
    } else {
      rawPrediction = train.timetableClockSeconds + projectedRemainingSeconds(station);
    }

    const previous = displaySeconds.get(station.name);
    const smoothed = previous == null ? rawPrediction : lerp(previous, rawPrediction, 0.075);
    displaySeconds.set(station.name, smoothed);
    const predictedSeconds = clamp(smoothed, station.scheduledSeconds - 300, station.scheduledSeconds + 900);
    return { predictedSeconds, differenceSeconds: predictedSeconds - station.scheduledSeconds };
  }

  function resetForecast() {
    forecastSpeedEmaKmh = 0;
    displaySeconds.clear();
  }

  return { configure, getReferenceSpeedAt, projectedRemainingSeconds, estimateStationTime, resetForecast };
})();
