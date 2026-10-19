const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"]);

const elements = {
  newButton: document.getElementById("new-quiz-button"),
  firstUploadButton: document.getElementById("upload-first-button"),
  replaceButton: document.getElementById("replace-image-button"),
  imageInput: document.getElementById("image-input"),
  emptyState: document.getElementById("empty-state"),
  editor: document.getElementById("editor"),
  notice: document.getElementById("notice"),
  quizList: document.getElementById("quiz-list"),
  libraryCount: document.getElementById("library-count"),
  breadcrumbTitle: document.getElementById("breadcrumb-title"),
  pageTitle: document.getElementById("page-title"),
  pageIntro: document.getElementById("page-intro"),
  quizTitle: document.getElementById("quiz-title"),
  saveStatus: document.getElementById("save-status"),
  quizButton: document.getElementById("quiz-mode-button"),
  quizTypeSelect: document.getElementById("quiz-type-select"),
  studyLayout: document.querySelector(".study-layout"),
  imageFrame: document.getElementById("image-frame"),
  imageStage: document.getElementById("image-stage"),
  image: document.getElementById("study-image"),
  markerLayer: document.getElementById("marker-layer"),
  canvasInstruction: document.getElementById("canvas-instruction"),
  landmarkCounter: document.getElementById("landmark-counter"),
  keyDescription: document.getElementById("key-description"),
  landmarkList: document.getElementById("landmark-list"),
  keyEmptyHint: document.getElementById("key-empty-hint"),
  keyFooter: document.getElementById("key-footer"),
  quizPanel: document.getElementById("quiz-panel"),
  quizProgressLabel: document.getElementById("quiz-progress-label"),
  quizScore: document.getElementById("quiz-score"),
  quizTimer: document.getElementById("quiz-timer"),
  quizPrompt: document.getElementById("quiz-prompt"),
  quizQuestion: document.getElementById("quiz-question"),
  freeResponseForm: document.getElementById("free-response-form"),
  freeResponseInput: document.getElementById("free-response-input"),
  freeResponseSubmit: document.querySelector("#free-response-form button[type='submit']"),
  quizFeedback: document.getElementById("quiz-feedback"),
  quizCompletion: document.getElementById("quiz-completion"),
  nextQuestionButton: document.getElementById("next-question-button"),
  scoreboardList: document.getElementById("scoreboard-list")
};

let quizzes = [];
let scores = [];
let activeQuiz = null;
let isQuizzing = false;
let currentQuestion = null;
let questionOrder = [];
let questionNumber = 0;
let correctAnswers = 0;
let hasAnswered = false;
let incorrectGuesses = new Set();
let quizType = "point";
let quizStartedAt = 0;
let quizTimerInterval = null;
let quizDurationMs = 0;
let quizFinished = false;
let scoreSaving = false;
let scoreSaveError = false;
let replaceImageRequested = false;
let focusedLandmarkId = null;
let noticeTimeout;
let saveQueue = Promise.resolve();

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`The local server returned an unreadable response (${response.status}).`);
  }
  if (!response.ok) throw new Error(result.error || `The local server returned ${response.status}.`);
  return result;
}

async function loadQuizzes() {
  [quizzes, scores] = await Promise.all([
    apiRequest("/api/quizzes"),
    apiRequest("/api/scores")
  ]);
  quizzes.sort((a, b) => b.updatedAt - a.updatedAt);
  renderLibrary();
  if (quizzes.length > 0) {
    await selectQuiz(quizzes[0].id);
  } else {
    showEmptyState();
  }
}

