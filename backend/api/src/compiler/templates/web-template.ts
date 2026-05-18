export function generateWebTemplate() {
  return [
    {
      path: "/project/index.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <h1>Welcome!</h1>
    <p>Start building your project here.</p>
  </div>
  <script src="script.js"><\/script>
</body>
</html>`,
    },
    {
      path: "/project/style.css",
      content: `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

#app {
  background: white;
  padding: 40px;
  border-radius: 8px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  text-align: center;
  max-width: 500px;
}

h1 {
  color: #333;
  margin-bottom: 20px;
  font-size: 2.5em;
}

p {
  color: #666;
  font-size: 1.1em;
  line-height: 1.6;
}`,
    },
    {
      path: "/project/script.js",
      content: `console.log('Welcome to your web project!');

// You can start coding here
const app = document.getElementById('app');

function greet() {
  console.log('Hello from your web app!');
}

// Call on load
window.addEventListener('load', greet);`,
    },
  ];
}
