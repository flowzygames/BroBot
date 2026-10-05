// App-owned interaction seam for the pinned Java protocol. Mineflayer's
// activateBlock awaits aiming internally without a cancellation check before
// sending; its sleep helper also does not await that activation promise.
export function visibleInteractionFace(world,eye,target,reach=4.5) {
  const delta=target.offset(.5,.5,.5).minus(eye),distance=delta.norm();
  if(!Number.isFinite(distance)||distance<.001||distance>reach)return false;
  // Noncolliding selectable blocks such as levers still occupy a target cell.
  // Intervening collision shapes remain occluders; mining rays are unchanged.
  const hit=world.raycast(eye,delta.scaled(1/distance),Math.min(reach,distance+.01),(block,iterator)=>{
    if(iterator.intersect(block.shapes,block.position))return true;
    return block.position.equals(target);
  });
  return hit?.position?.equals(target)===true;
}

export function interactionVisible(bot,block) {
  const eye=bot.entity.position.offset(0,bot.entity.eyeHeight??1.62,0);
  if(bot.world?.raycast)return visibleInteractionFace(bot.world,eye,block.position);
  return eye.distanceTo(block.position.offset(.5,.5,.5))<=4.5&&bot.canSeeBlock?.(block)===true;
}

export function interactionSession(bot,check,{overworldOnly=false}={}) {
  const entity=bot.entity,client=bot._client,dimension=bot.game?.dimension;
  let changed=false;
  const invalidate=()=>{changed=true;};
  const events=['respawn','spawn','end'];
  for(const event of events)bot.on(event,invalidate);
  return {
    check(){
      check();
      if(changed||bot.entity!==entity||bot._client!==client||bot.game?.dimension!==dimension)throw Error('Block interaction cancelled: play session changed');
      if(overworldOnly&&!['overworld','minecraft:overworld'].includes(bot.game?.dimension))throw Error('Beds can explode outside the overworld; sleep is restricted to the overworld');
    },
    dispose(){for(const event of events)bot.removeListener(event,invalidate);}
  };
}

export async function prepareObservedActivation(bot,block,{check,requireBed=false}={}) {
  if(bot.version!=='1.21.8')throw Error('Guarded block activation is verified only for Minecraft Java 1.21.8');
  if(typeof check!=='function'||typeof bot._client?.write!=='function')throw Error('Guarded activation requires a live checked client');
  const position=block.position.clone(),stateId=block.stateId,type=block.type;
  const validate=()=>{
    check();
    const current=bot.blockAt(position);
    if(!current||current.stateId!==stateId||current.type!==type)throw Error('Interaction target changed while aiming');
    if(requireBed&&!bot.isABed(current))throw Error('Sleep target is no longer a bed');
    if(requireBed&&current.getProperties?.().occupied===true)throw Error('The bed is occupied');
    if(!interactionVisible(bot,current))throw Error('Interaction target is no longer visibly in reach');
  };
  validate();
  // Await to completion even after Stop. No interaction packet is queued here.
  await bot.lookAt(position.offset(.5,.5,.5),false);
  let sent=false;
  return ()=>{
    if(sent)throw Error('Block interaction has already been sent');
    validate();sent=true;
    // Exact pinned Mineflayer4.39 / Java1.21.8 empty-hand interaction shape.
    // No await may be inserted between final validation and this write.
    bot._client.write('block_place',{location:position,direction:1,hand:0,cursorX:.5,cursorY:.5,cursorZ:.5,insideBlock:false,sequence:0,worldBorderHit:false});
    bot.swingArm();
  };
}

export function confirmSleep(bot,send,options={}) { return confirmSleepState(bot,send,options,true); }
export function confirmWake(bot,send,options={}) { return confirmSleepState(bot,send,options,false); }
function confirmSleepState(bot,send,{signal,check,timeoutMs=3000}={},sleeping) {
  const event=sleeping?'sleep':'wake';
  if(typeof send!=='function'||typeof check!=='function'||(signal!==undefined&&!(signal instanceof AbortSignal)))throw Error('Invalid sleep-state confirmation inputs');
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>3000)throw Error('Invalid sleep confirmation budget');
  return new Promise((resolve,reject)=>{
    let finished=false,timer;
    const finish=error=>{
      if(finished)return;finished=true;clearTimeout(timer);
      bot.removeListener(event,sleep);bot.removeListener('end',ended);bot.removeListener('respawn',ended);bot.removeListener('spawn',ended);
      signal?.removeEventListener('abort',aborted);
      error?reject(error):resolve();
    };
    const sleep=()=>{try{check();if(bot.isSleeping!==sleeping)throw Error(`Server did not confirm ${event}`);finish();}catch(error){finish(error);}};
    const ended=()=>finish(Error(`${event} interrupted by a session change`));
    const aborted=()=>finish(Object.assign(Error('Action cancelled'),{name:'AbortError'}));
    bot.on(event,sleep);bot.on('end',ended);bot.on('respawn',ended);bot.on('spawn',ended);
    signal?.addEventListener('abort',aborted,{once:true});
    timer=setTimeout(()=>finish(Error(`Server did not confirm ${event}`)),timeoutMs);
    try{if(signal?.aborted)return aborted();check();send();}catch(error){finish(error);}
  });
}