function makeId() {
  return globalThis.crypto && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function announce(message, isError = false) {
  clearTimeout(noticeTimeout);
  elements.notice.textContent = message;
  elements.notice.classList.toggle("error", isError);
  elements.notice.hidden = false;
  noticeTimeout = setTimeout(() => { elements.notice.hidden = true; }, 6000);
}

function showEmptyState() {
  activeQuiz = null;
  isQuizzing = false;
  clearQuizTimer();
  elements.emptyState.hidden = false;
  elements.editor.hidden = true;
  elements.breadcrumbTitle.textContent = "New quiz";
  elements.pageTitle.textContent = "Make an image your study guide.";
  elements.pageIntro.textContent = "Upload a diagram, mark the important parts, then quiz yourself until they stick.";
  renderLibrary();
}

function renderLibrary() {
  elements.libraryCount.textContent = String(quizzes.length);
  elements.quizList.replaceChildren();
  if (quizzes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "library-empty";
    empty.textContent = "Your saved image quizzes will show up here.";
    elements.quizList.append(empty);
    return;
  }
  for (const quiz of quizzes) {
    const row = document.createElement("div");
    row.className = `library-row${activeQuiz && quiz.id === activeQuiz.id ? " selected" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "library-item";
    button.setAttribute("aria-current", activeQuiz && quiz.id === activeQuiz.id ? "page" : "false");
    const thumb = document.createElement("span");
    thumb.className = "library-thumb";
    const thumbImage = document.createElement("img");
    thumbImage.src = quiz.imageUrl;
    thumbImage.alt = "";
    thumb.append(thumbImage);
    const copy = document.createElement("span");
    copy.className = "library-item-copy";
    const title = document.createElement("span");
    title.className = "library-item-title";
    title.textContent = quiz.title || "Untitled study set";
    const meta = document.createElement("span");
    meta.className = "library-item-meta";
    const count = (quiz.landmarks || []).length;
    meta.textContent = `${count} ${count === 1 ? "landmark" : "landmarks"}`;
    copy.append(title, meta);
    button.append(thumb, copy);
    button.addEventListener("click", () => selectQuiz(quiz.id));
    const remove = document.createElement("button");
    remove.className = "library-item-delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Delete ${quiz.title || "untitled study set"}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Delete "${quiz.title || "Untitled study set"}" and its saved image?`)) return;
      try {
        await deleteQuiz(quiz.id);
      } catch (error) {
        announce(`Could not delete this quiz: ${error.message}`, true);
      }
    });
    row.append(button, remove);
    elements.quizList.append(row);
  }
}

function formatDuration(durationMs) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function renderScoreboard() {
  elements.scoreboardList.replaceChildren();
  const recentScores = scores.filter(score => score.quizId === activeQuiz?.id)
    .sort((a, b) => b.completedAt - a.completedAt);
  if (recentScores.length === 0) {
    const empty = document.createElement("p");
    empty.className = "scoreboard-empty";
    empty.textContent = "Complete a quiz to start tracking your score, accuracy, and time.";
    elements.scoreboardList.append(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "scoreboard-table";
  const header = document.createElement("thead");
  header.innerHTML = "<tr><th scope=\"col\">Date</th><th scope=\"col\">Score</th><th scope=\"col\">Accuracy</th><th scope=\"col\">Time</th><th scope=\"col\">Mode</th></tr>";
  const body = document.createElement("tbody");
  for (const score of recentScores) {
    const row = document.createElement("tr");
    const date = document.createElement("td");
    date.textContent = new Date(score.completedAt).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });
    const points = document.createElement("td");
    points.textContent = `${score.correct}/${score.total}`;
    const accuracy = document.createElement("td");
    accuracy.textContent = `${score.accuracy}%`;
    const duration = document.createElement("td");
    duration.textContent = formatDuration(score.durationMs);
    const mode = document.createElement("td");
    mode.textContent = score.quizType === "free-response" ? "Free response" : "Find on image";
    row.append(date, points, accuracy, duration, mode);
    body.append(row);
  }
  table.append(header, body);
  elements.scoreboardList.append(table);
}

async function selectQuiz(id) {
  const quiz = quizzes.find(item => item.id === id);
  if (!quiz) return;
  activeQuiz = quiz;
  isQuizzing = false;
  clearQuizTimer();
  resetQuiz();
  elements.image.src = quiz.imageUrl;
  elements.image.alt = quiz.title ? `Study image for ${quiz.title}` : "Your uploaded study image";
  elements.quizTitle.value = quiz.title || "";
  elements.emptyState.hidden = true;
  elements.editor.hidden = false;
  elements.breadcrumbTitle.textContent = quiz.title || "Untitled study set";
  elements.pageTitle.textContent = "Your image, your study guide.";
  elements.pageIntro.textContent = "Add landmarks to build an answer key, then test what you know.";
  renderLibrary();
  renderEditor();
  renderScoreboard();
  await new Promise(resolve => {
    if (elements.image.complete) {
      if (!elements.image.naturalWidth) announce("The saved image could not be loaded from the local data folder.", true);
      resolve();
    }
    else {
      elements.image.addEventListener("load", resolve, { once: true });
      elements.image.addEventListener("error", () => {
        announce("The saved image could not be loaded from the local data folder.", true);
        resolve();
      }, { once: true });
    }
  });
}

