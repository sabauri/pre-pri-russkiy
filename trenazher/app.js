const batchSize = 3;
const errorPause = 4000;
const correctPause = 550;
const storageKey = 'ege-pri-pre:v1';
const cyrillicLetter = /^[а-яё]$/i;

const byId = (id) => document.getElementById(id);
const wordList = byId('word-list');
const summary = byId('summary');
const allMode = byId('all-mode');
const errorsMode = byId('errors-mode');
const restart = byId('restart');
const controls = byId('controls');
const letterControls = byId('letter-controls');
const review = byId('review');
const reviewFill = byId('review-fill');
const next = byId('next');
const summaryPrimary = byId('summary-primary');
const summarySecondary = byId('summary-secondary');
const summaryTitle = byId('summary-title');
const batchNumber = byId('batch-number');
const progressBar = byId('progress-bar');
const announcement = byId('announcement');
const pointerIsFine = matchMedia('(pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const state = loadState();
const rows = Array.from({ length: batchSize }, createRow);
let advanceTimer;

function newRound(ids) {
  const order = [...ids];
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return { order, answers: [], reviewUntil: 0 };
}

function restoreRound(saved, expectedLength) {
  if (!saved || !Array.isArray(saved.order) || !Array.isArray(saved.answers)) return null;
  const { order, answers, reviewUntil } = saved;
  if (expectedLength !== undefined && order.length !== expectedLength) return null;
  if (new Set(order).size !== order.length || !order.every((word) => words.has(word))) return null;
  if (answers.length > order.length || !answers.every((letter) => typeof letter === 'string' && cyrillicLetter.test(letter))) return null;
  const validReview = answers.length > 0 && (answers.length % batchSize === 0 || answers.length === order.length);
  return { order, answers, reviewUntil: validReview && Number.isFinite(reviewUntil) ? reviewUntil : 0 };
}

function loadState() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    saved = null;
  }
  const mistakes = new Set(Array.isArray(saved?.mistakes) ? saved.mistakes.filter((word) => words.has(word)) : []);
  return {
    mistakes,
    mode: saved?.mode === 'errors' ? 'errors' : 'all',
    all: restoreRound(saved?.all, words.size) ?? newRound(words.keys()),
    errors: restoreRound(saved?.errors) ?? newRound(mistakes),
  };
}

function saveState() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ ...state, mistakes: [...state.mistakes] }));
  } catch {
    // The current page remains playable if the browser blocks storage.
  }
}

function createRow() {
  const card = byId('word-template').content.firstElementChild.cloneNode(true);
  const row = { card };
  for (const name of ['leading', 'stem', 'tail', 'trailing', 'character', 'hint', 'meaning', 'mistyped', 'result', 'result-text']) {
    row[name] = card.querySelector(`.${name}`);
  }
  row.input = card.querySelector('input');
  row.input.addEventListener('input', (event) => {
    if (!event.isComposing) readInput(row);
  });
  row.input.addEventListener('compositionend', () => readInput(row));
  wordList.append(card);
  return row;
}

function readInput(row) {
  const letter = row.input.value.trim().toLowerCase();
  row.input.value = '';
  if (row.card.dataset.state === 'active' && cyrillicLetter.test(letter)) submitLetter(letter);
}

function submitLetter(letter) {
  const round = state[state.mode];
  if (round.reviewUntil || round.answers.length === round.order.length) return;

  const position = round.answers.length;
  const name = round.order[position];
  const word = words.get(name);
  const correct = letter === word.letter;
  round.answers.push(letter);
  if (correct) {
    state.mistakes.delete(name);
    announcement.textContent = `Верно. ${name}.`;
  } else {
    state.mistakes.add(name);
    announcement.textContent = `Ошибка. Введено «${letter}». Правильно «${word.letter}». ${name}.`;
  }

  const end = round.answers.length;
  if (end % batchSize === 0 || end === round.order.length) {
    const start = Math.floor(position / batchSize) * batchSize;
    round.reviewUntil = Date.now() + (batchHasError(round, start) ? errorPause : correctPause);
  }

  saveState();
  render();
}

function batchHasError(round, start) {
  return round.answers.slice(start, start + batchSize).some((answer, index) => {
    return answer !== words.get(round.order[start + index]).letter;
  });
}

function renderRows(round, start, reviewing, focus) {
  const previouslyFocused = document.activeElement;
  const hadInputFocus = rows.some((row) => row.input === previouslyFocused);
  let activeInput;
  rows.forEach((row, index) => {
    const position = start + index;
    const name = round.order[position];
    row.card.hidden = !name;
    if (!name) return;

    const { before, after, letter, hint } = words.get(name);
    const answer = round.answers[position];
    const isActive = !reviewing && position === round.answers.length;
    const wrong = Boolean(answer && answer !== letter);
    row.card.dataset.state = answer ? (wrong ? 'wrong' : 'right') : (isActive ? 'active' : 'waiting');

    const stemStart = before.lastIndexOf(' ') + 1;
    const tailEnd = after.indexOf(' ') < 0 ? after.length : after.indexOf(' ');
    row.leading.textContent = before.slice(0, stemStart);
    row.stem.textContent = before.slice(stemStart);
    row.tail.textContent = after.slice(0, tailEnd);
    row.trailing.textContent = after.slice(tailEnd);
    row.character.textContent = answer ? letter : '';
    row.hint.hidden = !hint && !wrong;
    row.meaning.textContent = hint;
    row.mistyped.hidden = !wrong;
    row.mistyped.textContent = wrong ? `Введено «${answer}»` : '';
    row.result.hidden = !answer;
    row['result-text'].textContent = wrong ? 'Ошибка' : 'Верно';
    row.input.tabIndex = isActive ? 0 : -1;
    if (isActive) {
      row.input.hidden = false;
      row.input.value = '';
      row.input.setAttribute('aria-label', `${before}…${after}${hint ? `. ${hint}` : ''}`);
      activeInput = row.input;
    }
  });

  if (activeInput && (focus || hadInputFocus)) {
    activeInput.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    if (hadInputFocus && viewport && activeInput.getBoundingClientRect().bottom > viewport.offsetTop + viewport.height - 12) {
      activeInput.scrollIntoView({ block: 'nearest' });
    }
  }
  for (const { input } of rows) {
    // Keep the virtual keyboard attached during the brief feedback pause.
    input.hidden = input !== activeInput && !(reviewing && input === previouslyFocused);
  }
}

