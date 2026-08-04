(() => {
  const button=document.getElementById("performanceMonitorButton");
  const panel=document.getElementById("performanceMonitor");
  const close=document.getElementById("performanceMonitorClose");
  const grid=document.getElementById("performanceMonitorGrid");
  if(!button||!panel||!grid)return;

  let timer=0;
  const fmt=(v,d=1)=>Number.isFinite(v)?Number(v).toFixed(d):"—";
  const integer=v=>Number.isFinite(v)?Math.round(v).toLocaleString("ja-JP"):"—";
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const severity=(v,w,b)=>v>=b?"bad":v>=w?"warn":"";
  const row=(name,value,cls="",title="")=>`<div class="performance-row"><span title="${esc(title||name)}">${esc(name)}</span><output class="${cls}" title="${esc(String(value))}">${value}</output></div>`;
  const card=(title,rows)=>`<section class="performance-card"><h3>${esc(title)}</h3>${rows.join("")}</section>`;
  const ranking=(list,limit=8)=>{
    if(!list?.length)return [row("状態","該当なし")];
    return list.slice(0,limit).map(([label,v],i)=>row(`${i+1}. ${label}`,`${integer(v.meshes)} mesh / ${integer(v.instances)} inst`,severity(v.instances,18000,40000),label));
  };

  function sample(){
    if(panel.hidden)return;
    const s=window.__SHINKANSEN_PERF_SNAPSHOT__?.()||{};
    const budget=1000/(s.targetFps||30);
    const drop=s.executedFrames?100*s.droppedBudgetFrames/s.executedFrames:0;
    const topStructure=s.structureRanking?.[0];
    const topPurpose=s.purposeRanking?.[0];
    const topChunk=s.activeChunkRanking?.[0];

    grid.innerHTML=[
      card("処理状況",[
        row("Frame / P95",`${fmt(s.frameMs,1)} / ${fmt(s.frameP95Ms,1)} ms`,severity(s.frameP95Ms,budget*.85,budget)),
        row("最大 / 超過率",`${fmt(s.framePeakMs,1)} ms / ${fmt(drop,1)}%`,severity(drop,2,8)),
        row("Physics / 1step",`${fmt(s.physicsMs,1)} / ${fmt(s.physicsPerStepMs,2)} ms`,severity(s.physicsPerStepMs,1.5,3)),
        row("steps / Backlog",`${integer(s.physicsSteps)} / ${fmt(s.physicsBacklogMs,1)} ms`,severity(s.physicsBacklogMs,50,200)),
        row("Render / Calls",`${fmt(s.renderMs,1)} ms / ${integer(s.drawCalls)}`,severity(s.drawCalls,900,1400)),
        row("速度 / 距離",`${fmt(s.speedKmh,1)} km/h / ${fmt((s.distanceM||0)/1000,2)} km`)
      ]),
      card("構造タイプ別",ranking(s.structureRanking,8)),
      card("自動判定",[
        row("最多構造",topStructure?topStructure[0]:"—",topStructure?severity(topStructure[1].instances,18000,40000):""),
        row("最多用途",topPurpose?topPurpose[0]:"—",topPurpose?severity(topPurpose[1].instances,18000,40000):""),
        row("最重量チャンク",topChunk?topChunk[0]:"—",topChunk?severity(topChunk[1].instances,10000,25000):""),
        row("表示合計",`${integer(s.visibleInstancedMeshes)} mesh / ${integer(s.visibleInstances)} inst`,severity(s.visibleInstances,50000,75000)),
        row("チャンク内",`${integer(s.chunkInstancedMeshes)} mesh / ${integer(s.chunkInstances)} inst`,severity(s.chunkInstances,35000,60000)),
        row("Build",s.build||"—"),
        row("リセット",'<button id="performanceResetButton" class="performance-reset">リセット</button>')
      ]),
      card("RouteStrip用途別",ranking(s.purposeRanking,9)),
      card("表示中チャンク別",ranking(s.activeChunkRanking,9)),
      card("生成元参考",ranking(s.ownerRanking,9))
    ].join("");
    document.getElementById("performanceResetButton")?.addEventListener("click",()=>{window.__SHINKANSEN_PERF_RESET__?.();sample();});
  }

  function setOpen(open){
    panel.hidden=!open;
    panel.setAttribute("aria-hidden",String(!open));
    button.setAttribute("aria-pressed",String(open));
    button.textContent=open?"性能モニターを閉じる":"性能モニター";
    clearInterval(timer);
    if(open){window.__SHINKANSEN_PERF_RESET__?.();sample();timer=setInterval(sample,500);}
  }
  button.addEventListener("click",()=>setOpen(panel.hidden));
  close.addEventListener("click",()=>setOpen(false));
  document.addEventListener("keydown",e=>{if(e.key==="F2"){e.preventDefault();setOpen(panel.hidden);}});
})();
