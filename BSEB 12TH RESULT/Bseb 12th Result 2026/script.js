const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";
const SHOW_RESULT_URL = "https://interbiharboard.com/Result/ShowResult";

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const BASE_DIR = __dirname;

// ===============================
// EDIT ONLY THESE 2
// ===============================
const DISTRICT_PREFIX = "51";
const OUTPUT_FILE_NAME = "darbhanga-51-bseb-12th-full-result-2026.json";

// ===============================
// FILE PATHS
// ===============================
const VALID_ROLL_CODE_FILE = path.join(ROOT_DIR, "bseb-12th-college-list-2026.json");
const OUTPUT_FILE = path.join(BASE_DIR, OUTPUT_FILE_NAME);

// ===============================
// MULTIPLE ROLL RANGES
// ===============================
const ROLL_RANGES = [
  [26010001, 26010999],
  [26020001, 26020999],
  [26030001, 26030999],
  [26040001, 26040999],
  [26050001, 26050999],
];

// ===============================
// SPEED
// ===============================
const ROLLCODE_PARALLEL = 20;
const CONCURRENCY = 200;
const BATCH_SIZE = 200;
const REQUEST_TIMEOUT = 5000;

// ===============================
// SAVE
// ===============================
const SAVE_EVERY_VALID_RESULTS = 100;

// ===============================
// AXIOS
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 0,
  validateStatus: () => true,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36"
  }
});

// ===============================
// HELPERS
// ===============================
function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function loadJSON(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveCustomJSON(file, data) {
  const rollCodes = Object.keys(data).sort((a, b) => Number(a) - Number(b));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function countTotalStudentsSaved(fullResults) {
  let total = 0;
  for (const rc of Object.keys(fullResults)) {
    total += Object.keys(fullResults[rc] || {}).length;
  }
  return total;
}

// ===============================
// SESSION
// ===============================
async function getSessionData() {
  const res = await client.get(BASE_URL);
  const html = res.data;

  const cookies = (res.headers["set-cookie"] || [])
    .map(c => c.split(";")[0])
    .join("; ");

  const tokenMatch = html.match(/name="__RequestVerificationToken".*?value="(.*?)"/);
  if (!tokenMatch) throw new Error("Token not found");

  return {
    cookieHeader: cookies,
    requestVerificationToken: tokenMatch[1]
  };
}

// ===============================
// FETCH RESULT
// ===============================
async function fetchStudentResult(rollCode, rollNo, sessionData) {
  try {
    const payload = new URLSearchParams();
    payload.append("rollcode", rollCode);
    payload.append("rollno", rollNo);
    payload.append("captcha", generateCaptcha());
    payload.append("__RequestVerificationToken", sessionData.requestVerificationToken);

    const res = await client.post(POST_URL, payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": sessionData.cookieHeader
      }
    });

    const html = res.data || "";

    if (
      html.includes("Invalid") ||
      html.includes("not found") ||
      html.length < 1000
    ) {
      return { valid: false };
    }

    return {
      valid: true,
      data: {
        rollCode: String(rollCode),
        rollNo: String(rollNo),
        raw: html
      }
    };

  } catch {
    return { valid: false };
  }
}

// ===============================
// LOAD ROLL CODES
// ===============================
function loadValidRollCodes() {
  const raw = loadJSON(VALID_ROLL_CODE_FILE, {});
  const allCodes = Object.keys(raw).sort((a, b) => Number(a) - Number(b));
  const matching = allCodes.filter(code => code.startsWith(DISTRICT_PREFIX));

  console.log(`📚 Total Roll Codes: ${allCodes.length}`);
  console.log(`🔍 Matching (${DISTRICT_PREFIX}): ${matching.length}`);

  return matching;
}

// ===============================
// GLOBAL STATE
// ===============================
const saveState = {
  fullResults: {},
  totalStudentsSaved: 0,
  unsavedValidCount: 0,
  savedThisRun: 0
};

// ===============================
// PROCESS ROLL CODE
// ===============================
async function processRollCode(rollCode) {
  if (!saveState.fullResults[rollCode]) {
    saveState.fullResults[rollCode] = {};
  }

  const existingRollNos = new Set(Object.keys(saveState.fullResults[rollCode]));
  const already = existingRollNos.size;
  let newSaved = 0;

  console.log(`▶️ ${rollCode} | Already: ${already}`);

  let sessionData = await getSessionData();

  for (const [START, END] of ROLL_RANGES) {

    console.log(`🔢 Checking Range: ${START}-${END}`);

    let current = START;

    while (current <= END) {
      const batchEnd = Math.min(current + BATCH_SIZE - 1, END);
      const batch = [];

      for (let rn = current; rn <= batchEnd; rn++) {
        if (!existingRollNos.has(String(rn))) {
          batch.push(rn);
        }
      }

      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);

        const results = await Promise.all(
          chunk.map(rn => fetchStudentResult(rollCode, rn, sessionData))
        );

        for (let j = 0; j < chunk.length; j++) {
          const rn = chunk[j];
          const result = results[j];

          if (result.valid) {
            saveState.fullResults[rollCode][rn] = result.data;
            existingRollNos.add(String(rn));

            saveState.savedThisRun++;
            saveState.totalStudentsSaved++;
            newSaved++;

            console.log(`${rollCode}-${rn} saved`);
          }
        }
      }

      current = batchEnd + 1;
    }
  }

  console.log(`✅ ${rollCode} | New: ${newSaved} | Total: ${Object.keys(saveState.fullResults[rollCode]).length}`);
}

// ===============================
// MAIN
// ===============================
(async () => {
  console.log("🚀 START");

  const rollCodes = loadValidRollCodes();
  if (!rollCodes.length) {
    console.log("❌ No roll codes");
    return;
  }

  saveState.fullResults = loadJSON(OUTPUT_FILE, {});
  saveState.totalStudentsSaved = countTotalStudentsSaved(saveState.fullResults);

  console.log(`📦 Existing: ${saveState.totalStudentsSaved}`);

  for (let i = 0; i < rollCodes.length; i += ROLLCODE_PARALLEL) {
    const chunk = rollCodes.slice(i, i + ROLLCODE_PARALLEL);

    console.log(`🚀 Group: ${chunk.join(", ")}`);

    await Promise.all(chunk.map(rc => processRollCode(rc)));

    saveCustomJSON(OUTPUT_FILE, saveState.fullResults);

    console.log(`💾 Saved Progress | This Run: ${saveState.savedThisRun}`);
  }

  saveCustomJSON(OUTPUT_FILE, saveState.fullResults);

  console.log("🎉 DONE");
  console.log(`🆕 This Run: ${saveState.savedThisRun}`);
  console.log(`📦 Total: ${saveState.totalStudentsSaved}`);
})();
