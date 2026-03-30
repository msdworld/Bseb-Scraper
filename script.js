const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// ===============================
// CONFIG
// ===============================
const START_URL = "https://interbiharboard.com/";
const OUT_DIR = "debug-capture";

// Put one known valid student here
const TEST_ROLL_CODE = "42104";
const TEST_ROLL_NO = "26010021";

// ===============================
// HELPERS
// ===============================
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function clean(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function safeName(str) {
  return String(str).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function saveText(file, content) {
  fs.writeFileSync(file, content, "utf8");
}

(async () => {
  ensureDir(OUT_DIR);

  const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"]
});

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 }
  });

  const page = await context.newPage();

  const requestLog = [];
  const responseLog = [];

  // ===============================
  // NETWORK LOGGING
  // ===============================
  page.on("request", async (req) => {
    const url = req.url();
    const method = req.method();

    if (url.includes("interbiharboard.com")) {
      const entry = {
        type: "request",
        time: new Date().toISOString(),
        method,
        url,
        headers: req.headers(),
        postData: req.postData() || null
      };

      requestLog.push(entry);

      console.log(`➡️ ${method} ${url}`);

      if (entry.postData) {
        console.log("   POST DATA:", entry.postData.slice(0, 500));
      }
    }
  });

  page.on("response", async (res) => {
    try {
      const url = res.url();
      const status = res.status();

      if (url.includes("interbiharboard.com")) {
        let bodyPreview = "";

        const contentType = res.headers()["content-type"] || "";
        if (
          contentType.includes("text/html") ||
          contentType.includes("application/json") ||
          contentType.includes("text/plain")
        ) {
          try {
            const txt = await res.text();
            bodyPreview = clean(txt).slice(0, 3000);
          } catch {}
        }

        const entry = {
          type: "response",
          time: new Date().toISOString(),
          status,
          url,
          headers: res.headers(),
          bodyPreview
        };

        responseLog.push(entry);

        console.log(`⬅️ ${status} ${url}`);
      }
    } catch (e) {
      console.log("Response log error:", e.message);
    }
  });

  // ===============================
  // OPEN PAGE
  // ===============================
  console.log("🚀 Opening page...");
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  await page.waitForTimeout(2000);

  // Save initial HTML
  saveText(path.join(OUT_DIR, "01-default-page.html"), await page.content());

  console.log("✅ Page opened");
  console.log("📍 Current URL:", page.url());

  // ===============================
  // FILL FORM
  // ===============================
  await page.fill('input[name="rollcode"]', TEST_ROLL_CODE);
  await page.fill('input[name="rollno"]', TEST_ROLL_NO);

  console.log("\n======================================");
  console.log("MANUAL STEP REQUIRED");
  console.log("======================================");
  console.log("1. Look at the CAPTCHA shown in browser");
  console.log("2. Type it manually into the captcha box");
  console.log("3. Then press ENTER here in terminal");
  console.log("======================================\n");

  process.stdin.resume();
  await new Promise((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  // ===============================
  // SUBMIT FORM
  // ===============================
  console.log("🚀 Submitting form...");

  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => {}),
    page.click('button[type="submit"]')
  ]);

  await page.waitForTimeout(5000);

  console.log("📍 Final URL after submit:", page.url());

  // Save final HTML
  saveText(path.join(OUT_DIR, "02-after-submit.html"), await page.content());

  // Save screenshot
  await page.screenshot({
    path: path.join(OUT_DIR, "final-page.png"),
    fullPage: true
  });

  // Save cookies
  const cookies = await context.cookies();
  saveText(path.join(OUT_DIR, "cookies.json"), JSON.stringify(cookies, null, 2));

  // Save request/response logs
  saveText(path.join(OUT_DIR, "requests.json"), JSON.stringify(requestLog, null, 2));
  saveText(path.join(OUT_DIR, "responses.json"), JSON.stringify(responseLog, null, 2));

  // Save summary
  const summary = {
    startUrl: START_URL,
    finalUrl: page.url(),
    requestCount: requestLog.length,
    responseCount: responseLog.length,
    capturedAt: new Date().toISOString()
  };

  saveText(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

  console.log("\n✅ CAPTURE COMPLETE");
  console.log(`📁 Saved folder: ${OUT_DIR}`);
  console.log("Files:");
  console.log("- 01-default-page.html");
  console.log("- 02-after-submit.html");
  console.log("- final-page.png");
  console.log("- cookies.json");
  console.log("- requests.json");
  console.log("- responses.json");
  console.log("- summary.json");

  console.log("\n🔍 Most important things to inspect:");
  console.log("1. summary.json");
  console.log("2. requests.json");
  console.log("3. responses.json");
  console.log("4. 02-after-submit.html");

  await browser.close();
})();
