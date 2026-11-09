P.A.U.S.E. Manipulation Recognition Trainer
===========================================

HOW TO RUN
  Option 1 (simplest): open pause-trainer-full.html in any modern browser.
                       It is a single self-contained file and works offline.
  Option 2 (source):   open index.html in this folder. Keep all files together.

FILES
  index.html          page structure
  style.css           base styling (light palette)
  style_additions.css assessment, results and sidebar styling
  data.js             the 11 training scenarios (dialogue, unmask, sanity-check, rescript)
  test-data.js        the 11 unseen assessment conversations and answer key
  app.js              all logic: training flow, locking, scoring, results

TRAINING
  Eleven scenarios in order. Each has four screens: Perceive, Affective self-check,
  Unmask and Sanity-check, Empowered rescripting. Scenarios unlock in sequence.

ASSESSMENT
  Unlocks only after all eleven training scenarios are complete.
  Eleven unseen conversations: 8 manipulative (2 per technique) and 3 ordinary.
  For each: is manipulation present? If yes, which technique? Which AI message is the clearest example?
  No feedback during the assessment. Score and breakdown appear at the end.
  Scoring: manipulative conversation = up to 3 points (presence, technique, message);
           ordinary conversation = 1 point for correctly saying no manipulation. Maximum 27.

DATA
  Progress and assessment results are stored in the browser's localStorage on this device only.
  Nothing is sent to a server. "Reset everything" clears all progress and scores.

EDITING CONTENT
  Change scenarios in data.js and assessment items in test-data.js. Each assessment item has
  hasManipulation, category, problemIndex (the message index, counted from 0), and an explanation.
  After editing, rebuild the single file by inlining the CSS and JavaScript, or use the source folder.
