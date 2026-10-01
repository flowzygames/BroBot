// A small, explicit phrase grammar. This is not a local language model.
const quantities = Object.fromEntries(['one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen'].map((word,i)=>[word,i+1]));
const woods = ['oak','spruce','birch','jungle','acacia','dark_oak','mangrove','cherry','pale_oak'];
const blocks = [...woods.map(w=>`${w}_log`),'stone','cobblestone','dirt','sand','gravel','coal_ore','iron_ore','copper_ore','gold_ore','diamond_ore','deepslate_coal_ore','deepslate_iron_ore'];
const items = [...woods.map(w=>`${w}_planks`),'stick','crafting_table','furnace','wooden_pickaxe','stone_pickaxe','iron_pickaxe','wooden_axe','stone_axe','iron_axe','wooden_shovel','stone_shovel','torch','chest','bread'];
function aliases(names){const map=new Map();for(const name of names){const words=name.replaceAll('_',' ');for(const alias of [name,words,`${words}s`])map.set(alias,name);}return map;}
const blockNames=aliases(blocks), itemNames=aliases(items);
for(const wood of woods){itemNames.set(`${wood.replaceAll('_',' ')} plank`,`${wood}_planks`);}
export function parseOfflinePhrase(input){
 const text=input.trim().toLowerCase().replace(/^please\s+/,'').replace(/[.!]$/,'').trim();
 const match=/^(collect|gather|mine|craft|make)\s+(?:me\s+)?(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen)\s+([a-z_ ]+)$/.exec(text);
 if(!match)return null;
 const crafting=['craft','make'].includes(match[1]);
 const name=(crafting?itemNames:blockNames).get(match[3]);
 if(!name)return null;
 const count=['a','an'].includes(match[2])?1:quantities[match[2]]??Number(match[2]);
 if(!Number.isSafeInteger(count)||count<1||count>64)throw new Error('Offline gathering and crafting phrases need a count from 1 to 64.');
 return {kind:'action',name:crafting?'craft':'collect',args:{[crafting?'item':'block']:name,count}};
}