function renderEditor() {
  if (!activeQuiz) return;
  const landmarks = activeQuiz.landmarks || [];
  const quizActive = isQuizzing;
  elements.landmarkCounter.textContent = `${landmarks.length} ${landmarks.length === 1 ? "landmark" : "landmarks"}`;
  elements.quizButton.disabled = landmarks.length === 0 || landmarks.some(point => !point.label.trim());
  elements.quizButton.innerHTML = isQuizzing
    ? quizFinished
      ? '<span aria-hidden="true">↻</span> Restart quiz'
      : '<span aria-hidden="true">■</span> End quiz'
    : '<span aria-hidden="true">▶</span> Start quiz';
  elements.quizTypeSelect.disabled = quizActive;
  elements.canvasInstruction.textContent = isQuizzing
    ? quizType === "free-response"
      ? "Type the name of the highlighted landmark"
      : "Click the landmark that matches the name"
    : "Click anywhere on the image to add a landmark";
  elements.imageStage.classList.toggle("can-place", !isQuizzing);
  elements.keyDescription.textContent = landmarks.length === 0
    ? "Click the image to place your first landmark."
    : isQuizzing
      ? quizType === "free-response" ? "Name the highlighted point. Answers ignore capitalization." : "Find the matching numbered point on the image."
      : "Name each point to create your answer key.";
  elements.keyEmptyHint.hidden = landmarks.length > 0;
  elements.keyFooter.hidden = isQuizzing;
  elements.quizPanel.hidden = !isQuizzing;
  elements.landmarkList.hidden = isQuizzing;
  elements.keyDescription.hidden = isQuizzing;
  elements.studyLayout.classList.toggle("quiz-active", quizActive);
  renderScoreboard();
  renderLandmarkRows();
  renderMarkers();
  if (quizActive) {
    if (quizFinished) renderCompletion();
    else renderQuestion();
  }
}

