import {isDryLanding,isHazardFreeBody} from './body-hazards.js';
// Observe gravity after our navigation has ended. This never steers, installs
// a goal, resets velocity or claims that a failed route reached its destination.
export function awaitPassiveLanding(bot,{signal,deadline,now=()=>performance.now()}={}){
 const hazardFree=()=>{try{return isHazardFreeBody(bot)}catch{return false}};
 const aborted=()=>Object.assign(new Error('Action cancelled'),{name:'AbortError'});
 if(signal?.aborted)return Promise.reject(aborted());
 const available=deadline-now();
 if(!Number.isFinite(available)||available<=0||available>500||bot.pathfinder?.goal!=null||!hazardFree()||bot.entity?.onGround===true||!Number.isFinite(bot.entity?.velocity?.y)||bot.entity.velocity.y>=0)return Promise.resolve(false);
 if(now()>=deadline)return Promise.resolve(false);
 return new Promise((resolve,reject)=>{
  let finished=false,samples=0,timer;
  const end=(value,error)=>{if(finished)return;finished=true;clearTimeout(timer);bot.removeListener('physicsTick',tick);bot.removeListener('goal_updated',goalChanged);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value)};
  const abort=()=>end(false,aborted());
  const goalChanged=goal=>{if(goal!=null)end(false)};
  const tick=()=>{
   try {
   if(signal?.aborted)return abort();
   if(now()>=deadline||bot.pathfinder?.goal!=null||!hazardFree())return end(false);
   if(isDryLanding(bot)){if(++samples>=2)end(now()<deadline)}else{samples=0;if(!Number.isFinite(bot.entity?.velocity?.y)||bot.entity.velocity.y>0)end(false)}
   } catch { end(false) }
  };
  bot.on('physicsTick',tick);bot.on('goal_updated',goalChanged);signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>end(false),Math.max(0,deadline-now()));
  if(signal?.aborted)abort();
 });
}
