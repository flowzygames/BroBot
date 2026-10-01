const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pages = ['index','features','benchmarks','getting-started','commands','roadmap','download'];
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
