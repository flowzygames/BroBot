const $ = id => document.getElementById(id);
let token = '', lastEvent = '', toolsShown = false, ownerEdited = false;
const pretty = name => String(name).replaceAll('_', ' ');
function notify(message) { $('notice').textContent = message; }
async function post(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Brobot-Token': token }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}
function draw(state) {
  token = state.token;
  $('connection').textContent = state.connection;
  $('health').textContent = state.health == null ? '—' : `${state.health} / 20`;
  $('healthbar').value = state.health || 0;
  $('food').textContent = state.food == null ? '—' : `${state.food} / 20`;
  $('foodbar').value = state.food || 0;
  $('position').textContent = state.position ? ['x', 'y', 'z'].map(k => Math.floor(state.position[k])).join(' / ') : 'Waiting for world';
  $('dimension').textContent = state.dimension || '—';
  $('action').textContent = state.action ? `${state.action.stopping ? 'Stopping ' : ''}${pretty(state.action.name)}` : 'Idle';
  $('goalstep').textContent = state.survival?.status === 'running' ? `Starter step ${state.survival.steps}` : state.ai.goal ? `Decision ${state.ai.goal.step}` : 'Ready when you are';
  $('aimode').textContent = state.ai.configured ? state.ai.model : 'Offline controls';
  $('welcome').textContent = state.ai.configured ? 'Build a home. Explore a little. Take on the dragon.' : 'Follow, gather and craft with direct commands, or try the offline starter kit.';
  $('currentgoal').textContent = state.ai.goal?.text || (state.ai.lastGoal ? `${state.ai.lastGoal.status}: ${state.ai.lastGoal.reason || state.ai.lastGoal.text}` : 'No active goal.');
  const starter = state.survival;
  const busy = Boolean(state.action || state.ai.goal || starter?.status === 'running' || starter?.stopping);
  $('starterstatus').textContent = starter?.stopping ? 'Stopping' : pretty(starter?.status || 'Ready');
  $('starterreason').textContent = starter?.reason || (starter?.status === 'running' ? 'Working from observed world and inventory state. Watch the activity log below.' : 'Start in a safe area with trees and stone nearby.');
  $('starterprogress').textContent = starter ? `${starter.steps} actions · ${starter.scouts} scouting attempts` : '';
  $('startstarter').disabled = !state.connected || busy;
  $('resumestarter').disabled = !state.connected || busy || !['paused', 'blocked'].includes(starter?.status);
  $('starterchecklist').replaceChildren();
  for (const [name, label] of [['stone_pickaxe', 'Stone pickaxe'], ['furnace', 'Furnace']]) {
    const owned = (Array.isArray(state.inventory) ? state.inventory : []).some(item => item.name === name && item.count > 0);
    const row = document.createElement('p'); row.textContent = `${owned ? '✓' : '○'} ${label}`; $('starterchecklist').append(row);
  }
  const home = document.createElement('p'); home.textContent = `${starter?.status === 'complete' ? '✓' : '○'} Verified return home`; $('starterchecklist').append(home);
  if (!ownerEdited) $('owner').value = state.owner || '';
  const players = (state.players || []).map(p => typeof p === 'string' ? p : p.name || p.username).filter(Boolean);
  $('players').textContent = players.length ? `Nearby players: ${players.join(', ')}` : '';
  const u = state.ai.usage, l = state.ai.limits;
  $('budget').textContent = `${u.requests} / ${l.requests} requests · ${u.inputTokens.toLocaleString()} input tokens · ${u.outputTokens.toLocaleString()} output tokens`;
  $('resetbudget').disabled = Boolean(state.ai.goal);
  const inventory = Array.isArray(state.inventory) ? state.inventory : Object.entries(state.inventory || {}).map(([name,count]) => ({name,count}));
  $('inventory').replaceChildren();
  if (!inventory.length) $('inventory').textContent = 'Backpack is empty.';
  for (const item of inventory) { const el=document.createElement('span');el.className='item';el.textContent=pretty(item.name);const count=document.createElement('b');count.textContent=item.count;el.append(count);$('inventory').append(el); }
  $('waypoints').replaceChildren();
  const waypoints = Object.entries(state.memory.waypoints);
  if (!waypoints.length) $('waypoints').textContent = 'No saved places yet.';
  for (const [name,value] of waypoints) { const el=document.createElement('button');el.className='item';el.textContent=name;el.title=`${value.dimension}: ${Object.values(value.position).map(Math.floor).join(', ')}`;el.onclick=()=>submit(`goto ${name}`);$('waypoints').append(el); }
  const eventsKey = JSON.stringify(state.events.at(-1));
  if (eventsKey !== lastEvent) {
    lastEvent=eventsKey;
    const feed=$('feed'),nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<70;
    feed.replaceChildren();
    for (const e of state.events.slice(-90)) {const el=document.createElement('div');el.className=`event ${e.type}`;const meta=document.createElement('small');meta.textContent=`${new Date(e.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · ${e.type.toUpperCase()}`;el.append(meta,document.createTextNode(e.message));if(e.type==='result'&&e.data){const extra=document.createElement('small');extra.textContent=JSON.stringify(e.data).slice(0,500);el.append(extra);}feed.append(el);}
    if(nearBottom) feed.scrollTop=feed.scrollHeight;
  }
  if (!toolsShown && state.tools.length > 4) {toolsShown=true;for (const tool of state.tools){const el=document.createElement('div');el.className='tool';const name=document.createElement('strong');name.textContent=tool.name;const desc=document.createElement('p');desc.textContent=tool.description;const args=document.createElement('code');args.textContent=Object.entries(tool.parameters.properties).map(([k,v])=>`${k}: ${v.enum?.join(' | ')||v.type}`).join('\n')||'No arguments';el.append(name,desc,args);$('tools').append(el);}}
}
async function submit(text) { try {await post('/api/command',{text});notify('Sent. Watch the activity log for progress.');return true;} catch(e){notify(e.message);return false;} }
let submitting = false;
$('commandform').onsubmit = async e => {e.preventDefault();const text=$('command').value.trim();if(!text||submitting)return;submitting=true;try{const accepted=await submit(text);if(accepted&&$('command').value.trim()===text)$('command').value='';}finally{submitting=false;}};
$('command').onkeydown = e => {if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('commandform').requestSubmit();}};
$('stop').onclick = async () => {try{await post('/api/stop');notify('Stop requested. Watch the current action while it finishes stopping.');}catch(e){notify(e.message);}};
$('shutdown').onclick = async () => {try{await post('/api/shutdown');notify('Closing BroBot. The launcher will save your world.');}catch(e){notify(e.message);}};
document.querySelectorAll('[data-command]').forEach(el=>el.onclick=async()=>{if(el.disabled)return;el.disabled=true;try{await submit(el.dataset.command);}finally{if(!['startstarter','resumestarter'].includes(el.id))el.disabled=false;}});
$('owner').oninput=()=>{ownerEdited=true;};
$('ownerform').onsubmit=async e=>{e.preventDefault();try{await post('/api/owner',{name:$('owner').value});ownerEdited=false;notify('Player name saved.');}catch(e){notify(e.message);}};
$('resetbudget').onclick=async()=>{if(!confirm('Reset the counters and allow more paid OpenAI API calls?'))return;try{await post('/api/budget/reset');notify('AI budget reset.');}catch(e){notify(e.message);}};
async function poll(){try{const r=await fetch('/api/state');if(!r.ok)throw new Error('Dashboard unavailable');draw(await r.json());}catch(e){$('connection').textContent='Dashboard disconnected';}finally{setTimeout(poll,1500);}}
poll();