function renderProgress(round) {
  const total = round.order.length;
  const answered = round.answers.length;
  const right = round.answers.filter((letter, index) => words.get(round.order[index]).letter === letter).length;
  byId('answered').textContent = answered;
  byId('total').textContent = total;
  byId('right-count').textContent = right;
  byId('wrong-count').textContent = answered - right;
  progressBar.max = total || 1;
  progressBar.value = answered;
}

function renderSummary(round) {
  const inErrors = state.mode === 'errors';
  const empty = round.order.length === 0;
  const hasMistakes = state.mistakes.size > 0;

  summaryTitle.textContent = empty ? 'Ошибок пока нет' : 'Круг завершён';
  byId('summary-detail').textContent = empty
    ? 'Здесь появятся слова, в которых ты ошибёшься.'
    : hasMistakes ? 'Можно ещё раз пройти слова, в которых были ошибки.' : 'Все слова из списка ошибок отработаны.';
  if (!inErrors && !hasMistakes) byId('summary-detail').textContent = 'Все слова пройдены.';

  summaryPrimary.textContent = hasMistakes ? 'Повторить ошибки' : inErrors ? 'Ко всем словам' : 'Новый круг';
  summarySecondary.hidden = !hasMistakes || inErrors;
}

function render(focus = false) {
  clearTimeout(advanceTimer);
  const round = state[state.mode];
  const remaining = round.reviewUntil - Date.now();
  const reviewing = remaining > 0;
  if (!reviewing && round.reviewUntil) {
    round.reviewUntil = 0;
    saveState();
  }

  const complete = !reviewing && round.answers.length === round.order.length;
  const batch = Math.floor((round.answers.length - Number(reviewing)) / batchSize);
  const hadExerciseFocus = wordList.contains(document.activeElement) || next === document.activeElement;
  allMode.setAttribute('aria-pressed', String(state.mode === 'all'));
  errorsMode.setAttribute('aria-pressed', String(state.mode === 'errors'));
  byId('saved-count').textContent = state.mistakes.size;
  restart.hidden = !round.order.length;
  batchNumber.hidden = complete;
  batchNumber.textContent = `Раунд ${batch + 1} из ${Math.ceil(round.order.length / batchSize)}`;
  wordList.hidden = complete;
  summary.hidden = !complete;
  controls.hidden = complete;
  letterControls.hidden = reviewing;
  review.hidden = !reviewing;
  renderProgress(round);

  if (complete) {
    renderSummary(round);
    if (hadExerciseFocus) summaryTitle.focus({ preventScroll: true });
    return;
  }

  const start = batch * batchSize;
  renderRows(round, start, reviewing, focus);
  if (reviewing) {
    const wrong = batchHasError(round, start);
    review.dataset.error = String(wrong);
    byId('review-text').textContent = wrong ? 'Посмотри, где ошибся.' : 'Все ответы верны.';
    next.hidden = !wrong;
    reviewFill.getAnimations().forEach((animation) => animation.cancel());
    if (!reducedMotion.matches) {
      const pause = wrong ? errorPause : correctPause;
      reviewFill.animate([{ transform: `scaleX(${remaining / pause})` }, { transform: 'scaleX(0)' }], {
        duration: remaining,
        fill: 'forwards',
      });
    }
    advanceTimer = setTimeout(render, remaining + 5);
  }
}

function startRound(mode) {
  state.mode = mode;
  state[mode] = newRound(mode === 'all' ? words.keys() : state.mistakes);
  saveState();
  render(pointerIsFine.matches);
}

allMode.addEventListener('click', () => {
  if (state.mode === 'all') return;
  state.mode = 'all';
  saveState();
  render();
});

errorsMode.addEventListener('click', () => {
  if (state.mode !== 'errors') startRound('errors');
});
restart.addEventListener('click', () => startRound(state.mode));
summarySecondary.addEventListener('click', () => startRound('all'));
summaryPrimary.addEventListener('click', () => {
  if (state.mistakes.size) startRound('errors');
  else if (state.mode === 'errors') allMode.click();
  else startRound('all');
});

next.addEventListener('click', () => {
  state[state.mode].reviewUntil = 0;
  saveState();
  render(pointerIsFine.matches);
});

letterControls.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-letter]');
  if (button) submitLetter(button.dataset.letter);
});

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || !cyrillicLetter.test(event.key)) return;
  if (event.repeat) {
    event.preventDefault();
    return;
  }
  if (event.target instanceof HTMLInputElement) return;
  event.preventDefault();
  submitLetter(event.key.toLowerCase());
});

saveState();
render(pointerIsFine.matches);
