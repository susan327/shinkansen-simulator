"use strict";
/** v74.0.0-beta5: 全シーン・全編成で同じ材質インスタンスを共有する唯一の生成元。 */
(() => {
  const cache = new WeakMap();

  function createSet(THREE) {
    const body = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true, toneMapped: false });
    body.name = "UnifiedTrainBodyWhite_v74_beta5";
    return Object.freeze({
      bodyWhite: body,
      noseWhite: body,
      white: body,
      whiteSide: body,
      pillar: body,
      navy: new THREE.MeshStandardMaterial({ color: 0x173f67, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.04 }),
      aqua: new THREE.MeshStandardMaterial({ color: 0x48aeb8, roughness: 0.58, metalness: 0.0, envMapIntensity: 0.04 }),
      blue: new THREE.MeshStandardMaterial({ color: 0x173f67, roughness: 0.55, metalness: 0.0, envMapIntensity: 0.04 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x102a3b, roughness: 0.14, metalness: 0.04, transparent: true, opacity: 0.95, envMapIntensity: 0.18 }),
      steelDark: new THREE.MeshStandardMaterial({ color: 0x252a2e, roughness: 0.72, metalness: 0.22 }),
      equipment: new THREE.MeshStandardMaterial({ color: 0x565e63, roughness: 0.72, metalness: 0.18 }),
      skirtGray: new THREE.MeshStandardMaterial({ color: 0x8b9296, roughness: 0.82, metalness: 0.08, envMapIntensity: 0.03 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x121619, roughness: 0.96 }),
      seam: new THREE.MeshStandardMaterial({ color: 0x65727a, roughness: 0.68, metalness: 0.06 }),
      warmLight: new THREE.MeshBasicMaterial({ color: 0xfff0b8, toneMapped: false }),
      redLight: new THREE.MeshBasicMaterial({ color: 0xc51f2d, toneMapped: false })
    });
  }

  function create(THREE) {
    if (!THREE) throw new Error("TrainMaterials requires THREE.");
    if (!cache.has(THREE)) cache.set(THREE, createSet(THREE));
    return cache.get(THREE);
  }

  window.TrainMaterials = Object.freeze({ create });
})();