function renderLandmarkRows() {
  elements.landmarkList.replaceChildren();
  for (const [index, landmark] of (activeQuiz.landmarks || []).entries()) {
    const row = document.createElement("div");
    row.className = "landmark-row";
    const number = document.createElement("span");
    number.className = "landmark-number";
    number.textContent = String(index + 1);
    const input = document.createElement("input");
    input.className = "landmark-name";
    input.type = "text";
    input.maxLength = 80;
    input.value = landmark.label;
    input.placeholder = `Name landmark ${index + 1}`;
    input.setAttribute("aria-label", `Name landmark ${index + 1}`);
    input.addEventListener("focus", () => {
      focusedLandmarkId = landmark.id;
      row.classList.add("editing");
      renderMarkers();
    });
    input.addEventListener("blur", () => {
      if (focusedLandmarkId === landmark.id) focusedLandmarkId = null;
      row.classList.remove("editing");
      renderMarkers();
    });
    input.addEventListener("input", () => {
      landmark.label = input.value;
      elements.quizButton.disabled = activeQuiz.landmarks.length === 0 ||
        activeQuiz.landmarks.some(point => !point.label.trim());
      renderMarkers();
      queueSave();
    });
    const remove = document.createElement("button");
    remove.className = "remove-landmark";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove landmark ${index + 1}`);
    remove.addEventListener("click", () => {
      activeQuiz.landmarks.splice(index, 1);
      renderEditor();
      queueSave();
    });
    row.append(number, input, remove);
    elements.landmarkList.append(row);
  }
}

function renderMarkers() {
  elements.markerLayer.replaceChildren();
  if (!activeQuiz) return;
  for (const [index, landmark] of activeQuiz.landmarks.entries()) {
    const isTarget = isQuizzing && currentQuestion && currentQuestion.id === landmark.id &&
      (quizType === "free-response" || hasAnswered);
    const isIncorrect = isQuizzing && incorrectGuesses.has(landmark.id);
    const isEditing = !isQuizzing && focusedLandmarkId === landmark.id;
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = `landmark-marker${isTarget ? " quiz-target" : ""}${isIncorrect ? " quiz-incorrect" : ""}${isEditing ? " answer-key-target" : ""}`;
    marker.style.setProperty("--x", `${landmark.x * 100}%`);
    marker.style.setProperty("--y", `${landmark.y * 100}%`);
    marker.textContent = String(index + 1);
    marker.title = isQuizzing ? `Landmark ${index + 1}` : (landmark.label || `Landmark ${index + 1}`);
    marker.setAttribute("aria-label", `Landmark ${index + 1}`);
    marker.disabled = isQuizzing && (hasAnswered || quizType === "free-response");
    marker.addEventListener("click", () => {
      if (isQuizzing && quizType === "point") answerPointQuestion(landmark.id);
    });
    elements.markerLayer.append(marker);
  }
}

function addLandmark(event) {
  if (!activeQuiz || isQuizzing || event.target.closest(".landmark-marker")) return;
  const rect = elements.image.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  activeQuiz.landmarks.push({ id: makeId(), x, y, label: "" });
  renderEditor();
  queueSave();
  const inputs = elements.landmarkList.querySelectorAll(".landmark-name");
  inputs[inputs.length - 1]?.focus();
}

function resetQuiz() {
  clearQuizTimer();
  currentQuestion = null;
  questionOrder = [];
  questionNumber = 0;
  correctAnswers = 0;
  hasAnswered = false;
  incorrectGuesses = new Set();
  quizStartedAt = 0;
  quizDurationMs = 0;
  quizFinished = false;
  scoreSaving = false;
  scoreSaveError = false;
}

function startQuiz() {
  if (!activeQuiz) return;
  resetQuiz();
  quizType = elements.quizTypeSelect.value;
  questionOrder = activeQuiz.landmarks.filter(point => point.label.trim());
  if (questionOrder.length === 0) {
    announce("Name every landmark in the answer key before starting a quiz.", true);
    return;
  }
  if (questionOrder.length !== activeQuiz.landmarks.length) {
    announce("Add a name to every landmark before starting so the round can cover them all.", true);
    return;
  }
  for (let index = questionOrder.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [questionOrder[index], questionOrder[swapIndex]] = [questionOrder[swapIndex], questionOrder[index]];
  }
  isQuizzing = true;
  quizStartedAt = performance.now();
  updateQuizTimer();
  quizTimerInterval = setInterval(updateQuizTimer, 1000);
  nextQuestion();
  renderEditor();
}

function endQuiz() {
  isQuizzing = false;
  resetQuiz();
  renderEditor();
}

function nextQuestion() {
  if (hasAnswered) questionNumber += 1;
  if (questionNumber >= questionOrder.length) {
    completeQuiz();
    return;
  }
  currentQuestion = questionOrder[questionNumber];
  hasAnswered = false;
  incorrectGuesses = new Set();
  renderQuestion();
  renderMarkers();
}

function renderQuestion() {
  if (!isQuizzing || !currentQuestion) return;
  elements.quizPrompt.hidden = false;
  elements.quizCompletion.hidden = true;
  elements.quizProgressLabel.textContent = `QUESTION ${questionNumber + 1} OF ${questionOrder.length}`;
  elements.quizScore.textContent = `${correctAnswers} ${correctAnswers === 1 ? "correct" : "correct"}`;
  elements.quizTimer.textContent = formatDuration(performance.now() - quizStartedAt);
  const targetIndex = activeQuiz.landmarks.findIndex(point => point.id === currentQuestion.id) + 1;
  elements.quizQuestion.textContent = quizType === "free-response"
    ? `Landmark ${targetIndex}`
    : currentQuestion.label.trim();
  elements.quizPrompt.textContent = quizType === "free-response"
    ? "Type the answer-key name for the highlighted point"
    : "Click the landmark for";
  elements.freeResponseForm.hidden = quizType !== "free-response" || hasAnswered;
  elements.freeResponseInput.value = "";
  elements.freeResponseInput.disabled = false;
  elements.freeResponseInput.className = "";
  elements.freeResponseSubmit.disabled = false;
  clearQuizFeedback();
  elements.nextQuestionButton.hidden = true;
  elements.nextQuestionButton.disabled = false;
  elements.nextQuestionButton.innerHTML = questionNumber === questionOrder.length - 1
    ? 'Finish quiz <span aria-hidden="true">✓</span>'
    : 'Next question <span aria-hidden="true">→</span>';
  if (quizType === "free-response") {
    requestAnimationFrame(() => elements.freeResponseInput.focus());
  }
}

function clearQuizTimer() {
  if (quizTimerInterval !== null) {
    clearInterval(quizTimerInterval);
    quizTimerInterval = null;
  }
}

function updateQuizTimer() {
  if (!quizStartedAt || quizFinished) return;
  elements.quizTimer.textContent = formatDuration(performance.now() - quizStartedAt);
}

function clearQuizFeedback() {
  elements.quizFeedback.replaceChildren();
  elements.quizFeedback.className = "quiz-feedback";
}

function showQuizFeedback(state, title, detail) {
  const icon = document.createElement("span");
  icon.className = "quiz-feedback-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = state === "correct" ? "✓" : "×";

  const content = document.createElement("div");
  content.className = "quiz-feedback-content";
  const heading = document.createElement("strong");
  heading.className = "quiz-feedback-title";
  heading.textContent = title;
  const description = document.createElement("p");
  description.className = "quiz-feedback-detail";
  description.textContent = detail;
  content.append(heading, description);
  elements.quizFeedback.replaceChildren(icon, content);
  elements.quizFeedback.className = `quiz-feedback ${state}`;
}

function renderCompletion() {
  const total = questionOrder.length;
  const accuracy = total ? Math.round((correctAnswers / total) * 100) : 0;
  elements.quizProgressLabel.textContent = "ROUND COMPLETE";
  elements.quizScore.textContent = `${correctAnswers} / ${total} correct`;
  elements.quizPrompt.hidden = true;
  elements.quizQuestion.textContent = "You made it through every landmark!";
  elements.freeResponseForm.hidden = true;
  clearQuizFeedback();
  elements.nextQuestionButton.hidden = true;
  elements.quizCompletion.replaceChildren();

  const stats = document.createElement("div");
  stats.className = "completion-stats";
  for (const [label, value] of [
    ["Score", `${correctAnswers} / ${total}`],
    ["Accuracy", `${accuracy}%`],
    ["Time", formatDuration(quizDurationMs)]
  ]) {
    const stat = document.createElement("div");
    stat.className = "completion-stat";
    const statValue = document.createElement("strong");
    statValue.textContent = value;
    const statLabel = document.createElement("span");
    statLabel.textContent = label;
    stat.append(statValue, statLabel);
    stats.append(stat);
  }
  const message = document.createElement("p");
  message.className = `completion-message${scoreSaveError ? " save-error" : ""}`;
  message.textContent = scoreSaving
    ? "Saving your result to the scoreboard…"
    : scoreSaveError
      ? "Your quiz is complete, but the result could not be saved. Check the error message and try again later."
      : "Your result is saved in the scoreboard below.";
  elements.quizCompletion.append(stats, message);
  elements.quizCompletion.hidden = false;
}

async function completeQuiz() {
  if (quizFinished || !activeQuiz || questionOrder.length === 0) return;
  quizFinished = true;
  quizDurationMs = Math.round(performance.now() - quizStartedAt);
  clearQuizTimer();
  elements.quizTimer.textContent = formatDuration(quizDurationMs);
  scoreSaving = true;
  renderEditor();
  renderMarkers();
  renderCompletion();
  try {
    const score = await apiRequest("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quizId: activeQuiz.id,
        quizType,
        correct: correctAnswers,
        total: questionOrder.length,
        durationMs: quizDurationMs
      })
    });
    scores.unshift(score);
    renderScoreboard();
    announce("Quiz complete! Your score, accuracy, and time are on the scoreboard.");
  } catch (error) {
    scoreSaveError = true;
    announce(`Quiz complete, but the result could not be saved: ${error.message}`, true);
  } finally {
    scoreSaving = false;
    renderCompletion();
  }
}

function answerPointQuestion(landmarkId) {
  if (hasAnswered) return;
  if (landmarkId !== currentQuestion.id) {
    incorrectGuesses.add(landmarkId);
    renderMarkers();
    const wrongIndex = activeQuiz.landmarks.findIndex(point => point.id === landmarkId) + 1;
    showQuizFeedback("incorrect", "Incorrect selection", `Landmark ${wrongIndex} is not the requested structure. Choose another point.`);
    return;
  }
  hasAnswered = true;
  if (incorrectGuesses.size === 0) correctAnswers += 1;
  elements.quizScore.textContent = `${correctAnswers} ${correctAnswers === 1 ? "correct" : "correct"}`;
  const correctIndex = activeQuiz.landmarks.findIndex(point => point.id === currentQuestion.id) + 1;
  showQuizFeedback("correct", "Correct", `Landmark ${correctIndex}: ${currentQuestion.label.trim()}.`);
  elements.nextQuestionButton.hidden = false;
  renderMarkers();
  elements.nextQuestionButton.focus();
}

function submitFreeResponse(event) {
  event.preventDefault();
  if (hasAnswered || !currentQuestion) return;
  const answer = elements.freeResponseInput.value.trim();
  if (!answer) {
    showQuizFeedback("incorrect", "Answer required", "Type a landmark name before checking your answer.");
    elements.freeResponseInput.classList.add("answer-incorrect");
    elements.freeResponseInput.focus();
    return;
  }
  const expected = currentQuestion.label.trim();
  const isCorrect = answer.toLowerCase() === expected.toLowerCase();
  hasAnswered = true;
  elements.freeResponseSubmit.disabled = true;
  elements.freeResponseInput.disabled = true;
  if (isCorrect) correctAnswers += 1;
  elements.quizScore.textContent = `${correctAnswers} ${correctAnswers === 1 ? "correct" : "correct"}`;
  const targetIndex = activeQuiz.landmarks.findIndex(point => point.id === currentQuestion.id) + 1;
  elements.freeResponseInput.classList.add(isCorrect ? "answer-correct" : "answer-incorrect");
  showQuizFeedback(
    isCorrect ? "correct" : "incorrect",
    isCorrect ? "Correct" : "Incorrect",
    isCorrect
      ? `Landmark ${targetIndex}: ${expected}.`
      : `Your answer: “${answer}”. Correct answer: “${expected}” (landmark ${targetIndex}).`
  );
  elements.nextQuestionButton.hidden = false;
  renderMarkers();
  elements.nextQuestionButton.focus();
}

async function persistQuiz(quiz) {
  const saved = await apiRequest(`/api/quizzes/${encodeURIComponent(quiz.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: quiz.title.trim() || "Untitled study set",
      landmarks: quiz.landmarks
    })
  });
  quiz.updatedAt = saved.updatedAt;
  quiz.imageUrl = saved.imageUrl;
  const index = quizzes.findIndex(item => item.id === quiz.id);
  if (index >= 0) quizzes[index] = quiz;
  else quizzes.push(quiz);
  quizzes.sort((a, b) => b.updatedAt - a.updatedAt);
  renderLibrary();
}

