export interface ABTestScenario {
  id: string;
  name: string;
  description: string;
  userRequest: string;
  initialFiles: Array<{ path: string; content: string }>;
  step: {
    step: number;
    sub_task_id: string;
    title: string;
    description: string;
    acceptance_criteria: string;
    required_files: string[];
  };
  expectedOutput: string;
}

export const AB_TEST_SCENARIOS: ABTestScenario[] = [
  {
    id: "scenario-1",
    name: "Single-file task",
    description: "Task touches only index.html but project also has style.css and app.js. Tests whether irrelevant files confuse the Editor.",
    userRequest: "Build a simple click counter web app with a button and score display",
    initialFiles: [
      {
        path: "/project/index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Click Counter</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>Click Counter</h1>
    <div id="score">0</div>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      },
      {
        path: "/project/style.css",
        content: `body {
  font-family: Arial, sans-serif;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  margin: 0;
  background: #f0f0f0;
}
.container {
  text-align: center;
  background: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
#score {
  font-size: 4rem;
  font-weight: bold;
  color: #333;
  margin: 1rem 0;
}`,
      },
      {
        path: "/project/app.js",
        content: `// Counter logic
let count = 0;
const scoreEl = document.getElementById('score');

function updateScore() {
  scoreEl.textContent = count;
}`,
      },
    ],
    step: {
      step: 1,
      sub_task_id: "T001-01",
      title: "Add click button to index.html",
      description: "In /project/index.html, add a <button id='clickBtn'>Click me!</button> element inside the .container div, immediately after the <div id='score'>0</div> element. Keep all existing content intact.",
      acceptance_criteria: "A button with id='clickBtn' and text 'Click me!' is present inside .container in index.html, positioned after the score display.",
      required_files: ["/project/index.html"],
    },
    expectedOutput: "index.html should have a <button id='clickBtn'>Click me!</button> element inside .container, after <div id='score'>. style.css and app.js must be unchanged from their initial content.",
  },

  {
    id: "scenario-2",
    name: "Two-file coordination",
    description: "Task modifies both app.js and index.html, but style.css is irrelevant. Tests whether sending the irrelevant CSS file affects Editor quality.",
    userRequest: "Add a reset button to the click counter that sets the score back to zero",
    initialFiles: [
      {
        path: "/project/index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Click Counter</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div class="container">
    <h1>Click Counter</h1>
    <div id="score">0</div>
    <button id="clickBtn">Click me!</button>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      },
      {
        path: "/project/style.css",
        content: `body {
  font-family: Arial, sans-serif;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  margin: 0;
  background: #f0f0f0;
}
.container {
  text-align: center;
  background: white;
  padding: 2rem;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
#score {
  font-size: 4rem;
  font-weight: bold;
  color: #333;
  margin: 1rem 0;
}
button {
  padding: 0.75rem 2rem;
  font-size: 1.1rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: #4CAF50;
  color: white;
  margin: 0.25rem;
}
button:hover {
  background: #45a049;
}`,
      },
      {
        path: "/project/app.js",
        content: `// Counter logic
let count = 0;
const scoreEl = document.getElementById('score');
const clickBtn = document.getElementById('clickBtn');

function updateScore() {
  scoreEl.textContent = count;
}

clickBtn.addEventListener('click', function() {
  count++;
  updateScore();
});`,
      },
    ],
    step: {
      step: 1,
      sub_task_id: "T002-01",
      title: "Add reset button and reset logic",
      description: "In /project/index.html, add a <button id='resetBtn'>Reset</button> immediately after the #clickBtn button inside .container. Keep all existing HTML intact. In /project/app.js, add a click event listener on the resetBtn element that sets count to 0 and calls updateScore(). Keep all existing JavaScript intact.",
      acceptance_criteria: "A reset button with id='resetBtn' is present in index.html after the click button. Clicking reset sets the score display back to 0.",
      required_files: ["/project/index.html", "/project/app.js"],
    },
    expectedOutput: "index.html should have <button id='resetBtn'>Reset</button> after #clickBtn. app.js should have a resetBtn click listener that sets count=0 and calls updateScore(). style.css must be unchanged.",
  },

  {
    id: "scenario-3",
    name: "Isolated single-file edit in large project",
    description: "Task only touches app.js but the project has 4 files. Large gap between Variant A (all 4 files) and Variant B (1 file). Tests whether Editor is distracted by irrelevant files.",
    userRequest: "Add keyboard support — pressing the spacebar should increment the counter",
    initialFiles: [
      {
        path: "/project/index.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Click Counter</title>
  <link rel="stylesheet" href="style.css">
  <link rel="stylesheet" href="animations.css">
</head>
<body>
  <div class="container">
    <h1>Click Counter</h1>
    <p class="hint">Click the button or press <kbd>Space</kbd></p>
    <div id="score">0</div>
    <div class="btn-row">
      <button id="clickBtn">Click me!</button>
      <button id="resetBtn">Reset</button>
    </div>
    <p id="keyboard-status" class="status"></p>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      },
      {
        path: "/project/style.css",
        content: `body {
  font-family: Arial, sans-serif;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  margin: 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.container {
  text-align: center;
  background: white;
  padding: 2.5rem;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  min-width: 320px;
}
h1 { color: #333; margin-bottom: 0.5rem; }
.hint { color: #888; font-size: 0.9rem; margin-bottom: 1rem; }
#score {
  font-size: 5rem;
  font-weight: 900;
  color: #764ba2;
  margin: 1rem 0;
  line-height: 1;
}
.btn-row { display: flex; gap: 0.5rem; justify-content: center; margin: 1rem 0; }
button {
  padding: 0.75rem 1.5rem;
  font-size: 1rem;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: transform 0.1s;
}
#clickBtn { background: #764ba2; color: white; }
#resetBtn { background: #eee; color: #333; }
button:hover { transform: scale(1.05); }
button:active { transform: scale(0.97); }
.status { font-size: 0.85rem; color: #aaa; height: 1.2em; }
kbd {
  background: #eee;
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 1px 6px;
  font-family: monospace;
  font-size: 0.85em;
}`,
      },
      {
        path: "/project/animations.css",
        content: `/* Animations for the counter */
@keyframes scorePopIn {
  0% { transform: scale(1); }
  50% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

@keyframes flashGreen {
  0% { background: white; }
  30% { background: #e8f5e9; }
  100% { background: white; }
}

.score-pop {
  animation: scorePopIn 0.2s ease-out;
}

.container-flash {
  animation: flashGreen 0.4s ease-out;
}`,
      },
      {
        path: "/project/app.js",
        content: `// Counter logic
let count = 0;
const scoreEl = document.getElementById('score');
const clickBtn = document.getElementById('clickBtn');
const resetBtn = document.getElementById('resetBtn');
const statusEl = document.getElementById('keyboard-status');

function updateScore(source) {
  count++;
  scoreEl.textContent = count;

  // Trigger pop animation
  scoreEl.classList.remove('score-pop');
  void scoreEl.offsetWidth; // reflow
  scoreEl.classList.add('score-pop');

  if (source === 'keyboard') {
    statusEl.textContent = '⌨️ Keyboard increment';
    setTimeout(() => { statusEl.textContent = ''; }, 1500);
  }
}

function resetCounter() {
  count = 0;
  scoreEl.textContent = count;
  document.querySelector('.container').classList.add('container-flash');
  setTimeout(() => document.querySelector('.container').classList.remove('container-flash'), 500);
}

clickBtn.addEventListener('click', () => updateScore('click'));
resetBtn.addEventListener('click', resetCounter);`,
      },
    ],
    step: {
      step: 1,
      sub_task_id: "T003-01",
      title: "Add spacebar keyboard listener",
      description: "In /project/app.js only, add a keydown event listener on the document that listens for the spacebar key (event.code === 'Space' or event.key === ' '). When pressed, call updateScore('keyboard'). Prevent default scrolling behavior (event.preventDefault()) when space is pressed. Keep all existing code intact.",
      acceptance_criteria: "Pressing the spacebar on the page increments the counter by 1 and shows the keyboard status message, without scrolling the page.",
      required_files: ["/project/app.js"],
    },
    expectedOutput: "app.js should have a document keydown listener that checks for Space key, calls updateScore('keyboard'), and calls event.preventDefault(). index.html, style.css, and animations.css must be unchanged.",
  },
];
