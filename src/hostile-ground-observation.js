import { isDryLanding, isHazardFreeBody, hasObservedStandingSupport } from './body-hazards.js';
import { hasAnchoredLeafLanding } from './starter-leaf-support.js';
import { awaitPassiveLanding } from './passive-settlement.js';

const CONTROLS=['forward','back','left','right','jump','sprint','sneak'];
// Observe knockback under exclusive action ownership. This never steers or
// certifies an airborne route. A normal grounded preflight is still required.
export function observeGroundForRetreat(bot,{signal,deadline,check=()=>{},now=()=>performance.now()}={}) {
  const started=now(),end=Math.min(deadline,started+1000),ascentEnd=Math.min(end,started+500);
  const abortError=()=>Object.assign(new Error('Recovery cancelled'),{name:'AbortError'});
  if(signal?.aborted)return Promise.reject(abortError());
  if(!Number.isFinite(end)||end<=started)return Promise.resolve(false);
  return new Promise((resolve,reject)=>{
    let finished=false,timer,samples=0,lastGroundSample=-Infinity,settling=false;
    const child=new AbortController();
    const finish=(value,error)=>{
      if(finished)return;finished=true;clearTimeout(timer);
      bot.removeListener('physicsTick',tick);bot.removeListener('goal_updated',goalChanged);
      signal?.removeEventListener('abort',abort);child.abort();
      error?reject(error):resolve(value);
    };
    const abort=()=>finish(false,abortError());
    const safe=()=>{
      check();
      const p=bot.entity?.position,v=bot.entity?.velocity;
      if(!p||!v||![p.x,p.y,p.z,v.x,v.y,v.z].every(Number.isFinite))throw Error('Recovery lacks finite motion observations');
      if(bot.pathfinder?.goal!=null || typeof bot.getControlState!=='function' || CONTROLS.some(name=>bot.getControlState(name)!==false))throw Error('Recovery does not own a quiet movement state');
      if(!isHazardFreeBody(bot))throw Error('Recovery body is not in observed dry hazard-free space');
    };
    const grounded=()=>isDryLanding(bot)&&bot.entity.velocity.y<=0&&hasObservedStandingSupport(bot)&&hasAnchoredLeafLanding(bot,bot.entity.position);
    const goalChanged=goal=>{if(goal!=null)finish(false,Error('Recovery observation goal replaced'));};
    const tick=()=>{
      if(finished)return;
      try{
        if(signal?.aborted)return abort();
        safe();
        if(now()>=end)return finish(false);
        if(settling){if(bot.entity.velocity.y>0)finish(false);return;}
        if(bot.entity.onGround===true && bot.entity.velocity.y<=0){
          if(!grounded())return finish(false);
          // Hurt and velocity packets are separate. Catch-up physics ticks
          // can arrive back-to-back before knockback has been applied. Keep
          // the initial observation window, then require spaced samples.
          if(now()-started<150||now()-lastGroundSample<40)return;
          lastGroundSample=now();
          if(++samples>=2)return finish(true);
          return;
        }
        samples=0;lastGroundSample=-Infinity;
        if(bot.entity.velocity.y<0){
          settling=true;
          void awaitPassiveLanding(bot,{signal:child.signal,deadline:Math.min(end,now()+499),now}).then(value=>{
            if(finished)return;
            try{safe();finish(value && now()<end && grounded());}catch(error){finish(false,error);}
          },error=>{if(!finished)finish(false,error);});
        }else if(now()>=ascentEnd)finish(false);
      }catch(error){finish(false,error);}
    };
    try{safe();}catch(error){finish(false,error);return;}
    bot.on('physicsTick',tick);bot.on('goal_updated',goalChanged);signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(false),Math.max(0,end-now()));
    if(signal?.aborted)abort();
  });
}
