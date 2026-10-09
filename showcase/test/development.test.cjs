const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
test('all public pages expose the dated development update without replacing release records',()=>{
 for(const page of ['index','features','benchmarks','getting-started','commands','roadmap','download','development'])assert.match(read(page+'.html'),/href="\/development"/);
 const release=JSON.parse(read('release.json'));assert.equal(release.agentVersion,'0.2');assert.equal(release.automatedChecks,346);assert.equal(release.currentPairedEvaluation.passed,11);
 assert.match(read('development.html'),/1,056/);assert.match(read('development.html'),/5a15225/);assert.match(read('development.html'),/fb69b493/);
 assert.match(read('development.html'),/has not repeated the 20-world cohort/);assert.match(read('development.html'),/166\.438 seconds/);
});
test('new source choice is immutable and explicitly distinct from packaged download',()=>{
 const html=read('download.html');assert.match(html,/https:\/\/github.com\/flowzygames\/BroBot\/archive\/198c6466a36551a6c9d038b4d27ccdb3450ecbe2\.zip/);
 assert.match(html,/source archive, not a new stable release or a prebuilt app/);assert.match(html,/href="\/brobot-dev.zip"/);
 assert.match(read('index.html'),/same phrase parser as the packaged Core 0.2 app/);
});
test('development evidence links pin the published source rather than mutable main',()=>{
 const html=read('development.html');
 for(const folder of ['main1016-complete-2026-10-07','empty-retry-2026-10-08'])assert.ok(html.includes('https://github.com/flowzygames/BroBot/blob/198c6466a36551a6c9d038b4d27ccdb3450ecbe2/benchmarks/results/'+folder+'/README.md'));
 assert.match(html,/No stable 1\.0 release date is promised/);assert.match(html,/Live paid-model planning has not been evaluated/);
});
