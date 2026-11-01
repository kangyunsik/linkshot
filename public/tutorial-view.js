const $ = (id) => document.getElementById(id);

export function updateTutorialView(tutorial) {
  const panel = $('tutorial-hud'); if (!panel) return;
  panel.hidden = !tutorial; if (!tutorial) return;
  $('tutorial-progress').textContent = tutorial.completed ? 'COMPLETE' : `${tutorial.stage + 1} / ${tutorial.total}`;
  $('tutorial-title').textContent = tutorial.title; $('tutorial-description').textContent = tutorial.description;
  $('tutorial-action-hint').hidden = !tutorial.action; $('tutorial-action-hint').textContent = tutorial.action ? tutorial.action.enabled ? tutorial.action.label : tutorial.action.pendingLabel || '복귀 화면을 잠시 확인하세요…' : '';
  const key = JSON.stringify(tutorial.goals);
  if (panel.dataset.goals !== key) {
    panel.dataset.goals = key;
    $('tutorial-goals').replaceChildren(...tutorial.goals.map((goal) => { const item = document.createElement('li'); item.classList.toggle('done', goal.done); item.textContent = `${goal.done ? '✓' : '○'} ${goal.label}`; return item; }));
  }
}
