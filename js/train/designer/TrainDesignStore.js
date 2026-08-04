"use strict";
/** v74.3.3-alpha11 stage1: GUI状態の唯一の所有者。外観生成側はsnapshotのみ参照する。 */
(() => {
  const spec = window.TrainDesignerSpec;
  if (!spec) throw new Error("TrainDesignerSpec must load before TrainDesignStore.");
  const listeners = new Set();
  let state = {...spec.defaults};
  const clamp=(value,item)=>Math.max(item.min,Math.min(item.max,Number(value)));
  function sanitize(source={}){
    const next={};
    for(const item of spec.controls){
      const raw=Number(source[item.key]);
      next[item.key]=Number.isFinite(raw)?clamp(raw,item):spec.defaults[item.key];
    }
    return next;
  }
  function snapshot(){ return Object.freeze({...state}); }
  function emit(reason="update"){
    const snap=snapshot();
    for(const listener of listeners) listener(snap,reason);
    window.dispatchEvent(new CustomEvent("train-design-change",{detail:{state:snap,reason}}));
    return snap;
  }
  function replace(source,reason="replace"){ state=sanitize(source); return emit(reason); }
  function patch(partial,reason="patch"){ state=sanitize({...state,...partial}); return emit(reason); }
  function set(key,value,reason="set"){
    const item=spec.byKey[key]; if(!item) return snapshot();
    state={...state,[key]:clamp(value,item)}; return emit(reason);
  }
  function reset(){ state={...spec.defaults}; return emit("reset"); }
  function exportObject(){ return {version:spec.version,...state}; }
  function subscribe(listener){ listeners.add(listener); return ()=>listeners.delete(listener); }
  window.TrainDesignStore=Object.freeze({snapshot,replace,patch,set,reset,exportObject,subscribe,sanitize});
  // 旧コード互換。直接代入は避け、新規コードはStore APIを使用する。
  Object.defineProperty(window,"TrainDesignerState",{configurable:true,get:()=>state,set:value=>{state=sanitize(value);}});
  window.TrainDesignerDefaults=spec.defaults;
})();
