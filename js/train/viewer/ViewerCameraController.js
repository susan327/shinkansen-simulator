"use strict";
(() => {
  class ViewerCameraController {
    constructor({camera,domElement,target}){
      this.camera=camera; this.dom=domElement; this.target=target.clone();
      this.radius=48; this.theta=Math.PI*0.75; this.phi=Math.PI*0.32;
      this.dragging=false; this.last={x:0,y:0};
      this.bind(); this.update();
    }
    bind(){
      this.dom.addEventListener("pointerdown",e=>{this.dragging=true;this.last={x:e.clientX,y:e.clientY};this.dom.setPointerCapture(e.pointerId)});
      this.dom.addEventListener("pointermove",e=>{if(!this.dragging)return;const dx=e.clientX-this.last.x,dy=e.clientY-this.last.y;this.last={x:e.clientX,y:e.clientY};this.theta-=dx*0.006;this.phi=Math.max(0.08,Math.min(Math.PI*0.48,this.phi+dy*0.005));this.update()});
      this.dom.addEventListener("pointerup",()=>this.dragging=false);
      this.dom.addEventListener("pointercancel",()=>this.dragging=false);
      this.dom.addEventListener("wheel",e=>{e.preventDefault();this.radius=Math.max(7,Math.min(180,this.radius*Math.exp(e.deltaY*0.001)));this.update()},{passive:false});
    }
    captureState(){
      return {
        target:this.target.clone(),
        radius:this.radius,
        theta:this.theta,
        phi:this.phi
      };
    }
    restoreState(state){
      if(!state)return;
      if(state.target)this.target.copy(state.target);
      if(Number.isFinite(state.radius))this.radius=state.radius;
      if(Number.isFinite(state.theta))this.theta=state.theta;
      if(Number.isFinite(state.phi))this.phi=state.phi;
      this.update();
    }
    setTarget(x,y,z){this.target.set(x,y,z);this.update()}
    setView(name){
      const views={front:[0,Math.PI*0.16],side:[Math.PI/2,Math.PI*0.13],three:[Math.PI*0.73,Math.PI*0.23],rear:[Math.PI,Math.PI*0.16],top:[Math.PI/2,Math.PI*0.47],low:[Math.PI*0.72,Math.PI*0.055]};
      const v=views[name]||views.three;this.theta=v[0];this.phi=v[1];this.update();
    }
    frame(radius){this.radius=Math.max(9,radius);this.update()}
    update(){
      const cp=Math.cos(this.phi),sp=Math.sin(this.phi);
      this.camera.position.set(this.target.x+this.radius*cp*Math.cos(this.theta),this.target.y+this.radius*sp,this.target.z+this.radius*cp*Math.sin(this.theta));
      this.camera.lookAt(this.target);
    }
  }
  window.ViewerCameraController=ViewerCameraController;
})();
