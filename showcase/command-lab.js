import { parseCommand } from './parser/commands.js';
const form = document.querySelector('#commandLab');
if (form) {
 const field=document.querySelector('#labInput'),mode=document.querySelector('#labMode'),detail=document.querySelector('#labDetail'),output=document.querySelector('#labOutput');
 const explain=()=>{try{const parsed=parseCommand(field.value,'YourPlayer');const online=parsed.kind==='goal';mode.textContent=online?'OPTIONAL PAID AI PLANNER':'LOCAL · NO API CALL';mode.dataset.online=String(online);detail.textContent=online?'This wording goes to the optional language planner in the installed app. This demo makes no API call.':parsed.kind==='survival'?'The offline controller observes the world and chooses bounded actions. This preview only shows command routing.':'BroBot recognizes this direct command locally. The installed app checks the world and inventory before acting.';output.textContent=JSON.stringify(parsed,null,2);}catch(error){mode.textContent='CHECK THE COMMAND';mode.dataset.online='false';detail.textContent=error.message;output.textContent='No action selected.';}};
 form.addEventListener('submit',event=>{event.preventDefault();explain();});document.querySelectorAll('[data-lab]').forEach(button=>button.addEventListener('click',()=>{field.value=button.dataset.lab;explain();}));explain();
}
