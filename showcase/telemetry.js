const telemetryRoot = document.querySelector('#runTelemetry');
if (telemetryRoot) {
  let record, index = 0, timer = null;
  const get = id => telemetryRoot.querySelector('#' + id);
  const svg = get('traceMap'), slider = get('traceSlider'), play = get('tracePlay');
  const ns = 'http://www.w3.org/2000/svg';
  function node(tag, attrs, text) { const el=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(text!==undefined)el.textContent=text;return el; }
  function pause() { if(timer!==null)clearInterval(timer);timer=null;play.textContent='Play sampled run';play.setAttribute('aria-pressed','false'); }
  function render() {
    if(!record)return;
    const sample=record.samples[index], positions=record.samples.map(s=>s.position), home=record.home;
    const xs=positions.map(p=>p.x).concat(home.x), zs=positions.map(p=>p.z).concat(home.z);
    const minX=Math.min(...xs)-3,maxX=Math.max(...xs)+3,minZ=Math.min(...zs)-3,maxZ=Math.max(...zs)+3;
    const scale=Math.min(490/(maxX-minX),280/(maxZ-minZ));
    const project=p=>({x:300+(p.x-(minX+maxX)/2)*scale,y:190+(p.z-(minZ+maxZ)/2)*scale});
    const path=points=>points.map((p,i)=>`${i?'L':'M'}${project(p).x.toFixed(2)} ${project(p).y.toFixed(2)}`).join(' ');
    svg.replaceChildren();
    for(let x=60;x<=540;x+=60)svg.append(node('line',{x1:x,y1:40,x2:x,y2:340,stroke:'#365445','stroke-width':1}));
    for(let y=40;y<=340;y+=60)svg.append(node('line',{x1:60,y1:y,x2:540,y2:y,stroke:'#365445','stroke-width':1}));
    svg.append(node('path',{d:path(positions),fill:'none',stroke:'#6b8170','stroke-width':2,'stroke-dasharray':'4 6'}));
    svg.append(node('path',{d:path(positions.slice(0,index+1)),fill:'none',stroke:'#b5d576','stroke-width':3}));
    const h=project(home),p=project(sample.position);
    svg.append(node('rect',{x:h.x-6,y:h.y-6,width:12,height:12,rx:2,fill:'#f2a16c'}));
    svg.append(node('text',{x:h.x+(h.x>400?-12:12),y:h.y+4,fill:'#f2caab','font-size':13,'text-anchor':h.x>400?'end':'start'},'START / HOME'));
    svg.append(node('circle',{cx:p.x,cy:p.y,r:8,fill:'#d1f268',stroke:'#f6f7ef','stroke-width':2}));
    svg.append(node('text',{x:22,y:25,fill:'#c9d7c4','font-size':12},'N ↑   TOP-DOWN POSITION SAMPLES'));
    get('traceTime').textContent=`${sample.seconds.toFixed(1)}s / ${record.durationSeconds.toFixed(1)}s`;
    get('traceAction').textContent=sample.action.replaceAll('_',' ');
    get('traceVitals').textContent=`Health ${sample.health}/20 · Food ${sample.food}/20 · Height ${sample.position.y.toFixed(1)}`;
    get('tracePosition').textContent=`X ${sample.position.x.toFixed(1)} · Z ${sample.position.z.toFixed(1)}`;
    const inventory=get('traceInventory');inventory.replaceChildren();
    for(const item of sample.inventory){const pill=document.createElement('span');pill.textContent=`${item.count} × ${item.name.replaceAll('_',' ')}`;inventory.append(pill);}
    if(!sample.inventory.length){const empty=document.createElement('span');empty.textContent='Empty inventory';inventory.append(empty);}
    slider.value=String(index);slider.setAttribute('aria-valuetext',`${sample.seconds.toFixed(1)} seconds, ${sample.action}`);
  }
  play.addEventListener('click',()=>{if(!record)return;if(timer!==null){pause();return;}if(index===record.samples.length-1)index=0;render();play.textContent='Pause replay';play.setAttribute('aria-pressed','true');timer=setInterval(()=>{index++;if(index>=record.samples.length){index=record.samples.length-1;pause();}render();if(index===record.samples.length-1)pause();},500);});
  get('traceReset').addEventListener('click',()=>{pause();index=0;render();});
  slider.addEventListener('input',()=>{pause();index=Number(slider.value);render();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
  fetch('/run-telemetry.json').then(r=>{if(!r.ok)throw Error('unavailable');return r.json();}).then(data=>{
    if(!Array.isArray(data.samples)||data.samples.length<2||!data.samples.every(s=>Number.isFinite(s.seconds)&&['x','y','z'].every(k=>Number.isFinite(s.position?.[k]))))throw Error('invalid');
    record=data;slider.max=String(data.samples.length-1);slider.disabled=false;play.disabled=false;get('traceReset').disabled=false;
    get('traceSource').textContent=`World ${data.seed} · app ${data.sourceCommit.slice(0,7)} · ${data.samples.length} recorded snapshots including the verified finish`;
    render();
  }).catch(()=>{get('traceSource').textContent='This run could not load. The measured world records above remain available.';});
}
