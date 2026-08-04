"use strict";
/** v74.3.3-alpha11 stage1: UI表示・イベントだけを担当。状態所有はTrainDesignStoreへ委譲。 */
(() => {
  class TrainBodyDesigner{
    constructor(viewer){
      this.viewer=viewer; this.spec=window.TrainDesignerSpec; this.store=window.TrainDesignStore;
      this.root=document.getElementById("designerControls"); this.canvas=document.getElementById("sectionCanvas"); this.warning=document.getElementById("designWarnings"); this.timer=0;
      this.build(); this.bindActions(); this.draw();
    }
    format(value,unit){ if(unit==="%")return `${Math.round(value*100)}%`; return `${Number(value).toFixed(2)} ${unit}`; }
    build(){
      const state=this.store.snapshot();
      this.root.innerHTML=this.spec.controls.map(item=>`<label class="design-control"><span>${item.label}<output data-output="${item.key}">${this.format(state[item.key],item.unit)}</output></span><input data-design="${item.key}" data-unit="${item.unit}" type="range" min="${item.min}" max="${item.max}" step="${item.step}" value="${state[item.key]}"></label>`).join("");
      this.root.querySelectorAll("input[data-design]").forEach(input=>input.addEventListener("input",()=>{
        const key=input.dataset.design; this.store.set(key,Number(input.value),"designer-input");
        this.root.querySelector(`[data-output="${key}"]`).textContent=this.format(Number(input.value),input.dataset.unit);
        clearTimeout(this.timer); this.timer=setTimeout(()=>this.apply(),55);
      }));
    }
    apply(){ window.refreshTrainExteriorSpec(); this.viewer.load(this.viewer.mode,{preserveCamera:true}); this.draw(); }
    bindActions(){
      document.getElementById("resetDesign").addEventListener("click",()=>{this.store.reset();this.build();this.apply();});
      document.getElementById("copyDesign").addEventListener("click",async()=>{const text=JSON.stringify(this.store.exportObject(),null,2);try{await navigator.clipboard.writeText(text);this.flash("JSONをコピーしたよ");}catch{this.download("train-exterior-design.json",text);}});
      document.getElementById("downloadDesign").addEventListener("click",()=>this.download("train-exterior-design.json",JSON.stringify(this.store.exportObject(),null,2)));
      const file=document.getElementById("importDesign");
      file.addEventListener("change",async()=>{const f=file.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());this.store.replace(data,"json-import");this.build();this.apply();this.flash("設計JSONを読み込んだよ");}catch{this.flash("JSONを読み込めなかった");}file.value="";});
    }
    download(name,text){const blob=new Blob([text],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);}
    flash(text){this.warning.textContent=text;setTimeout(()=>this.draw(),1400);}
    validate(){
      const s=this.store.snapshot(),w=[];
      if(s.bellyTopY<s.skirtTopY-.35)w.push("⚠ 台車上カバーが低く、隙間が見える可能性");
      if(s.skirtBottomY>=s.skirtTopY-.25)w.push("⚠ スカート高さが不足");
      if(s.skirtBottomWidth>3)w.push("⚠ スカート底幅が広すぎる");
      if(s.noseShoulderHold<.34)w.push("⚠ ノーズが早く細くなりすぎる");
      if(s.noseTipWidthRatio<.16)w.push("⚠ 先端が細すぎて接続が不自然になる可能性");
      if(s.cabWindowPeakHalfWidth<s.cabWindowBaseHalfWidth)w.push("⚠ 運転窓中央幅が端幅より狭い");
      return w;
    }
    draw(){
      const c=this.canvas,ctx=c.getContext("2d"),dpr=Math.min(devicePixelRatio||1,2),rect=c.getBoundingClientRect();c.width=Math.max(320,rect.width*dpr);c.height=190*dpr;ctx.scale(dpr,dpr);const W=c.width/dpr,H=c.height/dpr;
      ctx.clearRect(0,0,W,H);ctx.fillStyle="#0d1721";ctx.fillRect(0,0,W,H);
      const s=this.store.snapshot(),cx=W/2,top=26,bottom=164,bodyHalf=72,bottomHalf=bodyHalf*(s.skirtBottomWidth/3.36);
      ctx.strokeStyle="#6bd6f5";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx-bodyHalf,top);ctx.lineTo(cx+bodyHalf,top);ctx.lineTo(cx+bodyHalf,78);ctx.quadraticCurveTo(cx+bodyHalf,96,cx+bottomHalf,bottom);ctx.lineTo(cx-bottomHalf,bottom);ctx.quadraticCurveTo(cx-bodyHalf,96,cx-bodyHalf,78);ctx.closePath();ctx.stroke();ctx.fillStyle="#e9f3f8";ctx.globalAlpha=.92;ctx.fill();ctx.globalAlpha=1;
      const skirtY=top+(bottom-top)*(1-(s.skirtTopY-s.skirtBottomY)/1.44);ctx.strokeStyle="#697680";ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(cx-bodyHalf+3,Math.max(82,skirtY));ctx.quadraticCurveTo(cx-bodyHalf+8,112,cx-bottomHalf,bottom-3);ctx.lineTo(cx+bottomHalf,bottom-3);ctx.quadraticCurveTo(cx+bodyHalf-8,112,cx+bodyHalf-3,Math.max(82,skirtY));ctx.stroke();
      ctx.fillStyle="#99afbd";ctx.font="12px system-ui";ctx.fillText("上幅 3.36m",12,18);ctx.fillText(`底幅 ${s.skirtBottomWidth.toFixed(2)}m`,12,H-10);
      const warnings=this.validate();this.warning.innerHTML=warnings.length?warnings.join("<br>"):"✓ 現在の設定は安全範囲内";this.warning.classList.toggle("ok",!warnings.length);
    }
  }
  window.TrainBodyDesigner=TrainBodyDesigner;
})();
