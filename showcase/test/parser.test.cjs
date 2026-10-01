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
const sourceRoot = process.env.BROBOT_SOURCE_ROOT || path.resolve(__dirname, '../..');
test('browser parser copies match the application files exactly', {skip:!fs.existsSync(path.join(sourceRoot,'src/commands.js'))}, () => {
  for (const name of ['commands.js','offline-commands.js']) {
    assert.equal(fs.readFileSync(path.join(__dirname,'../parser',name),'utf8'), fs.readFileSync(path.join(sourceRoot,'src',name),'utf8'));
  }
});
