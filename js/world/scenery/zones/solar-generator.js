"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones
  .filter(z=>z.biome==="solar")
  .forEach(z=>ctx.addSolarZone(ctx.parent,z.startM,z.endM,z.density,z.variant)));
