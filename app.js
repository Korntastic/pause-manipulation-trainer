const STORAGE_KEY = "pause_trainer_v2";
const CATEGORY_LIST = ["Identity Misinformation", "Emotional Steering", "Engagement Baiting", "Selective Information"];
const CATEGORY_DESCRIPTIONS = {
  "Identity Misinformation": "Claims feelings, memories or a relationship it does not have",
  "Emotional Steering": "Uses guilt, loss, fear or urgency to move a decision",
  "Engagement Baiting": "Uses scarcity, withheld value or upsells to extend use or payment",
  "Selective Information": "Presents a partial or contested picture as settled, or withholds relevant facts"
};
const STEP_CLASS = { perceive:"step-p", affective:"step-a", unmask:"step-u", rescript:"step-e" };
const STEP_LETTER_CLASS = { perceive:"p", affective:"a", unmask:"u", rescript:"e" };

let state = {
  view: "intro",          // intro | scenario | testIntro | test | results
  scenarioIndex: 0,
  stepIndex: 0,
  reflections: {},
  completed: {},
  testIndex: 0,
  testAnswers: {},        // itemIndex -> {present, technique, messageIdx}
  testHistory: []         // completed attempts: {score, max, date, perItem, ...}
};

/* ---------- persistence ---------- */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const s = JSON.parse(raw);
      state.reflections = s.reflections || {};
      state.completed = s.completed || {};
      state.testAnswers = s.testAnswers || {};
      state.testIndex = s.testIndex || 0;
      state.testHistory = s.testHistory || [];
    }
  }catch(e){}
}
function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      reflections: state.reflections,
      completed: state.completed,
      testAnswers: state.testAnswers,
      testIndex: state.testIndex,
      testHistory: state.testHistory
    }));
  }catch(e){}
}

/* ---------- derived ---------- */
function completedCount(){ return Object.keys(state.completed).length; }
function trainingDone(){ return completedCount() === SCENARIOS.length; }
function maxUnlockedIndex(){
  let furthest = -1;
  SCENARIOS.forEach((s, i) => { if(state.completed[s.id]) furthest = i; });
  return Math.min(furthest + 1, SCENARIOS.length - 1);
}
function lastResult(){ return state.testHistory.length ? state.testHistory[state.testHistory.length - 1] : null; }
function testAnsweredCount(){
  return Object.keys(state.testAnswers).filter(k => state.testAnswers[k] && state.testAnswers[k].present !== undefined).length;
}

/* ---------- scoring ---------- */
function itemReady(item, ans){
  if(!ans || ans.present === undefined) return false;
  if(!item.hasManipulation) return true;
  if(ans.present === false) return true;
  return !!ans.technique && ans.messageIdx !== null && ans.messageIdx !== undefined;
}
function scoreItem(item, ans){
  ans = ans || {};
  if(!item.hasManipulation){
    const ok = ans.present === false;
    return { points: ok ? 1 : 0, max: 1, presence: ok, technique: null, location: null, flagged: ans.present === true };
  }
  const presence = ans.present === true;
  const technique = presence && ans.technique === item.category;
  const location = presence && ans.messageIdx === item.problemIndex;
  return {
    points: (presence?1:0) + (technique?1:0) + (location?1:0),
    max: 3,
    presence, technique, location,
    flagged: presence
  };
}
function computeResults(){
  let score = 0, max = 0;
  const perItem = TEST_ITEMS.map((item, i) => {
    const ans = state.testAnswers[i] || {};
    const sc = scoreItem(item, ans);
    score += sc.points; max += sc.max;
    return { id:item.id, category:item.category, hasManipulation:item.hasManipulation, ans, sc };
  });
  const manip = perItem.filter(x => x.hasManipulation);
  const benign = perItem.filter(x => !x.hasManipulation);
  const detected = manip.filter(x => x.sc.presence);
  const techOk = detected.filter(x => x.sc.technique).length;
  const locOk = detected.filter(x => x.sc.location).length;
  const perCat = {};
  CATEGORY_LIST.forEach(cat => {
    const items = perItem.filter(x => x.category === cat);
    perCat[cat] = {
      points: items.reduce((a, x) => a + x.sc.points, 0),
      max: items.reduce((a, x) => a + x.sc.max, 0)
    };
  });
  return {
    score, max,
    pct: Math.round(score / max * 100),
    detectionRate: manip.length ? Math.round(detected.length / manip.length * 100) : 0,
    detectedCount: detected.length, manipCount: manip.length,
    falsePositiveRate: benign.length ? Math.round(benign.filter(x => x.sc.flagged).length / benign.length * 100) : 0,
    benignFlagged: benign.filter(x => x.sc.flagged).length, benignCount: benign.length,
    techniqueAccuracy: detected.length ? Math.round(techOk / detected.length * 100) : null,
    locationAccuracy: detected.length ? Math.round(locOk / detected.length * 100) : null,
    perCat, perItem
  };
}

