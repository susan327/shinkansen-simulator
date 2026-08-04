"use strict";
(() => {
  class TrainVisualViewer {
    constructor(){
      this.canvas=document.getElementById("viewerCanvas");
      this.scene=new THREE.Scene();
      this.scene.background=new THREE.Color(0xcfe2ed);
      this.camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,0.05,1000);
      this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:false});
      this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
      this.renderer.setSize(innerWidth,innerHeight);
      this.renderer.shadowMap.enabled=true;
      this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
      this.world=new THREE.Group();this.scene.add(this.world);
      this.modelRoot=new THREE.Group();this.world.add(this.modelRoot);
      this.environmentRoot=new THREE.Group();this.world.add(this.environmentRoot);
      this.cameraController=new ViewerCameraController({camera:this.camera,domElement:this.canvas,target:new THREE.Vector3(0,1.6,0)});
      this.mode="consist"; this.model=null; this.wireframe=false;
      this.initLights();this.buildEnvironment();this.bindUI();this.load("consist");this.designer=new TrainBodyDesigner(this);
      addEventListener("resize",()=>this.resize());this.loop();
    }
    initLights(){
      this.scene.add(new THREE.HemisphereLight(0xffffff,0x657784,2.35));
      const sun=new THREE.DirectionalLight(0xffffff,2.4);sun.position.set(30,55,35);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);this.scene.add(sun);
      const fill=new THREE.DirectionalLight(0xbfdcff,0.75);fill.position.set(-35,20,-25);this.scene.add(fill);
    }
    buildEnvironment(){
      const railMat=new THREE.MeshStandardMaterial({color:0x494f54,roughness:.45,metalness:.55});
      const sleeperMat=new THREE.MeshStandardMaterial({color:0x5b4a3d,roughness:.9});
      for(const z of [-0.7175,0.7175]){const r=new THREE.Mesh(new THREE.BoxGeometry(150,.09,.08),railMat);r.position.set(-45,.01,z);r.receiveShadow=true;this.environmentRoot.add(r)}
      for(let x=-72;x<28;x+=.65){const s=new THREE.Mesh(new THREE.BoxGeometry(.18,.09,2.35),sleeperMat);s.position.set(x,-.055,0);s.receiveShadow=true;this.environmentRoot.add(s)}
      this.grid=new THREE.GridHelper(180,180,0x668899,0xa9bdc9);this.grid.position.y=-.11;this.environmentRoot.add(this.grid);
      const platformMat=new THREE.MeshStandardMaterial({color:0xaab7bf,roughness:.92});
      this.platform=new THREE.Mesh(new THREE.BoxGeometry(125,.55,6),platformMat);this.platform.position.set(-35,0.975,-4.84);this.platform.receiveShadow=true;this.environmentRoot.add(this.platform);this.platform.visible=false;
    }
    formationFor(mode){
      const base=TrainGeometrySpec.formation;
      if(mode==="consist")return base;
      const index={lead:0,middle:1,tail:base.length-1}[mode]??0;
      return [{...base[index],index:0}];
    }
    load(mode,{preserveCamera=false}={}){
      const cameraState=preserveCamera?this.cameraController.captureState():null;
      this.mode=mode;
      if(this.modelRoot.children.length)this.modelRoot.clear();
      const formation=this.formationFor(mode);
      this.model=TrainRenderAdapter.create({THREE,axis:"x",direction:1,detailLevel:"full",formation});
      this.modelRoot.add(this.model.group);
      const length=this.model.formationLength||formation.reduce((s,c)=>s+c.length,0);
      if(cameraState){
        this.cameraController.restoreState(cameraState);
      }else{
        const center=mode==="consist"?-length/2+formation[0].length/2:0;
        this.cameraController.setTarget(center,1.65,0);
        this.cameraController.frame(mode==="consist"?Math.max(42,length*.64):23);
        this.cameraController.setView("three");
      }
      this.applyVisibility();this.updateMetrics();this.highlightButtons();
    }
    classify(o){
      let node=o; while(node){ if(node.userData?.component)return node.userData.component; node=node.parent; }
      const m=o.material;
      const mats=TrainMaterials.create(THREE);
      if(m===mats.glass)return "windows";
      if(m===mats.navy||m===mats.aqua||m===mats.blue)return "stripe";
      if(m===mats.rubber||m===mats.steelDark)return "bogie";
      if(m===mats.equipment)return "underfloor";
      return "body";
    }
    applyVisibility(){
      if(!this.model)return;
      const states={body:this.checked("showBody"),windows:this.checked("showWindows"),stripe:this.checked("showStripe"),doors:this.checked("showDoors"),skirt:this.checked("showSkirt"),lights:this.checked("showLights"),bogie:this.checked("showBogie"),underfloor:this.checked("showUnderfloor"),shield:this.checked("showShield")};
      this.model.group.traverse(o=>{
        if(!o.isMesh)return;
        const c=this.classify(o);o.visible=states[c]!==false;
        if(o.material){const list=Array.isArray(o.material)?o.material:[o.material];for(const m of list)m.wireframe=this.wireframe;}
      });
    }
    checked(id){const e=document.getElementById(id);return !e||e.checked}
    bindUI(){
      document.querySelectorAll("[data-model]").forEach(b=>b.addEventListener("click",()=>this.load(b.dataset.model)));
      document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>this.cameraController.setView(b.dataset.view)));
      ["showBody","showWindows","showStripe","showDoors","showSkirt","showLights","showBogie","showUnderfloor","showShield"].forEach(id=>document.getElementById(id).addEventListener("change",()=>this.applyVisibility()));
      document.getElementById("showRail").addEventListener("change",e=>{this.grid.visible=e.target.checked;for(const o of this.environmentRoot.children){if(o!==this.platform)o.visible=e.target.checked}});
      document.getElementById("showPlatform").addEventListener("change",e=>this.platform.visible=e.target.checked);
      document.getElementById("wireframe").addEventListener("change",e=>{this.wireframe=e.target.checked;this.applyVisibility()});
      document.getElementById("background").addEventListener("change",e=>{const map={sky:0xcfe2ed,white:0xf7f7f7,dark:0x18232d};this.scene.background=new THREE.Color(map[e.target.value]||map.sky)});
    }
    highlightButtons(){document.querySelectorAll("[data-model]").forEach(b=>b.classList.toggle("active",b.dataset.model===this.mode))}
    updateMetrics(){
      const d=TrainDimensions;const f=this.formationFor(this.mode);const length=this.model?.formationLength||f[0].length;
      document.getElementById("metrics").innerHTML=`<strong>表示:</strong> ${this.mode}<br><strong>全長:</strong> ${length.toFixed(1)} m<br><strong>車体幅:</strong> ${d.carWidth.toFixed(2)} m<br><strong>屋根高:</strong> ${d.roofTopY.toFixed(2)} m<br><strong>床面高:</strong> ${d.floorY.toFixed(2)} m<br><strong>軌間:</strong> ${d.trackGauge.toFixed(3)} m`;
    }
    resize(){this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight)}
    loop(){requestAnimationFrame(()=>this.loop());this.renderer.render(this.scene,this.camera)}
  }
  window.TrainVisualViewer=TrainVisualViewer;
})();
