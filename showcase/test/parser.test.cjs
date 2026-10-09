const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

test('website parser keeps supported torch phrases and owner pronouns offline', async () => {
  const {parseCommand} = await import(pathToFileURL(path.join(__dirname, '../parser/commands.js')).href);
  assert.deepEqual(parseCommand('craft four torches'), {kind:'action',name:'craft',args:{item:'torch',count:4}});
  assert.throws(() => parseCommand('craft 65 torches'), /1 to 64/);
  assert.deepEqual(parseCommand('Follow Me','LocalPlayer'), {kind:'follow',player:'LocalPlayer'});
  assert.deepEqual(parseCommand('Come Here','LocalPlayer'), {kind:'come',player:'LocalPlayer'});
});
test('browser parser copies match the frozen downloadable application exactly', () => {
  const {spawnSync}=require('node:child_process');
  const result=spawnSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); sys.stdout.buffer.write(z.read("BroBot/src/"+sys.argv[2]))',path.join(__dirname,'../brobot-dev.zip'),'commands.js'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(fs.readFileSync(path.join(__dirname,'../parser/commands.js'),'utf8'),result.stdout);
  const offline=spawnSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); sys.stdout.buffer.write(z.read("BroBot/src/offline-commands.js"))',path.join(__dirname,'../brobot-dev.zip')],{encoding:'utf8'});
  assert.equal(offline.status,0,offline.stderr);
  assert.equal(fs.readFileSync(path.join(__dirname,'../parser/offline-commands.js'),'utf8'),offline.stdout);
});
