const panel = document.querySelector('#worldEvidence');
if (panel) {
  const list = panel.querySelector('#worldCases'), status = panel.querySelector('#worldStatus');
  const filter = panel.querySelector('#worldFilter'), query = panel.querySelector('#worldSearch'), shown = panel.querySelector('#worldShown');
  let data, selected = 'woodDeficit';
  const render = () => {
    if (!data) return;
    const group = data.groups[selected];
    if (!group) return;
    list.replaceChildren();
    status.textContent = `${group.passed}/${group.scheduled} completed the full starter objective · ${group.label}${group.note ? ' · ' + group.note : ''}`;
    panel.querySelectorAll('[data-cohort]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.cohort === selected)));
    const needle = query.value.trim();
    const visible = group.cases.filter(run => (!needle || run.seed.includes(needle)) && (filter.value === 'all' || (filter.value === 'passed' ? run.passed : !run.passed)));
    shown.textContent = `Showing ${visible.length} of ${group.scheduled} recorded runs. Filters do not change the score above.`;
    if (!visible.length) { const empty = document.createElement('p'); empty.textContent = 'No runs match these filters. Clear them to see every result.'; list.append(empty); }
    for (const run of visible) {
      const card = document.createElement('article'); card.className = 'world-case';
      const heading = document.createElement('div'); heading.className = 'world-case-head';
      const seed = document.createElement('h3'); seed.textContent = `World ${run.seed}`;
      const badge = document.createElement('span'); badge.className = 'world-result ' + (run.passed ? 'passed' : 'failed'); badge.textContent = ({passed:'Completed',failed:'Stopped',error:'Error',unsupported:'Unsupported',not_run:'Not run'})[run.status];
      heading.append(seed, badge);
      const elapsed = document.createElement('p'); elapsed.className = 'world-elapsed'; elapsed.textContent = Number.isFinite(run.elapsedMs) ? `${(run.elapsedMs / 1000).toFixed(1)} seconds` : 'No completed timing';
      const reason = document.createElement('p'); reason.textContent = (run.infrastructureRecovery ? 'Infrastructure recovery run. ' : '') + (run.reason || 'See the saved record for details.');
      const detail = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'What this test asked';
      const explanation = document.createElement('p'); explanation.textContent = 'Normal survival. Empty inventory. No supplied materials or edited terrain. One offline command: gather a stone pickaxe and furnace, then return alive to the starting point within 300 seconds.';
      detail.append(summary, explanation); card.append(heading, elapsed, reason, detail); list.append(card);
    }
    panel.querySelector('#worldSource').textContent = `Tested app snapshot ${(group.sourceCommit || data.sourceCommit).slice(0, 7)} · Minecraft ${data.minecraft} · Linux · no paid model calls`;
  };
  query.addEventListener('input', render);
  filter.addEventListener('change', render);
  panel.querySelector('#worldReset').addEventListener('click', () => { query.value = ''; filter.value = 'all'; render(); });
  panel.querySelectorAll('[data-cohort]').forEach(button => button.addEventListener('click', () => { selected = button.dataset.cohort; render(); }));
  fetch('/checkpoint.json').then(response => { if (!response.ok) throw Error('unavailable'); return response.json(); }).then(value => {
    if (!/^[a-f0-9]{40}$/.test(value.sourceCommit ?? '') || typeof value.minecraft !== 'string') throw Error('invalid');
    for (const button of panel.querySelectorAll('[data-cohort]')) {
      const group = value.groups?.[button.dataset.cohort];
      if (!group || (group.sourceCommit != null && !/^[a-f0-9]{40}$/.test(group.sourceCommit)) || !Array.isArray(group.cases) || !Number.isInteger(group.scheduled) || group.scheduled < 1 || group.cases.length !== group.scheduled || group.passed !== group.cases.filter(run => run.passed === true).length || new Set(group.cases.map(run => run.seed)).size !== group.cases.length) throw Error('invalid');
      if (group.cases.some(run => typeof run.seed !== 'string' || !['passed', 'failed', 'error', 'unsupported', 'not_run'].includes(run.status) || run.passed !== (run.status === 'passed') || (run.elapsedMs !== null && (!Number.isFinite(run.elapsedMs) || run.elapsedMs < 0)))) throw Error('invalid');
    }
    data = value; render();
  }).catch(() => { status.textContent = 'The latest records could not load. The evidence link below still has the published results.'; });
}
