const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pages = ['index','features','benchmarks','getting-started','commands','roadmap','download','development'];
let references = 0;
for (const page of pages) {
  const html = fs.readFileSync(path.join(root, page + '.html'), 'utf8');
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /<title>[^<]+<\/title>/);
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const raw = match[1];
    if (/^(?:https?:|mailto:|data:|\/\/)/.test(raw)) continue;
    const url = new URL(raw, 'https://example.invalid/' + (page === 'index' ? '' : page));
    let local = decodeURIComponent(url.pathname).replace(/^\//, '') || 'index.html';
    if (!path.extname(local)) local += '.html';
    const resolved = path.resolve(root, local);
    assert.ok(resolved.startsWith(root + path.sep), 'Reference leaves site: ' + raw);
    assert.ok(fs.existsSync(resolved), 'Missing local reference: ' + raw + ' from ' + page);
    if (url.hash && local.endsWith('.html')) {
      const target = fs.readFileSync(resolved, 'utf8');
      assert.ok(target.includes('id="' + decodeURIComponent(url.hash.slice(1)) + '"'), 'Missing anchor: ' + raw + ' from ' + page);
    }
    references++;
  }
}
const release = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
const checkpoint = JSON.parse(fs.readFileSync(path.join(root, 'checkpoint.json'), 'utf8'));
assert.equal(checkpoint.sourceCommit, release.testedApplicationCommit);
assert.equal(checkpoint.automatedChecks, release.automatedChecks);
assert.equal(checkpoint.liveRegressionPhases, release.liveRegressionPhases);
const replay = JSON.parse(fs.readFileSync(path.join(root, 'run-telemetry.json'), 'utf8'));
const scorecard = JSON.parse(fs.readFileSync(path.join(root, 'brobench-current.json'), 'utf8'));
assert.equal(replay.sourceCommit, release.testedApplicationCommit);
assert.equal(scorecard.commits.candidate, release.testedApplicationCommit);
for (const [group,key] of [['core','originalDevelopmentWorlds'],['additional','additionalDevelopmentWorlds'],['firstPass','widerKnownWorlds'],['fresh','firstPassWorlds'],['paired','pairedKnownWorlds']]) {
  const g = checkpoint.groups[group];
  assert.equal(g.cases.length, g.scheduled);
  assert.equal(g.cases.filter(r=>r.passed).length,g.passed);
  assert.equal(g.passed,release[key].passed);assert.equal(g.scheduled,release[key].scheduled);
  assert.equal(g.sourceCommit||checkpoint.sourceCommit,release[key].sourceCommit||release.testedApplicationCommit);
}
const zip = fs.readFileSync(path.join(root, 'brobot-dev.zip'));
assert.equal(zip.length, release.bytes);
assert.equal(crypto.createHash('sha256').update(zip).digest('hex'),release.sha256);
assert.equal(release.readyForStable1_0,false,'Update release gates deliberately before claiming stable');
const downloadHtml=fs.readFileSync(path.join(root,'download.html'),'utf8');
assert.ok(downloadHtml.includes(`<code id="downloadChecksum">${release.sha256}</code>`),'Visible download checksum must match the actual ZIP');
assert.ok(downloadHtml.includes(`<small id="downloadBuild">${release.bytes.toLocaleString('en-US')} bytes · Tested app ${release.testedApplicationCommit.slice(0,7)} · ${release.automatedChecks} checks</small>`),'Visible download size and tested build must match metadata');
assert.ok(downloadHtml.includes(`Source snapshot ${release.sourceCommit}.`),'Visible source identity must match the package');

function checkSyntax(directory) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())checkSyntax(file);
    else if(/\.(?:js|cjs)$/.test(entry.name)) {
      const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
    }
  }
}
checkSyntax(root);
console.log(`Verified ${pages.length} pages, ${references} local references, source/score consistency, ZIP checksum and all JavaScript syntax.`);

for(const [key,g] of Object.entries(checkpoint.groups)){
  assert.equal(g.cases.length,g.scheduled,key);
  assert.equal(g.cases.filter(r=>r.passed).length,g.passed,key);
  assert.match(g.sourceCommit||checkpoint.sourceCommit,/^[a-f0-9]{40}$/,key);
}
assert.equal(checkpoint.groups.pickup308.passed,10);assert.equal(checkpoint.groups.pickup308.scheduled,20);
assert.equal(checkpoint.groups.original308.passed,2);assert.equal(checkpoint.groups.original308.scheduled,3);
assert.equal(release.currentPairedEvaluation.sourceCommit,checkpoint.groups.core02.sourceCommit);
assert.equal(release.currentPairedEvaluation.passed,checkpoint.groups.core02.passed);
assert.equal(release.currentOriginalDevelopmentWorlds.sourceCommit,checkpoint.groups.original346.sourceCommit);
for(const key of ['MineLine','Workbench','Pathfinder','CommandSense','SafetyLatch','GoalSense-LLM']){
  assert.equal(scorecard.metrics[key].candidate.status,'not_run');
  assert.equal(scorecard.metrics[key].candidate.score,null);
}
assert.equal(scorecard.metrics['Trailhead-20'].candidate.passed,11);
const archiveCheck=spawnSync('python3',['-c',
  'import zipfile,json,hashlib,sys; z=zipfile.ZipFile(sys.argv[1]); names=z.namelist(); assert all(n.startswith("BroBot/") and ".." not in n.split("/") for n in names); assert not any(n.startswith(("BroBot/.server/","BroBot/node_modules/","BroBot/.git/","BroBot/showcase/")) or n=="BroBot/.env" for n in names); m=json.loads(z.read("BroBot/"+sys.argv[2])); assert all(hashlib.sha256(z.read("BroBot/"+p)).hexdigest()==h for p,h in m.items()); print("ZIP tested-file manifest verified")',
  path.join(root,'brobot-dev.zip'),release.testedFileManifest],{encoding:'utf8'});
assert.equal(archiveCheck.status,0,archiveCheck.stderr);
console.log(archiveCheck.stdout.trim());

assert.equal(checkpoint.groups.core02.passed,11);assert.equal(checkpoint.groups.core02.scheduled,20);
assert.equal(checkpoint.groups.original346.passed,1);assert.equal(checkpoint.groups.original346.scheduled,3);
assert.equal(scorecard.metrics.Trailhead.candidate.passed,1);