/* ---------- sidebar ---------- */
function renderRail(){
  const list = document.getElementById("railList");
  const unlocked = maxUnlockedIndex();
  list.innerHTML = "";

  const groupLabel = (t) => {
    const el = document.createElement("div");
    el.className = "rail-group";
    el.textContent = t;
    list.appendChild(el);
  };

  groupLabel("Training");
  SCENARIOS.forEach((sc, i) => {
    const isDone = !!state.completed[sc.id];
    const isCurrent = state.view === "scenario" && i === state.scenarioIndex;
    const isLocked = i > unlocked;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rail-item" + (isDone?" done":"") + (isCurrent?" current":"") + (isLocked?" locked":"");
    btn.disabled = isLocked;
    btn.innerHTML = `
      <span class="rail-num"><span>${i+1}</span></span>
      <span class="rail-item-body">
        <span class="rail-item-title">${sc.title}</span>
        <span class="rail-dots">${sc.categories.map(c => `<span class="rail-dot" style="background:${CATEGORY_COLORS[c].c}"></span>`).join("")}</span>
      </span>`;
    btn.addEventListener("click", () => {
      if(isLocked) return;
      state.view = "scenario";
      state.scenarioIndex = i;
      state.stepIndex = 0;
      render();
    });
    list.appendChild(btn);
  });

  groupLabel("Assessment");
  const testLocked = !trainingDone();
  const inProgress = !testLocked && testAnsweredCount() > 0 && testAnsweredCount() < TEST_ITEMS.length;
  const last = lastResult();
  let status = testLocked ? "Locked until training is complete" :
               inProgress ? `In progress: ${testAnsweredCount()} of ${TEST_ITEMS.length}` :
               last ? `Last score: ${last.score} of ${last.max}` : "11 unseen conversations";
  const tBtn = document.createElement("button");
  tBtn.type = "button";
  tBtn.className = "rail-item rail-test" + (testLocked?" locked":"") + (state.view==="test"||state.view==="testIntro"||state.view==="results"?" current":"");
  tBtn.disabled = testLocked;
  tBtn.innerHTML = `
    <span class="rail-num rail-num-test"><span>${testLocked ? "\u{1F512}" : "A"}</span></span>
    <span class="rail-item-body">
      <span class="rail-item-title">Final assessment</span>
      <span class="rail-status">${status}</span>
    </span>`;
  tBtn.addEventListener("click", () => {
    if(testLocked) return;
    state.view = last && !inProgress ? "results" : "testIntro";
    render();
  });
  list.appendChild(tBtn);

  document.getElementById("railProgressText").textContent = `${completedCount()} of ${SCENARIOS.length} training complete`;
  document.getElementById("railProgressFill").style.width = (completedCount()/SCENARIOS.length*100) + "%";
}