function queueSave() {
  if (!activeQuiz) return;
  const quizToSave = activeQuiz;
  const saveStatus = elements.saveStatus;
  saveStatus.classList.add("saving");
  saveStatus.lastChild.textContent = " Saving…";
  saveQueue = saveQueue.then(async () => {
    await persistQuiz(quizToSave);
    if (activeQuiz === quizToSave) {
      saveStatus.classList.remove("saving");
      saveStatus.lastChild.textContent = " Saved locally";
    }
  }).catch(error => {
    saveStatus.classList.remove("saving");
    saveStatus.lastChild.textContent = " Save failed";
    announce(`Could not save this quiz: ${error.message}`, true);
  });
}

function openFilePicker() {
  elements.imageInput.value = "";
  elements.imageInput.click();
}

async function importImage(file, replaceExisting = false) {
  if (!file) return;
  if (!ALLOWED_TYPES.has(file.type)) {
    announce("Choose a JPG, PNG, GIF, WebP, or SVG image.", true);
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    announce("This image is larger than 20 MB. Choose a smaller image.", true);
    return;
  }
  try {
    await inspectImage(file);
    if (activeQuiz && elements.editor.hidden === false && replaceExisting) {
      const confirmed = window.confirm("Replace this quiz's image? Its landmarks will be cleared.");
      if (!confirmed) return;
      const form = new FormData();
      form.append("image", file);
      const replaced = await apiRequest(`/api/quizzes/${encodeURIComponent(activeQuiz.id)}/image`, {
        method: "PUT",
        body: form
      });
      Object.assign(activeQuiz, replaced);
      await selectQuiz(activeQuiz.id);
      announce("Image replaced. Add landmarks to rebuild the answer key.");
      return;
    }
    const form = new FormData();
    form.append("image", file);
    form.append("title", file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Untitled study set");
    const quiz = await apiRequest("/api/quizzes", { method: "POST", body: form });
    quizzes.push(quiz);
    quizzes.sort((a, b) => b.updatedAt - a.updatedAt);
    await selectQuiz(quiz.id);
    announce("Image added. Click it to place your first landmark.");
  } catch (error) {
    announce(`Could not add this image: ${error.message}`, true);
  }
}

function inspectImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (!image.naturalWidth || !image.naturalHeight) reject(new Error("The selected file does not contain a usable image."));
      else resolve();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The selected file could not be read as an image."));
    };
    image.src = url;
  });
}

