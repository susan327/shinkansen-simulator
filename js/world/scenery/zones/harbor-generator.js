"use strict";
ATCSceneryEngine.register(ctx=>ctx.zones
  .filter(z=>z.biome==="harbor")
  .forEach(z=>ctx.addHarborZone(ctx.parent,z.startM,z.endM,z.density,z.variant)));