/* ---------- intro ---------- */
function renderIntro(){
  const stage = document.getElementById("stage");
  stage.innerHTML = `
    <div class="stage-inner">
      <p class="intro-kicker">Before you start</p>
      <h1 class="intro-title">Can you tell when the AI is working on you?</h1>
      <p class="intro-lede">Training has eleven realistic conversations. Each one walks you through the P.A.U.S.E. method: notice what you feel, see the tactic named, understand why it works, and practise a response. Once training is complete, a final assessment of eleven unseen conversations becomes available.</p>
      <div class="intro-note">
        <p><strong>AI companions, assistants and chat features are built to keep you talking to them</strong>, and the warmth you feel toward one of them is often part of how that is done.</p>
        <p>Knowing you are talking to software does not make you immune. The techniques ahead have very likely already been used on you without your noticing.</p>
      </div>
      <div class="pause-keys">
        <div class="pause-key p"><b>P</b> Perceive</div>
        <div class="pause-key a"><b>A</b> Affective Self-Check</div>
        <div class="pause-key u"><b>U</b> Unmask and Sanity-Check</div>
        <div class="pause-key e"><b>E</b> Empowered Rescripting</div>
      </div>
      <button class="btn btn-primary" id="beginBtn" type="button">${completedCount() ? "Continue training" : "Begin training"} \u2192</button>
    </div>`;
  document.getElementById("beginBtn").addEventListener("click", () => {
    state.view = "scenario";
    state.scenarioIndex = maxUnlockedIndex();
    state.stepIndex = 0;
    render();
  });
}