async function deleteQuiz(id) {
  await apiRequest(`/api/quizzes/${encodeURIComponent(id)}`, { method: "DELETE" });
  quizzes = quizzes.filter(quiz => quiz.id !== id);
  if (activeQuiz && activeQuiz.id === id) {
    if (quizzes.length) await selectQuiz(quizzes[0].id);
    else showEmptyState();
  } else {
    renderLibrary();
  }
}

elements.newButton.addEventListener("click", openFilePicker);
elements.firstUploadButton.addEventListener("click", openFilePicker);
elements.replaceButton.addEventListener("click", () => {
  replaceImageRequested = true;
  openFilePicker();
});
elements.imageInput.addEventListener("change", event => {
  const shouldReplace = replaceImageRequested;
  replaceImageRequested = false;
  importImage(event.target.files[0], shouldReplace);
});
elements.imageInput.addEventListener("cancel", () => { replaceImageRequested = false; });
elements.imageStage.addEventListener("click", addLandmark);
elements.quizTypeSelect.addEventListener("change", () => {
  quizType = elements.quizTypeSelect.value;
});
elements.quizButton.addEventListener("click", () => {
  if (isQuizzing && !quizFinished) endQuiz();
  else startQuiz();
});
elements.freeResponseForm.addEventListener("submit", submitFreeResponse);
elements.nextQuestionButton.addEventListener("click", nextQuestion);
document.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.repeat || !isQuizzing || !hasAnswered || scoreSaving) return;
  event.preventDefault();
  nextQuestion();
});
elements.quizTitle.addEventListener("input", () => {
  if (!activeQuiz) return;
  activeQuiz.title = elements.quizTitle.value.trim();
  elements.breadcrumbTitle.textContent = activeQuiz.title || "Untitled study set";
  elements.image.alt = activeQuiz.title ? `Study image for ${activeQuiz.title}` : "Your uploaded study image";
  renderLibrary();
  queueSave();
});
elements.quizTitle.addEventListener("change", () => {
  if (activeQuiz && !activeQuiz.title) {
    activeQuiz.title = "Untitled study set";
    elements.quizTitle.value = activeQuiz.title;
    elements.breadcrumbTitle.textContent = activeQuiz.title;
    queueSave();
  }
});
async function startApp() {
  try {
    await loadQuizzes();
  } catch (error) {
    announce(`Could not connect to the local Atlas server: ${error.message} Start it with "node server.js" and reload this page.`, true);
    elements.newButton.disabled = true;
    elements.firstUploadButton.disabled = true;
  }
}

startApp();
