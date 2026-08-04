"use strict";

/* v72.1.0 駅データ駆動・共通乗降シーン
 * - 降車客: 車内 → ホーム → 下り階段 → 下層コンコース
 * - 乗車客: ドア別待機列から一人ずつ乗車
 * - 車両: 丸み、台車、床下機器、窓枠、側面表示器、号車表記を追加
 * - 既存駅データの platformLengthM を参照し、ホーム長・設備配置を生成
 * - 階段をホーム長手方向と平行にし、車端寄りドアへ乗降列を形成
 */
(() => {
  const canvas = document.getElementById("boardingCanvas");
  const host = document.getElementById("doorScene");
  if (!canvas || !host || typeof THREE === "undefined") return;

  const stationId = host.dataset.stationId || "asahigaoka";
  const stationConfig = window.ATC_BOARDING_SCENE_SYSTEM.getConfig(stationId);
  const platformLayout = window.ATC_BOARDING_SCENE_SYSTEM.getLayout(stationId);
  const platformLengthM = stationConfig.platformLengthM;
  const platformWidthM = stationConfig.platformWidthM;
  const platformSceneLength = platformLayout.sceneLength;
  const platformSceneWidth = platformLayout.sceneWidth;
  const stationWorld = platformLayout.world || window.StationWorldSpec.resolve(stationId);
  const vertical = window.TrainVerticalDimensions;
  const stationVertical = window.StationVerticalLayout;
  if (!vertical || !stationVertical) throw new Error("Station vertical specs are not loaded.");
  // 世界座標はレール頭頂面Y=0で統一。ホーム・車両・乗客は全て同じ基準から配置する。
  const platformTopY = stationVertical.platformTopY;
  const stationRailTopY = stationVertical.railTopY;
  const platformSlabCenterY = stationVertical.platformSlabCenterY;
  const trainOriginY = stationVertical.trainOriginY;
  const legacyY = stationVertical.fromLegacyPlatformSceneY;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa9d3e8);
  scene.fog = new THREE.Fog(0xa9d3e8, 48, 150);

  // Pattern A: platform exterior, high diagonal view.
  // The camera is placed above and behind the platform so the roof no longer
  // masks the train doors, passenger flow, or the descending staircase.
  const cameraSpec = window.ATC_resolveBoardingCamera(stationConfig, platformLayout, THREE);
  const camera = new THREE.PerspectiveCamera(cameraSpec.fov, 16 / 6, 0.1, 240);
  const boardingCameraBase = cameraSpec.position.clone();
  const boardingCameraTarget = cameraSpec.target.clone();
  boardingCameraBase.y += stationVertical.legacyShiftY;
  boardingCameraTarget.y += stationVertical.legacyShiftY;
  camera.position.copy(boardingCameraBase);
  camera.lookAt(boardingCameraTarget);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = Boolean(window.__ATC_PERFORMANCE__?.boardingShadows);
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(window.__ATC_PERFORMANCE__?.pixelRatio || 1);

  scene.add(new THREE.HemisphereLight(0xf2fbff, 0x596655, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.45);
  sun.position.set(24, 34, 18);
  sun.castShadow = Boolean(window.__ATC_PERFORMANCE__?.boardingShadows);
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -48;
  sun.shadow.camera.right = 48;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -30;
  scene.add(sun);

  const mat = (color, roughness = 0.72, metalness = 0.04) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });

  const materials = {
    concrete: mat(0xbcc4c8, 0.95),
    concreteDark: mat(0x77848a, 0.98),
    yellow: mat(0xe9c82e, 0.82),
    steel: mat(0x89959b, 0.35, 0.66),
    steelDark: mat(0x333e44, 0.42, 0.52),
    sleeper: mat(0x403932, 0.97),
    ballast: mat(0x5d5954, 1),
    roof: mat(0x66757b, 0.62, 0.2),
    column: mat(0x5f6f75, 0.55, 0.28),
    bodyWhite: mat(0xf7f9fa, 0.38, 0.0),
    white: mat(0xf7f9fa, 0.38, 0.0),
    whiteSide: mat(0xe9eef0, 0.46, 0.0),
    blue: mat(0x1767ae, 0.33, 0.13),
    glass: new THREE.MeshStandardMaterial({ color: 0x14394e, roughness: 0.08, metalness: 0.36 }),
    black: mat(0x151b1f, 0.72),
    rubber: mat(0x24282a, 0.93),
    warmLight: new THREE.MeshStandardMaterial({ color: 0xffd994, emissive: 0xffa332, emissiveIntensity: 0.85, roughness: 0.7 })
  };

  function addBox(w, h, d, material, x, y, z, parent = scene, cast = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function addCylinder(radius, height, material, x, y, z, parent = scene, rotationZ = 0) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 14), material);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rotationZ;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function makeTextPlane(text, width, height, options = {}) {
    const c = document.createElement("canvas");
    c.width = options.canvasWidth || 768;
    c.height = options.canvasHeight || 220;
    const ctx = c.getContext("2d");
    ctx.fillStyle = options.background || "#0e171d";
    ctx.fillRect(0, 0, c.width, c.height);
    if (options.topLine) {
      ctx.fillStyle = options.topLine;
      ctx.fillRect(0, 0, c.width, Math.max(16, c.height * 0.12));
    }
    ctx.fillStyle = options.color || "#f4f8fa";
    ctx.font = options.font || "700 72px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, c.width / 2, c.height * 0.54);
    if (options.subtext) {
      ctx.fillStyle = options.subColor || "#7ef08f";
      ctx.font = options.subFont || "600 34px sans-serif";
      ctx.fillText(options.subtext, c.width / 2, c.height * 0.82);
    }
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: texture, transparent: false })
    );
  }

  function createTrack(z, length = platformSceneLength + 4) {
    addBox(length, 0.2, 4.3, materials.ballast, 0, stationRailTopY - 0.32, z);
    for (let x = -length / 2 + 0.6; x <= length / 2 - 0.6; x += 1.05) {
      addBox(0.24, 0.15, 3.78, materials.sleeper, x, stationRailTopY - 0.18, z);
    }
    addBox(length, 0.14, 0.15, materials.steel, 0, stationRailTopY - 0.07, z - (window.TrainReferenceSpec?.rail.gauge || 1.435) / 2);
    addBox(length, 0.14, 0.15, materials.steel, 0, stationRailTopY - 0.07, z + (window.TrainReferenceSpec?.rail.gauge || 1.435) / 2);
  }

  function createDownStaircase(parent, centerX, centerZ) {
    const stair = new THREE.Group();
    parent.add(stair);

    // ホーム長手方向（X軸）へ下る、目で見て分かる階段室。
    const stairWidth = 3.15;
    const stepCount = 18;
    const stepDepth = 0.39;
    const stepHeight = 0.18;
    const runLength = stepCount * stepDepth;
    const upperX = centerX - runLength / 2;
    const lowerY = platformTopY - stepCount * stepHeight;

    // 開口縁・側壁。プラットホーム床は createPlatform 側で分割し、穴を実際に空ける。
    addBox(runLength + 1.25, 0.42, 0.22, materials.concreteDark, centerX, legacyY(-0.08), centerZ - stairWidth / 2 - 0.12, stair);
    addBox(runLength + 1.25, 0.42, 0.22, materials.concreteDark, centerX, legacyY(-0.08), centerZ + stairWidth / 2 + 0.12, stair);
    addBox(0.22, 0.42, stairWidth + 0.45, materials.concreteDark, upperX - 0.44, legacyY(-0.08), centerZ, stair);

    // 下層まで続く壁面。
    addBox(runLength + 1.0, 3.65, 0.18, materials.concreteDark, centerX, legacyY(-1.72), centerZ - stairWidth / 2 - 0.16, stair);
    addBox(runLength + 1.0, 3.65, 0.18, materials.concreteDark, centerX, legacyY(-1.72), centerZ + stairWidth / 2 + 0.16, stair);
    addBox(0.18, 3.65, stairWidth + 0.35, materials.concreteDark, upperX - 0.35, legacyY(-1.72), centerZ, stair);

    for (let i = 0; i < stepCount; i += 1) {
      const y = platformTopY + 0.02 - i * stepHeight - stepHeight / 2;
      const x = upperX + i * stepDepth + stepDepth / 2;
      const step = addBox(stepDepth, stepHeight, stairWidth, materials.concrete, x, y, centerZ, stair);
      // 段鼻を黄色で強調し、遠目でも階段だと判別できるようにする。
      addBox(0.055, 0.035, stairWidth - 0.12, materials.yellow, x - stepDepth / 2 + 0.035, y + stepHeight / 2 + 0.02, centerZ, stair, false);
    }

    const lowerX = upperX + runLength + 2.35;
    addBox(5.4, 0.24, 6.0, materials.concrete, lowerX, lowerY - 0.14, centerZ, stair);
    addBox(0.42, 0.08, 5.6, materials.yellow, upperX + runLength + 0.55, lowerY + 0.03, centerZ, stair, false);

    // 両側の手すり。傾斜に合わせて一本のレールとして見せる。
    const incline = Math.atan2(stepCount * stepHeight, runLength);
    for (const side of [-1, 1]) {
      const railZ = centerZ + side * (stairWidth / 2 - 0.18);
      const rail = addBox(runLength + 0.35, 0.075, 0.075, materials.steel, centerX, legacyY(-1.02), railZ, stair);
      rail.rotation.z = -incline;
      for (let i = 0; i <= 7; i += 1) {
        const t = i / 7;
        addBox(0.07, 1.0, 0.07, materials.steel, upperX + t * runLength, platformTopY + 0.52 - t * stepCount * stepHeight, railZ, stair);
      }
    }

    // ホーム開口部を囲む転落防止柵。階段入口側だけを開け、残り3辺を連続して囲う。
    const fenceHeight = 1.18;
    const fenceY = platformTopY + 0.62;
    const fenceMat = materials.steel;
    const longRailLength = runLength + 1.05;
    for (const side of [-1, 1]) {
      const z = centerZ + side * (stairWidth / 2 + 0.22);
      addBox(longRailLength, 0.075, 0.075, fenceMat, centerX, fenceY + 0.48, z, stair);
      addBox(longRailLength, 0.055, 0.055, fenceMat, centerX, fenceY + 0.02, z, stair);
      for (let i = 0; i <= 10; i += 1) {
        const x = centerX - longRailLength / 2 + (longRailLength * i) / 10;
        addBox(0.055, fenceHeight, 0.055, fenceMat, x, fenceY, z, stair);
      }
    }
    // 下り方向の奥端を閉じる柵。入口側は人が入れるよう開放。
    const endX = upperX + runLength + 0.48;
    addBox(0.075, 0.075, stairWidth + 0.52, fenceMat, endX, fenceY + 0.48, centerZ, stair);
    addBox(0.055, 0.055, stairWidth + 0.52, fenceMat, endX, fenceY + 0.02, centerZ, stair);
    for (let i = 0; i <= 6; i += 1) {
      const z = centerZ - (stairWidth + 0.52) / 2 + ((stairWidth + 0.52) * i) / 6;
      addBox(0.055, fenceHeight, 0.055, fenceMat, endX, fenceY, z, stair);
    }

    const sign = makeTextPlane("出口・改札 ↓", 3.25, 0.78, {
      background: "#10171b",
      color: "#ffd53d",
      font: "700 70px sans-serif"
    });
    sign.position.set(upperX - 0.12, legacyY(2.15), centerZ - stairWidth / 2 - 0.25);
    sign.rotation.y = Math.PI / 2;
    stair.add(sign);

    const entranceX = upperX - 0.72;
    const outsideZ = centerZ - stairWidth / 2 - 0.72;
    return {
      centerX,
      openingLength: runLength + 1.25,
      openingWidth: stairWidth + 0.5,
      // 柵を横切らず、入口側の開口から回り込むための経路点。
      approach: new THREE.Vector3(entranceX - 1.25, platformTopY, outsideZ),
      gate: new THREE.Vector3(entranceX, platformTopY, outsideZ),
      entry: new THREE.Vector3(entranceX, platformTopY, centerZ),
      top: new THREE.Vector3(upperX + 0.18, platformTopY, centerZ),
      lower: new THREE.Vector3(upperX + runLength - 0.15, lowerY, centerZ),
      exit: new THREE.Vector3(lowerX + 2.1, lowerY, centerZ + 1.35)
    };
  }

  function createPlatform(centerZ, stationName, withStairs) {
    const group = new THREE.Group();
    scene.add(group);

    const stairCenterX = platformLayout.stairCenterX;
    const stairCenterZ = centerZ + (platformLayout.stairCenterZ - platformLayout.centerZ);
    const openingLength = platformLayout.stairOpeningLength;
    const openingWidth = platformLayout.stairOpeningWidth;

    if (withStairs) {
      // 階段部分を一枚床で塞がず、四つの床メッシュに分けて本物の開口を作る。
      const leftLength = platformSceneLength / 2 + stairCenterX - openingLength / 2;
      const rightLength = platformSceneLength / 2 - stairCenterX - openingLength / 2;
      addBox(leftLength, 0.5, platformSceneWidth, materials.concrete,
        -platformSceneLength / 2 + leftLength / 2, platformSlabCenterY, centerZ, group);
      addBox(rightLength, 0.5, platformSceneWidth, materials.concrete,
        stairCenterX + openingLength / 2 + rightLength / 2, platformSlabCenterY, centerZ, group);

      const frontDepth = platformSceneWidth / 2 + (stairCenterZ - centerZ) - openingWidth / 2;
      const rearDepth = platformSceneWidth / 2 - (stairCenterZ - centerZ) - openingWidth / 2;
      addBox(openingLength, 0.5, frontDepth, materials.concrete,
        stairCenterX, platformSlabCenterY, centerZ - platformSceneWidth / 2 + frontDepth / 2, group);
      addBox(openingLength, 0.5, rearDepth, materials.concrete,
        stairCenterX, platformSlabCenterY, stairCenterZ + openingWidth / 2 + rearDepth / 2, group);
    } else {
      addBox(platformSceneLength, 0.5, platformSceneWidth, materials.concrete, 0, platformSlabCenterY, centerZ, group);
    }

    addBox(platformSceneLength, 1.18, 0.24, materials.concreteDark, 0, legacyY(-0.53), centerZ - platformSceneWidth / 2, group);
    addBox(platformSceneLength, 0.72, 0.18, materials.concreteDark, 0, legacyY(-0.3), centerZ + platformSceneWidth / 2, group);
    addBox(platformSceneLength, 0.065, 0.32, materials.yellow, 0, platformTopY + 0.035, centerZ - platformSceneWidth / 2 + 0.48, group);
    addBox(platformSceneLength, 0.065, 0.32, materials.yellow, 0, platformTopY + 0.035, centerZ + platformSceneWidth / 2 - 0.48, group);

    const canopyZ = centerZ + (platformLayout.canopyZ - platformLayout.centerZ);
    addBox(platformLayout.canopyLength, 0.13, platformLayout.canopyWidth, materials.roof, 1.5, legacyY(platformLayout.canopyHeight), canopyZ, group);
    for (let x = -22; x <= 25; x += 6.7) {
      // 階段開口の真上には柱を置かない。
      if (withStairs && Math.abs(x - stairCenterX) < openingLength * 0.62) continue;
      addBox(0.18, platformLayout.canopyHeight, 0.18, materials.column, x, legacyY(platformLayout.canopyHeight / 2), canopyZ, group);
      addBox(1.15, 0.07, 0.13, materials.warmLight, x + 2.3, legacyY(platformLayout.canopyHeight - 0.17), canopyZ - 0.16, group, false);
    }

    for (const x of [-21, 10]) {
      addBox(3.1, 0.17, 0.78, mat(0x365f77, 0.72), x, legacyY(0.64), centerZ, group);
      addBox(0.17, 0.68, 0.68, materials.steel, x - 1.2, legacyY(0.33), centerZ, group);
      addBox(0.17, 0.68, 0.68, materials.steel, x + 1.2, legacyY(0.33), centerZ, group);
    }
    addBox(1.15, 2.15, 0.72, mat(0xf4f7f8, 0.48, 0.12), -25, legacyY(1.08), centerZ + 0.4, group);
    addBox(0.86, 0.62, 0.04, materials.glass, -25, legacyY(1.52), centerZ + 0.78, group, false);
    addBox(0.75, 1.0, 0.68, mat(0x375d72, 0.65), -23.6, legacyY(0.5), centerZ + 0.4, group);

    const stationSign = makeTextPlane(stationName, 5.8, 1.35, {
      background: "#f8fbfc",
      color: "#13232e",
      topLine: "#125da5",
      font: "700 68px sans-serif"
    });
    stationSign.position.set(1.4, legacyY(3.72), centerZ + 0.24);
    stationSign.rotation.y = Math.PI;
    group.add(stationSign);

    const trackSign = makeTextPlane("1・2番線", 2.35, 0.75, {
      background: "#11191e",
      color: "#f5f7f8",
      font: "700 72px sans-serif"
    });
    trackSign.position.set(-7.2, legacyY(4.55), centerZ - 0.1);
    trackSign.rotation.y = Math.PI;
    group.add(trackSign);

    const stairs = withStairs ? createDownStaircase(group, stairCenterX, stairCenterZ) : null;
    return { group, stairs };
  }

  // 共通WorldSpecから4線・2面の同じ設計図を描画する。
  const activeTrackZ = stationWorld.operatingTrackCenterZ;
  stationWorld.trackCenters.forEach(z => createTrack(z));
  const activePlatform = createPlatform(stationWorld.platformCenters[stationWorld.activePlatformIndex], stationConfig.name, true);
  stationWorld.platformCenters.forEach((centerZ, index) => {
    if (index !== stationWorld.activePlatformIndex) createPlatform(centerZ, stationConfig.name, false);
  });

  // 駅高架床はレールより下へ置く。旧来の巨大な一枚床が本線を覆う構造は廃止。
  const stationStructure = window.StationStructureSpec.resolve(stationConfig.id || "asahigaoka");
  const deckTopY = stationRailTopY - stationStructure.deck.topBelowRail;
  const deckCenterY = deckTopY - stationStructure.deck.thickness / 2;
  addBox(88, stationStructure.deck.thickness, stationStructure.deck.width,
    mat(0x80898d, 0.96), 0, deckCenterY, stationStructure.deck.centerZ);
  for (let x = -36; x <= 36; x += 12) {
    for (const z of stationWorld.platformCenters) {
      addBox(1.4, 9.5, 1.4, mat(0x737d81, 0.96), x, legacyY(-5.7), z);
    }
  }
  addBox(96, 0.3, 38, mat(0x697c58, 1), 0, legacyY(-10.0), 30);
  addBox(96, 0.12, 5.5, mat(0x4f5559, 0.98), 0, legacyY(-9.75), 27.5);
  for (let x = -44; x <= 44; x += 5.5) {
    addBox(2.8, 2.0 + (Math.abs(x) % 4) * 0.6, 3.4, mat(0xd7d1c5, 0.93), x, legacyY(-8.8), 38 + (Math.abs(x) % 3));
  }

  function createTrain() {
    if (!window.TrainRenderAdapter) throw new Error("TrainRenderAdapter is not loaded.");
    const instance = window.TrainRenderAdapter.forStation({
      THREE,
      axis: "x",
      direction: 1,
      doorsOpen: 0,
      platformSide: 1,
      detailLevel: "full"
    });
    const model = instance.model;
    const train = instance.group;
    // 右側の先頭車を従来とほぼ同じ位置に置き、残り3両はホーム左奥へ伸ばす。
    const leadCenterX=25.8;
    window.TrainPlacement.placeStatic(train, { x: leadCenterX, y: trainOriginY, z: activeTrackZ });
    scene.add(train);
    const doorPanels=model.doors
      .filter(d => d.side===1)
      .map(d => {
        const car=d.panel.parent;
        const carLong=car.position.x;
        return {
          panel:d.panel,
          localCenter:d.localCenter,
          direction:d.direction,
          slideDistance:d.slideDistance,
          closedZ:d.closedLateral,
          pocketZ:d.pocketLateral,
          center:leadCenterX+carLong+d.localCenter
        };
      });
    const allDoorCenters=doorPanels.map(d=>d.center);
    // カメラ付近の2扉を実際の乗降対象にする。
    const activeDoorCenters=allDoorCenters.filter(x=>x>-22&&x<10).slice(0,2);
    return {car:train,doorCenters:activeDoorCenters,allDoorCenters,doorPanels,model,instance};
  }

  const trainModel = createTrain();
  const activeSafeZone = stationWorld.safeZones[stationWorld.activePlatformIndex];
  const platformDirection = Math.sign(stationWorld.activePlatformCenterZ - activeTrackZ) || 1;
  const bodyHalfWidth = (window.TrainReferenceSpec?.body?.width || 3.36) / 2;
  const doorThresholdZ = activeTrackZ + platformDirection * bodyHalfWidth;

  function createPerson(index, role) {
    const group = new THREE.Group();
    const shirtColors = [0x315f87, 0x975363, 0x4b765a, 0x8e6b3d, 0x625681, 0x4b7077, 0xa9653c, 0x34404a];
    const skinColors = [0xd9aa82, 0xc78f68, 0xe4ba93];
    const skin = mat(skinColors[index % skinColors.length], 0.92);
    const clothes = mat(shirtColors[index % shirtColors.length], 0.86);
    const trousers = mat(index % 4 === 0 ? 0x5d4a3b : 0x26313a, 0.93);
    const hair = mat([0x211b19, 0x3b2a22, 0x171719][index % 3], 0.96);

    const scale = 0.9 + (index % 5) * 0.035;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), skin);
    head.position.y = 1.62;
    group.add(head);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.185, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.48), hair);
    hairCap.position.y = 1.68;
    group.add(hairCap);

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.56, 4, 8), clothes);
    torso.position.y = 1.03;
    group.add(torso);

    const arms = [];
    for (const sx of [-0.27, 0.27]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.48, 3, 6), clothes);
      arm.position.set(sx, 1.03, 0);
      arm.rotation.z = sx < 0 ? -0.08 : 0.08;
      group.add(arm);
      arms.push(arm);
    }

    const legs = [];
    for (const sx of [-0.11, 0.11]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.068, 0.48, 3, 6), trousers);
      leg.position.set(sx, 0.38, 0);
      group.add(leg);
      legs.push(leg);
    }

    if (index % 3 === 0) {
      addBox(0.28, 0.42, 0.16, mat(0x29333a, 0.92), 0.31, 0.8, -0.02, group);
    } else if (index % 5 === 0) {
      addBox(0.22, 0.42, 0.18, mat(0x72513a, 0.9), -0.3, 0.82, 0, group);
    }

    group.scale.setScalar(scale);
    group.traverse(o => { if (o.isMesh) o.castShadow = true; });
    group.userData = { role, index, legs, arms, scale };
    scene.add(group);
    return group;
  }

  const passengers = [];
  const boardingConfig = stationConfig.boarding || {};
  const roles = [
    ...Array(Number(boardingConfig.alightCount ?? 9)).fill("alight"),
    ...Array(Number(boardingConfig.boardCount ?? 12)).fill("board"),
    ...Array(Number(boardingConfig.remainCount ?? 8)).fill("remain")
  ];
  roles.forEach((role, i) => passengers.push(createPerson(i, role)));

  function setupPassenger(p) {
    const u = p.userData;
    const doorIndex = u.index % 2;
    const door = trainModel.doorCenters[doorIndex];
    const orderAtDoor = Math.floor(u.index / 2);
    u.door = door;
    u.doorIndex = doorIndex;
    u.orderAtDoor = orderAtDoor;
    // 速足でも走って見えない範囲へ減速。
    u.speed = [0.52, 0.60, 0.69, 0.78][u.index % 4];

    if (u.role === "alight") {
      const stairs = activePlatform.stairs;
      const laneOffset = ((u.index % 3) - 1) * 0.32;
      u.path = window.ATC_createAlightPath({
        THREE, doorX: door, laneOffset, doorThresholdZ, stairs, platformSafeZone: activeSafeZone,
        platformTopY, passengerFloorY: vertical.floorY
      });
      u.delay = 1.0 + orderAtDoor * 0.74 + doorIndex * 0.22;
      u.duration = 18.0 / u.speed;
    } else if (u.role === "board") {
      u.path = window.ATC_createBoardPath({
        THREE, doorX: door, doorIndex, orderAtDoor, doorThresholdZ, platformSafeZone: activeSafeZone,
        platformTopY, passengerFloorY: vertical.floorY
      });
      // Each door processes one person at a time. Next passenger starts only after predecessor clears the doorway.
      u.delay = 11.0 + orderAtDoor * 2.15 + doorIndex * 0.55;
      u.duration = 6.2 / u.speed;
    } else {
      const safe = stationWorld.safeZones[stationWorld.activePlatformIndex];
      const raw = { x: -18 + (u.index % 8) * 4.8, z: safe.centerZ + ((u.index % 2) ? 0.7 : -0.7) };
      const pos = window.PassengerZoneSpec.clampPoint(raw, safe, 0.15);
      u.path = [new THREE.Vector3(pos.x, platformTopY, pos.z)];
      u.delay = 0;
      u.duration = 1;
    }

    p.position.copy(u.path[0]);
    p.visible = true;
  }
  passengers.forEach(setupPassenger);

  // Static crowd on the opposite platform. WorldSpecの安全領域外には出さない。
  const oppositeCrowd = [];
  const oppositePlatformIndex = stationWorld.activePlatformIndex === 0 ? 1 : 0;
  const oppositeSafeZone = stationWorld.safeZones[oppositePlatformIndex];
  for (let i = 0; i < 14; i += 1) {
    const p = createPerson(i + 50, "opposite");
    p.scale.multiplyScalar(0.92);
    const raw = { x: -25 + i * 3.8, z: oppositeSafeZone.centerZ + ((i % 2) ? 0.72 : -0.72) };
    const pos = window.PassengerZoneSpec.clampPoint(raw, oppositeSafeZone, 0.15);
    p.position.set(pos.x, platformTopY, pos.z);
    p.rotation.y = Math.PI;
    oppositeCrowd.push(p);
  }

  function easeInOut(t) {
    const x = THREE.MathUtils.clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function moveAlongPath(p, rawProgress) {
    const path = p.userData.path;
    if (!path || path.length < 2) return;
    const progress = easeInOut(rawProgress);
    const scaled = progress * (path.length - 1);
    const segment = Math.min(path.length - 2, Math.floor(scaled));
    const local = scaled - segment;
    p.position.lerpVectors(path[segment], path[segment + 1], local);
    const target = path[segment + 1];
    p.rotation.y = Math.atan2(target.x - p.position.x, target.z - p.position.z);
  }

  function animateWalk(p, now, moving) {
    const { legs = [], arms = [], index = 0 } = p.userData;
    const speedFactor = THREE.MathUtils.clamp(Number(p.userData.speed || 0.65) / 0.72, 0.68, 1.05);
    const swing = moving ? Math.sin(now * 0.0047 * speedFactor + index) * 0.18 : 0;
    if (legs[0]) legs[0].rotation.x = swing;
    if (legs[1]) legs[1].rotation.x = -swing;
    if (arms[0]) arms[0].rotation.x = -swing * 0.75;
    if (arms[1]) arms[1].rotation.x = swing * 0.75;
    if (moving && p.position.y > platformTopY - 0.5) p.position.y += Math.abs(Math.sin(now * 0.0045 * speedFactor + index)) * 0.008;
  }

  let lastPhase = "";
  let boardingStart = performance.now();
  function getState() {
    return window.__SHINKANSEN_TEST__?.getState?.() || {
      stationPhase: "",
      doorOpenRatio: 0,
      doorsClosed: true
    };
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width));
    const h = Math.max(2, Math.round(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function resetPassengers() {
    passengers.forEach(setupPassenger);
  }

  function updatePassengers(now, state) {
    const phase = state.stationPhase || "";
    if (phase !== lastPhase) {
      if (phase === "BOARDING" || phase === "ARRIVAL_OPEN") {
        boardingStart = now;
        resetPassengers();
      }
      lastPhase = phase;
    }

    const active = (phase === "BOARDING" || phase === "ARRIVAL_OPEN") && state.doorOpenRatio > 0.72;
    const elapsed = Math.max(0, (now - boardingStart) / 1000);
    const finished = !active && /BUZZER_DONE|READY_TO_DEPART|DOOR_CLOSING/.test(phase);

    passengers.forEach(p => {
      const u = p.userData;
      if (u.role === "remain") {
        p.position.copy(u.path[0]);
        p.visible = true;
        p.rotation.y = Math.PI + Math.sin(now * 0.00035 + u.index) * 0.18;
        animateWalk(p, now, false);
        return;
      }

      if (!active && !finished) {
        p.position.copy(u.path[0]);
        p.visible = true;
        animateWalk(p, now, false);
        return;
      }

      const progress = (elapsed - u.delay) / u.duration;
      if (progress < 0) {
        p.position.copy(u.path[0]);
        p.visible = active;
        animateWalk(p, now, false);
        return;
      }

      if (progress >= 1 || finished) {
        p.position.copy(u.path[u.path.length - 1]);
        p.visible = u.role === "alight" && !finished;
        animateWalk(p, now, false);
        return;
      }

      p.visible = true;
      moveAlongPath(p, progress);
      animateWalk(p, now, true);
    });
  }

  let lastBoardingFrameTime = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (host.classList.contains("hidden")) return;
    const interval = window.__ATC_PERFORMANCE__?.frameIntervalMs || (1000 / 60);
    if (lastBoardingFrameTime && now - lastBoardingFrameTime < interval) return;
    lastBoardingFrameTime = now - ((now - lastBoardingFrameTime) % interval);
    resize();
    const state = getState();
    const open = THREE.MathUtils.clamp(Number(state.doorOpenRatio) || 0, 0, 1);
    trainModel.doorPanels.forEach(({ panel, localCenter, direction, slideDistance, closedZ, pocketZ }) => {
      // 横移動と同時に車体内側へ引き込み、戸袋外板の裏へ完全に収納する。
      const easedOpen = open * open * (3 - 2 * open);
      panel.position.x = localCenter + direction * easedOpen * slideDistance;
      panel.position.z = THREE.MathUtils.lerp(closedZ, pocketZ, easedOpen);
    });
    updatePassengers(now, state);

    // Subtle cinematic drift while preserving the Pattern A composition.
    camera.position.set(
      boardingCameraBase.x + Math.sin(now * 0.00011) * cameraSpec.driftM,
      boardingCameraBase.y + Math.sin(now * 0.00007) * cameraSpec.driftM * 0.22,
      boardingCameraBase.z + Math.sin(now * 0.00009) * cameraSpec.driftM * 0.55
    );
    camera.lookAt(boardingCameraTarget);
    renderer.render(scene, camera);
  }

  window.addEventListener("resize", resize, { passive: true });
  resize();
  requestAnimationFrame(frame);
  window.__SHINKANSEN_BOARDING_3D__ = {
    scene,
    camera,
    renderer,
    passengers,
    oppositeCrowd,
    doorPanels: trainModel.doorPanels,
    stairs: activePlatform.stairs,
    version: "v74.3.4-alpha12-performance-profiles",
    stationId,
    stationConfig,
    platformLayout
  };
})();
