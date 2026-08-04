"use strict";
/**
 * 乗降経路はStationWorldSpecの安全領域から生成する。
 * 線路中心や旧駅の固定Z座標を持たない。
 */
(() => {
  function safeZ(zone, desired) {
    return Math.max(zone.z.min + 0.12, Math.min(zone.z.max - 0.12, desired));
  }

  window.ATC_createAlightPath = function createAlightPath({
    THREE, doorX, laneOffset, doorThresholdZ, stairs, platformSafeZone,
    platformTopY = 0, passengerFloorY = platformTopY + 0.05
  }) {
    const platformDirection = Math.sign(platformSafeZone.centerZ - doorThresholdZ) || 1;
    const firstPlatformZ = safeZ(platformSafeZone, doorThresholdZ + platformDirection * 0.90);
    return [
      new THREE.Vector3(doorX + laneOffset * 0.25, passengerFloorY, doorThresholdZ - platformDirection * 0.92),
      new THREE.Vector3(doorX + laneOffset * 0.35, platformTopY + (passengerFloorY-platformTopY)*0.55, doorThresholdZ - platformDirection * 0.18),
      new THREE.Vector3(doorX + laneOffset, platformTopY, firstPlatformZ),
      new THREE.Vector3(stairs.approach.x + laneOffset * 0.18, platformTopY, safeZ(platformSafeZone, stairs.approach.z)),
      new THREE.Vector3(stairs.gate.x + laneOffset * 0.14, platformTopY, safeZ(platformSafeZone, stairs.gate.z)),
      new THREE.Vector3(stairs.entry.x + laneOffset * 0.12, platformTopY, safeZ(platformSafeZone, stairs.entry.z)),
      new THREE.Vector3(stairs.top.x + laneOffset * 0.10, stairs.top.y, stairs.top.z),
      new THREE.Vector3(stairs.lower.x + laneOffset * 0.08, stairs.lower.y, stairs.lower.z),
      new THREE.Vector3(stairs.exit.x + laneOffset * 0.08, stairs.exit.y, stairs.exit.z)
    ];
  };

  window.ATC_createBoardPath = function createBoardPath({
    THREE, doorX, doorIndex, orderAtDoor, doorThresholdZ, platformSafeZone,
    platformTopY = 0, passengerFloorY = platformTopY + 0.05
  }) {
    const queueSide = doorIndex === 0 ? 1 : -1;
    const row = Math.floor(orderAtDoor / 2);
    const lane = orderAtDoor % 2;
    const startX = doorX + queueSide * (3.0 + row * 1.15) + (lane - 0.5) * 0.52;
    const platformDirection = Math.sign(platformSafeZone.centerZ - doorThresholdZ) || 1;
    const queueZ = safeZ(platformSafeZone, platformSafeZone.centerZ + (lane ? 0.45 : -0.45));
    const approachZ = safeZ(platformSafeZone, doorThresholdZ + platformDirection * 1.25 + lane * 0.12);
    const thresholdPlatformZ = safeZ(platformSafeZone, doorThresholdZ + platformDirection * 0.78);
    return [
      new THREE.Vector3(startX, platformTopY, queueZ),
      new THREE.Vector3(doorX + queueSide * 1.70, platformTopY, approachZ),
      new THREE.Vector3(doorX + queueSide * 0.52, platformTopY, thresholdPlatformZ),
      new THREE.Vector3(doorX, platformTopY + (passengerFloorY-platformTopY)*0.55, doorThresholdZ),
      new THREE.Vector3(doorX, passengerFloorY, doorThresholdZ - platformDirection * 1.05)
    ];
  };
})();
