"use strict";

/** 景色生成の登録窓口。個別ジェネレーターを後から追加しやすくする。 */
window.ATCSceneryEngine = (() => {
  const generators = [];
  return Object.freeze({
    register(generator) { if (typeof generator === "function") generators.push(generator); },
    build(context) { generators.forEach(generator => generator(context)); },
    get generatorCount() { return generators.length; }
  });
})();