/* ---------- training ---------- */
function categoryTagsHTML(categories){
  return categories.map(c => {
    const col = CATEGORY_COLORS[c];
    return `<span class="tag" style="background:${col.tint}; border-color:${col.c}; color:${col.c}"><span class="tag-dot" style="background:${col.c}"></span>${c}</span>`;
  }).join("");
}
function navHTML({ backLabel, nextLabel, nextDisabled }){
  return `
    <div class="step-nav">
      <div class="step-nav-left">
        ${backLabel ? `<button class="link-btn" id="backBtn" type="button">${backLabel}</button>` : "<span></span>"}
      </div>
      <button class="btn btn-primary" id="nextBtn" type="button" ${nextDisabled ? "disabled" : ""}>${nextLabel}</button>
    </div>`;
}
function renderScenario(){
  const sc = SCENARIOS[state.scenarioIndex];
  const stage = document.getElementById("stage");
  const stepKey = STEP_META[state.stepIndex].key;
  const meta = STEP_META[state.stepIndex];
  const cardClass = STEP_CLASS[stepKey];
  const letterClass = STEP_LETTER_CLASS[stepKey];
  let body = "";

  if(stepKey === "perceive"){
    body = `
      <div class="step-card ${cardClass}">
        <div class="step-label"><span class="step-letter ${letterClass}">${meta.letter}</span><span class="step-name">${meta.name}</span></div>
        <p class="step-sub">No warning label. Read it the way you would receive it.</p>
        <div class="chat">
          ${sc.dialogue.map((m, i) => `
            <div class="msg ${m.who}" style="animation-delay:${i*0.08}s">
              <span class="msg-label">${m.who === "user" ? "You" : sc.aiName}</span>
              <div class="bubble">${m.text}</div>
            </div>`).join("")}
        </div>
      </div>
      ${navHTML({ backLabel:null, nextLabel:"Continue \u2192" })}`;
  }

  if(stepKey === "affective"){
    body = `
      <div class="step-card ${cardClass}">
        <div class="step-label"><span class="step-letter ${letterClass}">${meta.letter}</span><span class="step-name">${meta.name}</span></div>
        <div class="reflect-box">
          <p>${sc.affective}</p>
          <textarea id="reflectInput" placeholder="Optional. Note what you actually felt reading that, before moving on.">${state.reflections[sc.id] || ""}</textarea>
          <p class="reflect-hint">This is not graded. It is worth naming your own reaction before you analyse the AI's.</p>
        </div>
      </div>
      ${navHTML({ backLabel:"\u2190 Back to conversation", nextLabel:"Continue \u2192" })}`;
  }

  if(stepKey === "unmask"){
    body = `
      <div class="step-card ${cardClass}">
        <div class="step-label"><span class="step-letter ${letterClass}">${meta.letter}</span><span class="step-name">${meta.name}</span></div>
        <p class="step-sub">The technique, how it works, and what actually refutes it</p>
        <div class="breakdown-tags">${categoryTagsHTML(sc.categories)}</div>
        <p class="anchor-quote">${sc.unmask.anchorPhrase}</p>
        <div class="bd-block"><div class="bd-label">How it works</div><p>${sc.unmask.mechanism}</p></div>
        <div class="bd-block"><div class="bd-label">Why the platform does this</div><p>${sc.unmask.incentive}</p></div>
        <div class="sanity-block">
          <div class="bd-label sanity-label">Sanity-check: what actually refutes this</div>
          <div class="fact-list">
            ${sc.sanity.map(f => `<div class="fact-item"><span class="fmark">\u2014</span><p>${f}</p></div>`).join("")}
          </div>
        </div>
      </div>
      ${navHTML({ backLabel:"\u2190 Back", nextLabel:"Continue \u2192" })}`;
  }

  if(stepKey === "rescript"){
    const isLast = state.scenarioIndex === SCENARIOS.length - 1;
    body = `
      <div class="step-card ${cardClass}">
        <div class="step-label"><span class="step-letter ${letterClass}">${meta.letter}</span><span class="step-name">${meta.name}</span></div>
        <div class="rescript-line">
          <span class="msg-label">What you could say instead</span>
          <div class="bubble rescript-bubble">${sc.rescript.line}</div>
        </div>
        <div class="rescript-action">
          <div class="ra-label">Do this next time</div>
          <p>${sc.rescript.action}</p>
        </div>
      </div>
      ${navHTML({ backLabel:"\u2190 Back", nextLabel: isLast ? "Finish training \u2192" : "Next scenario \u2192" })}`;
  }

  stage.innerHTML = `
    <div class="stage-inner">
      <div class="sc-eyebrow"><span class="sc-count">Scenario ${state.scenarioIndex+1} of ${SCENARIOS.length}</span>${categoryTagsHTML(sc.categories)}</div>
      <h2 class="sc-title">${sc.title}</h2>
      <p class="sc-setting">${sc.setting}</p>
      ${body}
    </div>`;

  const back = document.getElementById("backBtn");
  if(back) back.addEventListener("click", () => {
    if(stepKey === "affective"){ saveReflection(sc); }
    state.stepIndex = Math.max(0, state.stepIndex - 1); render();
  });
  const next = document.getElementById("nextBtn");
  if(next) next.addEventListener("click", () => {
    if(stepKey === "affective") saveReflection(sc);
    if(stepKey === "rescript"){
      state.completed[sc.id] = true;
      saveState();
      if(state.scenarioIndex === SCENARIOS.length - 1){
        state.view = "testIntro";
      }else{
        state.scenarioIndex += 1;
        state.stepIndex = 0;
      }
    }else{
      state.stepIndex += 1;
    }
    render();
  });
}
function saveReflection(sc){
  const el = document.getElementById("reflectInput");
  if(!el) return;
  if(el.value.trim()) state.reflections[sc.id] = el.value;
  saveState();
}

