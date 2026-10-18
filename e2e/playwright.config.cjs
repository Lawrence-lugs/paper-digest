// Playwright config for the Agent D Phase 2 E2E suite.
// Runs against a local static server serving web/ (see e2e/server.js).
// System Chrome is used (no Playwright browser downloads are available offline).

const path = require("path");

const PORT = 8910;
const baseURL = `http://127.0.0.1:${PORT}`;

module.exports = {
  testDir: path.join(__dirname, "tests"),
  output: path.join(__dirname, "test-results"),

  // Start the static server automatically for the whole run.
  webServer: {
    command: `node "${path.join(__dirname, "server.cjs")}"`,
    port: PORT,
    baseURL,
    reuseExistingServer: true,
    launchTimeout: 30000,
    stdout: "ignore",
    stderr: "ignore",
  },

  use: {
    baseURL,
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    args: ["--disable-popup-blocking"],
    navigationTimeout: 30000,
    actionTimeout: 15000,
    // Keep storage isolated per test (fresh localStorage/IndexedDB each time).
    storageState: undefined,
  },
};
