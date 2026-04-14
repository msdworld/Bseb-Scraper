const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";

const ROOT_DIR = path.resolve(__dirname, "..", "..");

// ===============================
// EDIT THIS
// ===============================
const DISTRICT_PREFIX = "84";

// ===============================
// FILES
// ===============================
const COLLEGE_FILE = path.join(ROOT_DIR, "bseb-12th-college-list-2026.json");
const OUTPUT_FILE = path.join(ROOT_DIR, "bseb-12th-roll-code-list.json");

// ===============================
// ROLL CHECK RANGE (ONLY 1–50)
// ===============================
const ROLL_RANGES = [
  26010000,
  26020000,
  26030000,
  26040000,
  26050000,
  26060000,
  26070000,
  26080000,
  26090000
];

// ===============================
// SPEED
// ===============================
const CONCURRENCY = 100;
const REQUEST_TIMEOUT = 5000;

// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  validateStatus: () => true,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Content-Type": "application/x-www-form-urlencoded"
  }
});

// ===============================
// HELPERS
// ===============================
function loadJSON(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function extractToken(html) {
  const $ = cheerio.load(html);
  return $('input[name="__RequestVerificationToken"]').val();
}

// ===============================
// SESSION
// ===============================
async function getSession() {
  const res = await client.get(BASE_URL);
  const token = extractToken(res.data);

  const cookies = (res.headers["set-cookie"] || [])
    .map(c => c.split(";")[0])
    .join("; ");

  return { token, cookies };
}

// ===============================
// FETCH CHECK
// ===============================
async function checkRollCode(rollCode, rollNo, session) {
  try {
    const payload = new URLSearchParams();
    payload.append("rollcode", rollCode);
    payload.append("rollno", rollNo);
    payload.append("captcha", generateCaptcha());
    payload.append("__RequestVerificationToken", session.token);

    const res = await client.post(POST_URL, payload.toString(), {
      headers: {
        Cookie: session.cookies,
        Referer: BASE_URL
      }
    });

    const html = String(res.data || "").toLowerCase();

    if (
      html.includes("invalid") ||
      html.includes("no record") ||
      html.includes("not found")
    ) {
      return false;
    }

    // valid if student name exists
    return html.includes("student") || html.includes("roll");
  } catch {
    return false;
  }
}

// ===============================
// MAIN
// ===============================
(async () => {
  console.log("🚀 Roll Code Finder Started");

  const collegeData = loadJSON(COLLEGE_FILE);
  const outputData = loadJSON(OUTPUT_FILE);

  const existingCodes = new Set([
    ...Object.keys(collegeData),
    ...Object.keys(outputData)
  ]);

  console.log(`📚 Existing roll codes: ${existingCodes.size}`);

  const session = await getSession();

  for (let rc = 10000; rc <= 99999; rc++) {
    const rollCode = String(rc);

    if (!rollCode.startsWith(DISTRICT_PREFIX)) continue;

    if (existingCodes.has(rollCode)) {
      console.log(`🆗 ${rollCode}: Already exists`);
      continue;
    }

    let found = false;

    for (const base of ROLL_RANGES) {
      const rollNos = [];

      for (let i = 1; i <= 50; i++) {
        rollNos.push(base + i);
      }

      for (let i = 0; i < rollNos.length; i += CONCURRENCY) {
        const chunk = rollNos.slice(i, i + CONCURRENCY);

        const results = await Promise.all(
          chunk.map(rn => checkRollCode(rollCode, rn, session))
        );

        if (results.some(r => r)) {
          found = true;
          break;
        }
      }

      if (found) break;
    }

    if (found) {
      outputData[rollCode] = "New College Found";
      existingCodes.add(rollCode);

      console.log(`✅ ${rollCode}: New saved`);

      saveJSON(OUTPUT_FILE, outputData);
    }
  }

  console.log("🎉 Roll Code Finder Completed");
})();