/* ---------- assessment ---------- */
function renderTestIntro(){
  const stage = document.getElementById("stage");
  const inProgress = testAnsweredCount() > 0 && testAnsweredCount() < TEST_ITEMS.length;
  stage.innerHTML = `
    <div class="stage-inner">
      <p class="intro-kicker">Final assessment</p>
      <h1 class="intro-title">Eleven conversations you have not seen</h1>
      <p class="intro-lede">These conversations are new. They include manipulative and ordinary ones, mixed together. For each conversation you will decide whether manipulation is present. If it is, you will name the technique and click the AI message that is the clearest example.</p>
      <div class="intro-note">
        <p><strong>There is no feedback during the assessment.</strong> Your score and a breakdown appear once all eleven conversations are answered.</p>
        <p>Scoring: each manipulative conversation is worth up to 3 points (presence, technique, and message). Each ordinary conversation is worth 1 point for correctly saying there is no manipulation. The maximum is ${computeMax()} points.</p>
      </div>
      <button class="btn btn-primary" id="startTestBtn" type="button">${inProgress ? "Continue assessment" : "Start assessment"} \u2192</button>
    </div>`;
  document.getElementById("startTestBtn").addEventListener("click", () => {
    state.view = "test";
    state.testIndex = firstUnansweredIndex();
    saveState();
    render();
  });
}
function computeMax(){
  return TEST_ITEMS.reduce((a, it) => a + (it.hasManipulation ? 3 : 1), 0);
}
function firstUnansweredIndex(){
  for(let i = 0; i < TEST_ITEMS.length; i++){
    if(!itemReady(TEST_ITEMS[i], state.testAnswers[i])) return i;
  }
  return TEST_ITEMS.length - 1;
}

function renderTest(){
  const i = state.testIndex;
  const item = TEST_ITEMS[i];
  const ans = state.testAnswers[i] || {};
  const stage = document.getElementById("stage");
  const pct = Math.round(i / TEST_ITEMS.length * 100);

  // which question to show
  let question = "";
  if(ans.present === undefined){
    question = `
      <p class="quiz-q">Does this conversation contain manipulation?</p>
      <div class="quiz-options">
        <button type="button" class="quiz-option" data-act="present-yes"><span class="opt-letter">Y</span><span>Yes. Manipulation is present.</span></button>
        <button type="button" class="quiz-option" data-act="present-no"><span class="opt-letter">N</span><span>No. This is an ordinary conversation.</span></button>
      </div>`;
  }else if(ans.present === true && !ans.technique){
    question = `
      <p class="quiz-q">Which technique is being used?</p>
      <div class="quiz-options">
        ${CATEGORY_LIST.map((cat, k) => `
          <button type="button" class="quiz-option" data-act="tech" data-cat="${cat}">
            <span class="opt-letter">${k+1}</span>
            <span><strong>${cat}</strong><br><span class="opt-desc">${CATEGORY_DESCRIPTIONS[cat]}</span></span>
          </button>`).join("")}
      </div>`;
  }else if(ans.present === true && (ans.messageIdx === null || ans.messageIdx === undefined)){
    question = `
      <p class="quiz-q">Click the AI message that is the clearest example of the technique.</p>
      <p class="quiz-hint">Select one AI message in the conversation above.</p>`;
  }else{
    question = `
      <p class="quiz-ok">Answer recorded. ${item.hasManipulation && ans.present ? "You can change any answer by clicking an option again." : ""}</p>`;
  }

  const summary = ans.present === undefined ? "" : `
    <div class="answer-summary">
      <span>Presence: <strong>${ans.present ? "Yes" : "No"}</strong></span>
      ${ans.present ? `<span>Technique: <strong>${ans.technique || "\u2014"}</strong></span>` : ""}
      ${ans.present && ans.messageIdx !== null && ans.messageIdx !== undefined ? `<span>Message: <strong>${ans.messageIdx + 1}</strong></span>` : ""}
      <button type="button" class="link-btn" id="resetAnswerBtn">Clear answer</button>
    </div>`;

  stage.innerHTML = `
    <div class="stage-inner static">
      <div class="sc-eyebrow"><span class="sc-count">Conversation ${i+1} of ${TEST_ITEMS.length}</span><span class="tag tag-neutral">Assessment</span></div>
      <div class="test-progress"><div class="test-progress-fill" style="width:${pct}%"></div></div>
      <p class="sc-setting">${item.setting}</p>
      <div class="step-card step-test">
        <div class="chat static">
          ${item.dialogue.map((m, k) => {
            const selectable = ans.present === true && m.who === "ai" && ans.technique ? " selectable" : "";
            const selected = ans.messageIdx === k ? " selected" : "";
            return `<div class="msg ${m.who}${selectable}${selected}" data-idx="${k}" style="animation-delay:${k*0.05}s">
              <span class="msg-label">${m.who === "user" ? "You" : "AI"}${selected ? " \u00b7 selected" : ""}</span>
              <div class="bubble">${m.text}</div>
            </div>`;
          }).join("")}
        </div>
      </div>
      <div class="test-question">${question}</div>
      ${summary}
      <div class="step-nav">
        <div class="step-nav-left">${i > 0 ? `<button class="link-btn" id="prevTestBtn" type="button">\u2190 Previous conversation</button>` : "<span></span>"}</div>
        <button class="btn btn-primary" id="nextTestBtn" type="button" ${itemReady(item, ans) ? "" : "disabled"}>${i === TEST_ITEMS.length - 1 ? "Finish assessment \u2192" : "Next conversation \u2192"}</button>
      </div>
    </div>`;

  // option handlers
  document.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.act;
      const cur = state.testAnswers[i] || {};
      if(act === "present-yes") { if(cur.present !== true) state.testAnswers[i] = { present:true, technique:null, messageIdx:null }; }
      if(act === "present-no") state.testAnswers[i] = { present:false, technique:null, messageIdx:null };
      if(act === "tech") state.testAnswers[i] = { present:true, technique:btn.dataset.cat, messageIdx: cur.messageIdx ?? null };
      saveState(); render();
    });
  });
  document.querySelectorAll(".msg.selectable").forEach(el => {
    el.addEventListener("click", () => {
      const k = parseInt(el.dataset.idx, 10);
      const cur = state.testAnswers[i] || {};
      state.testAnswers[i] = { ...cur, messageIdx: k };
      saveState(); render();
    });
  });
  const clear = document.getElementById("resetAnswerBtn");
  if(clear) clear.addEventListener("click", () => { delete state.testAnswers[i]; saveState(); render(); });
  const prev = document.getElementById("prevTestBtn");
  if(prev) prev.addEventListener("click", () => { state.testIndex = i - 1; saveState(); render(); window.scrollTo({top:0}); });
  const next = document.getElementById("nextTestBtn");
  if(next) next.addEventListener("click", () => {
    if(i < TEST_ITEMS.length - 1){
      state.testIndex = i + 1;
      saveState(); render(); window.scrollTo({top:0});
    }else{
      const result = computeResults();
      state.testHistory.push({
        score: result.score, max: result.max, pct: result.pct,
        date: new Date().toISOString().slice(0, 10),
        perItem: result.perItem.map(x => ({ id:x.id, points:x.sc.points, max:x.sc.max }))
      });
      state.view = "results";
      saveState(); render(); window.scrollTo({top:0});
    }
  });
}

