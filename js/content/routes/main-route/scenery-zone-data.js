"use strict";

/**
 * v70.6 景観テーマ:
 * 「走っていて飽きない、バリエーションがある」
 * 1区間を長く引っ張らず、住宅・商業・田園・水辺・山・産業・海を
 * 路線の物語として順番に体験できる構成。
 */
window.ATC_SCENERY_ZONES=Object.freeze([
  Object.freeze({startM:0,     endM:3600,  biome:"urban",       density:1.65, variant:"departure-core"}),
  Object.freeze({startM:3600,  endM:6500,  biome:"commercial",  density:1.20, variant:"outer-city"}),
  Object.freeze({startM:6500,  endM:9300,  biome:"residential", density:1.15, variant:"dense-houses"}),
  Object.freeze({startM:9300,  endM:12000, biome:"residential", density:.78, variant:"park-school"}),
  Object.freeze({startM:12000, endM:15000, biome:"rural",       density:.95, variant:"rice-fields"}),
  Object.freeze({startM:15000, endM:17700, biome:"orchard",     density:.85, variant:"farm-village"}),
  Object.freeze({startM:17700, endM:20500, biome:"urban",       density:1.22, variant:"sakuranomae"}),
  Object.freeze({startM:20500, endM:22500, biome:"residential", density:.82, variant:"riverside-town"}),
  Object.freeze({startM:22500, endM:25500, biome:"river",       density:.55, variant:"wide-river"}),
  Object.freeze({startM:25500, endM:28200, biome:"hilly",       density:.88, variant:"hill-village"}),
  Object.freeze({startM:28200, endM:31000, biome:"commercial",  density:.92, variant:"aomine-gateway"}),
  Object.freeze({startM:31000, endM:33800, biome:"industrial",  density:1.08, variant:"light-industry"}),
  Object.freeze({startM:33800, endM:37800, biome:"mountain",    density:1.05, variant:"deep-forest"}),
  Object.freeze({startM:37800, endM:40500, biome:"solar",       density:.90, variant:"mountain-solar"}),
  Object.freeze({startM:40500, endM:43000, biome:"rural",       density:.82, variant:"open-fields"}),
  Object.freeze({startM:43000, endM:45500, biome:"highway",     density:.90, variant:"logistics-road"}),
  Object.freeze({startM:45500, endM:48500, biome:"industrial",  density:1.12, variant:"heavy-industry"}),
  Object.freeze({startM:48500, endM:50500, biome:"harbor",      density:1.05, variant:"port"}),
  Object.freeze({startM:50500, endM:52350, biome:"coast",       density:.88, variant:"terminal-coast"})
]);
