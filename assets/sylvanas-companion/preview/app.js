import { ManagedWebGLRenderingContext, SceneRenderer, AssetManager, AtlasAttachmentLoader, SkeletonJson, Skeleton, AnimationStateData, AnimationState, Vector2, Physics } from '@esotericsoftware/spine-webgl';

const canvas=document.getElementById('avatar'), status=document.getElementById('status');
const errors=[];
function reportError(error){errors.push(String(error));document.getElementById('error').textContent=errors.join('\n');}
window.addEventListener('error',event=>reportError(event.message));
window.addEventListener('unhandledrejection',event=>reportError(event.reason));
const context=new ManagedWebGLRenderingContext(canvas,{alpha:true,premultipliedAlpha:false,antialias:true,preserveDrawingBuffer:true});
const renderer=new SceneRenderer(canvas,context),assets=new AssetManager(context,'../output/');
assets.loadText('sylvanas-companion.json');
assets.loadTextureAtlas('sylvanas-companion.atlas');
let skeleton,state,viewport,ready=false,paused=false,speed=1,last=performance.now();
let activeAnimation='idle',seekTime=null,frameCount=0,frameStart=last,recording=false;
let autoCompanion=true,nextAuto=last+10000,ambientIndex=0;
let gripCloseup=false;
const ambientSequence=['look-around','listen','nod','curious'];
const labels={idle:'呼吸待机',greet:'向你打招呼',wave:'挥手',celebrate:'开心',think:'思考',surprise:'惊讶',curious:'好奇',sad:'失落',angry:'生气',question:'疑问',awkward:'害羞','look-around':'环顾四周',nod:'点头','head-shake':'摇头',listen:'侧耳聆听',salute:'游侠致意',stretch:'舒展身体',ready:'警戒姿态',bounce:'轻盈跳跃'};
function updatePose(delta){state.update(delta);state.apply(skeleton);skeleton.update(delta);skeleton.updateWorldTransform(Physics.update);}
function measureAnimationBounds(data){
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const animation of data.animations){
    const probe=new Skeleton(data),config=new AnimationStateData(data),sample=new AnimationState(config);
    probe.setToSetupPose();sample.setAnimation(0,'idle',true);
    if(animation.name!=='idle')sample.setAnimation(1,animation.name,false);
    for(let i=0;i<=90;i++){
      sample.update(i===0?0:animation.duration/90);sample.apply(probe);probe.updateWorldTransform(Physics.update);
      const o=new Vector2(),s=new Vector2();probe.getBounds(o,s,[]);
      minX=Math.min(minX,o.x);minY=Math.min(minY,o.y);maxX=Math.max(maxX,o.x+s.x);maxY=Math.max(maxY,o.y+s.y);
    }
  }
  return {x:(minX+maxX)/2,y:(minY+maxY)/2,width:(maxX-minX)*1.12,height:(maxY-minY)*1.14};
}
function init(){
  const reader=new SkeletonJson(new AtlasAttachmentLoader(assets.get('sylvanas-companion.atlas')));
  const data=reader.readSkeletonData(assets.get('sylvanas-companion.json'));
  viewport=measureAnimationBounds(data);skeleton=new Skeleton(data);skeleton.setToSetupPose();
  const config=new AnimationStateData(data);config.defaultMix=.3;state=new AnimationState(config);
  state.setAnimation(0,'idle',true);
  state.addListener({start(entry){
    if(entry.trackIndex===1&&state.getCurrent(1)===entry)status.textContent=labels[entry.animation.name]||labels.idle;
  }});
  updatePose(0);ready=true;status.textContent=labels.idle;
  document.querySelectorAll('[data-animation]').forEach(button=>{
    button.disabled=!data.findAnimation(button.dataset.animation);
    button.addEventListener('click',()=>play(button.dataset.animation));
  });
  window.assetPreview={ready:true,errors,animations:data.animations.map(a=>({name:a.name,duration:a.duration})),play,
    poseAt(name,time){activeAnimation=name;seek(time);return {viewport,bounds:bounds()};},resume,bounds,
    canvasData(){return canvas.toDataURL('image/png');},get viewport(){return viewport;}};
}
function bounds(){const o=new Vector2(),s=new Vector2();skeleton.getBounds(o,s,[]);return{x:o.x,y:o.y,width:s.x,height:s.y};}
function syncControls(){
  document.getElementById('pause').textContent=paused?'播放':'暂停';
  document.getElementById('timeline').max=skeleton.data.findAnimation(activeAnimation).duration;
  document.querySelectorAll('[data-animation]').forEach(b=>b.classList.toggle('active',b.dataset.animation===activeAnimation));
}
function restorePlaybackFromSeek(){
  if(seekTime===null)return;
  const time=seekTime;seekTime=null;
  rebuildAtTime(time);
}
function rebuildAtTime(time){
  state.clearTracks();skeleton.setToSetupPose();state.setAnimation(0,'idle',true);
  status.textContent=labels[activeAnimation];
  if(activeAnimation!=='idle'){
    state.setEmptyAnimation(1,0);state.addAnimation(1,activeAnimation,false,0).mixDuration=.3;
    state.addEmptyAnimation(1,.35,0);
  }
  updatePose(0);
  const steps=Math.ceil(time*60);
  for(let i=0;i<steps;i++)updatePose(time/steps);
}
function resume(){if(!ready)return;restorePlaybackFromSeek();paused=false;nextAuto=performance.now()+10000;syncControls();}
function play(name){
  if(!ready||!skeleton.data.findAnimation(name))return;
  restorePlaybackFromSeek();activeAnimation=name;paused=false;nextAuto=performance.now()+10000;
  if(name==='idle')state.setEmptyAnimation(1,.35);
  else{
    if(!state.getCurrent(1)){
      state.setEmptyAnimation(1,0);
      state.addAnimation(1,name,false,0).mixDuration=.3;
    }else state.setAnimation(1,name,false).mixDuration=.3;
    state.addEmptyAnimation(1,.35,0);
  }
  status.textContent=labels[name]||name;syncControls();
}
function seek(time){
  if(!ready)return;
  seekTime=time;paused=true;rebuildAtTime(time);syncControls();draw();
}
function draw(){
  const w=Math.round(canvas.clientWidth*Math.min(devicePixelRatio,2)),h=Math.round(canvas.clientHeight*Math.min(devicePixelRatio,2));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  const bow=skeleton.findBone('bow');
  const view=gripCloseup?{x:bow.worldX,y:bow.worldY+15,width:115,height:145}:viewport;
  context.gl.viewport(0,0,w,h);const aspect=w/h,vh=Math.max(view.height,view.width/aspect);
  renderer.camera.setViewport(vh*aspect,vh);renderer.camera.position.set(view.x,view.y,0);renderer.camera.update();
  context.gl.clearColor(0,0,0,0);context.gl.clear(context.gl.COLOR_BUFFER_BIT);renderer.begin();renderer.drawSkeleton(skeleton,false);renderer.end();
}
function frame(now){
  if(now-last<1000/60-.5){requestAnimationFrame(frame);return;}
  const delta=Math.min((now-last)/1000,.05);last=now;
  try{
    if(!ready){if(assets.hasErrors())throw new Error(JSON.stringify(assets.getErrors()));if(assets.isLoadingComplete())init();}
    if(ready){
      if(autoCompanion&&!recording&&!paused&&now>=nextAuto)play(ambientSequence[ambientIndex++%ambientSequence.length]);
      if(!paused)updatePose(delta*speed);draw();frameCount++;
      if(now-frameStart>1000){document.getElementById('fps').textContent=`${Math.round(frameCount*1000/(now-frameStart))} FPS`;frameCount=0;frameStart=now;}
    }
    requestAnimationFrame(frame);
  }catch(error){reportError(error);status.textContent='载入失败';}
}
document.getElementById('pause').onclick=()=>{if(paused)resume();else{paused=true;syncControls();}};
document.getElementById('auto').onclick=()=>{autoCompanion=!autoCompanion;nextAuto=performance.now()+8000;document.getElementById('auto').textContent=`自动陪伴：${autoCompanion?'开':'关'}`;};
document.getElementById('background').onclick=()=>document.getElementById('stage').classList.toggle('light');
document.getElementById('closeup').onclick=()=>{
  gripCloseup=!gripCloseup;
  document.getElementById('closeup').textContent=gripCloseup?'查看全身':'握弓近景';
  document.querySelector('.stage-label').textContent=gripCloseup?'GRIP DETAIL · 手掌与弓柄':'SYLVANAS WINDRUNNER';
  if(ready)draw();
};
document.getElementById('speed').oninput=event=>{speed=Number(event.target.value);document.getElementById('speed-value').textContent=`${speed.toFixed(2)}×`;};
document.getElementById('timeline').oninput=event=>{const time=Number(event.target.value);document.getElementById('time-value').textContent=`${time.toFixed(2)}s`;seek(time);};
async function saveCapture(name,blob){const response=await fetch(`/capture/${name}`,{method:'POST',body:blob});if(!response.ok)throw new Error('保存失败');status.textContent=`已保存 ${name}`;}
document.getElementById('portrait').onclick=()=>{draw();canvas.toBlob(blob=>saveCapture('portrait.png',blob),'image/png');};
document.getElementById('record').onclick=()=>{
  if(!ready||recording)return;
  const button=document.getElementById('record');recording=true;button.disabled=true;button.textContent='录制中…';
  paused=false;speed=1;seekTime=null;state.clearTracks();skeleton.setToSetupPose();state.setAnimation(0,'idle',true);activeAnimation='idle';syncControls();
  const stream=canvas.captureStream(60),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:6000000});
  recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
  recorder.onstop=async()=>{
    stream.getTracks().forEach(track=>track.stop());
    try{await saveCapture('animation-preview.webm',new Blob(chunks,{type:'video/webm'}));}
    finally{recording=false;nextAuto=performance.now()+10000;button.disabled=false;button.textContent='录制动作';}
  };
  recorder.start();
  for(const [time,name] of [[1200,'greet'],[4200,'look-around'],[8000,'salute'],[11500,'ready'],[15000,'bounce']])setTimeout(()=>play(name),time);
  setTimeout(()=>recorder.stop(),18800);
};
requestAnimationFrame(frame);