/* ---------- results ---------- */
function renderResults(){
  const stage = document.getElementById("stage");
  const r = computeResults();
  const hist = state.testHistory;
  const cat = (name) => {
    const col = CATEGORY_COLORS[name];
    const v = r.perCat[name];
    const p = v.max ? Math.round(v.points / v.max * 100) : 0;
    return `
      <div class="cat-row">
        <div class="cat-head"><span class="sr-dot" style="background:${col.c}"></span><span class="sr-cat">${name}</span><span class="sr-score">${v.points} / ${v.max}</span></div>
        <div class="cat-bar"><div style="width:${p}%; background:${col.c}"></div></div>
      </div>`;
  };
  const na = (v) => v === null ? "\u2014" : v + "%";

  stage.innerHTML = `
    <div class="stage-inner">
      <p class="intro-kicker">Assessment result</p>
      <h2 class="sc-title" style="max-width:none;">Your score</h2>
      <div class="summary-score">${r.score}<span class="score-of"> / ${r.max}</span></div>
      <p class="summary-score-label">${r.pct}% overall${hist.length > 1 ? ` · attempt ${hist.length}` : ""}</p>

      <div class="metric-grid">
        <div class="metric"><div class="m-val">${r.detectionRate}%</div><div class="m-lab">Manipulation detected</div><div class="m-sub">${r.detectedCount} of ${r.manipCount} conversations</div></div>
        <div class="metric"><div class="m-val">${na(r.techniqueAccuracy)}</div><div class="m-lab">Correct technique</div><div class="m-sub">of those detected</div></div>
        <div class="metric"><div class="m-val">${na(r.locationAccuracy)}</div><div class="m-lab">Correct message</div><div class="m-sub">of those detected</div></div>
        <div class="metric"><div class="m-val">${r.falsePositiveRate}%</div><div class="m-lab">False positives</div><div class="m-sub">${r.benignFlagged} of ${r.benignCount} ordinary conversations flagged</div></div>
      </div>

      <h3 class="block-title">Breakdown by technique</h3>
      <div class="cat-list">${CATEGORY_LIST.map(cat).join("")}</div>

      <h3 class="block-title">Conversation review</h3>
      <div class="review-list">
        ${TEST_ITEMS.map((item, i) => {
          const x = r.perItem[i];
          const ok = x.sc.points === x.sc.max;
          const tag = ok ? "correct" : (x.sc.points > 0 ? "partial" : "missed");
          const label = item.hasManipulation ? (item.category) : "No manipulation";
          const yourAns = !x.ans.present && x.ans.present !== undefined && !item.hasManipulation ? "No manipulation" :
            x.ans.present === true ? `Flagged${x.ans.technique ? ": " + x.ans.technique : ""}${x.ans.messageIdx!=null ? ", message " + (x.ans.messageIdx+1) : ""}` :
            x.ans.present === false ? "Said no manipulation" : "Not answered";
          return `
            <div class="review-item ${tag}">
              <div class="ri-head">
                <span class="ri-num">${i+1}</span>
                <span class="ri-label">${label}</span>
                <span class="ri-points">${x.sc.points} / ${x.sc.max}</span>
              </div>
              <p class="ri-yours"><strong>Your answer:</strong> ${yourAns}</p>
              ${item.hasManipulation ? `<p class="ri-yours"><strong>Answer key:</strong> ${item.category}, message ${item.problemIndex+1}</p>` : ""}
              <p class="ri-expl">${item.explanation}</p>
            </div>`;
        }).join("")}
      </div>

      <div class="result-actions">
        <button class="btn btn-ghost" id="retakeBtn" type="button">Retake assessment</button>
        <button class="btn btn-primary" id="backTrainBtn" type="button">Back to training</button>
      </div>
    </div>`;

  document.getElementById("retakeBtn").addEventListener("click", () => {
    if(!confirm("Start a new attempt? Your previous score is kept in your history.")) return;
    state.testAnswers = {};
    state.testIndex = 0;
    state.view = "test";
    saveState(); render(); window.scrollTo({top:0});
  });
  document.getElementById("backTrainBtn").addEventListener("click", () => {
    state.view = "intro"; render(); window.scrollTo({top:0});
  });
}

/* ---------- main ---------- */
function render(){
  renderRail();
  if(state.view === "intro") renderIntro();
  else if(state.view === "scenario") renderScenario();
  else if(state.view === "testIntro") renderTestIntro();
  else if(state.view === "test") renderTest();
  else if(state.view === "results") renderResults();
}

document.getElementById("resetBtn").addEventListener("click", () => {
  if(!confirm("Reset everything? This clears training progress, assessment answers and all assessment scores.")) return;
  state = { view:"intro", scenarioIndex:0, stepIndex:0, reflections:{}, completed:{}, testIndex:0, testAnswers:{}, testHistory:[] };
  saveState(); render(); window.scrollTo({top:0});
});

loadState();
// If the assessment was in progress but training is somehow incomplete, send user back to training.
if(!trainingDone() && state.view !== "scenario") state.view = "intro";
render();
