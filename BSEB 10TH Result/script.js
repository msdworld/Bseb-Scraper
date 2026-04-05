const axios = require("axios");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const API_URL = "https://resultapi.biharboardonline.org/result";
const OUTPUT_FILE = "bseb-10th-school-list-2026.json";

const ROLLCODE_START = 10000;
const ROLLCODE_END = 99999;

// Important roll numbers to test for each roll code
const TEST_ROLLNOS = [
  2600007,
  2600019,
  2600026,
  2600037,
  2600044,
  2600059,
  2600071,
  2600081,
  2600108,
  2600137
];

// SPEED
const ROLLCODE_PARALLEL = 1000;   // how many roll codes at once
const REQUEST_TIMEOUT = 6000;
const SAVE_EVERY = 100;

// ===============================
// AXIOS CLIENT
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://result.biharboardonline.org/",
    "Origin": "https://result.biharboardonline.org"
  }
});

// ===============================
// HELPERS
// ===============================
function loadJSON(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  const sorted = Object.keys(data)
    .sort((a, b) => Number(a) - Number(b))
    .reduce((obj, key) => {
      obj[key] = data[key];
      return obj;
    }, {});

  fs.writeFileSync(file, JSON.stringify(sorted, null, 2), "utf8");
}

function clean(txt) {
  return String(txt || "").replace(/\s+/g, " ").trim();
}

// ===============================
// FETCH ONE RESULT
// ===============================
async function fetchResult(rollCode, rollNo) {
  try {
    const res = await client.get(API_URL, {
      params: {
        roll_code: String(rollCode),
        roll_no: String(rollNo)
      }
    });

    if (!res.data || !res.data.success || !res.data.data) {
      return null;
    }

    return res.data.data;
  } catch {
    return null;
  }
}

// ===============================
// CHECK ONE ROLL CODE
// ===============================
async function checkRollCode(rollCode) {
  for (const rollNo of TEST_ROLLNOS) {
    const result = await fetchResult(rollCode, rollNo);

    if (result && result.school_name) {
      return clean(result.school_name);
    }
  }
  return null;
}

// ===============================
// MAIN
// ===============================
(async () => {
  const schoolData = loadJSON(OUTPUT_FILE, {});
  let totalSaved = Object.keys(schoolData).length;
  let unsavedCount = 0;

  console.log("🚀 BSEB 10TH SCHOOL LIST SCRAPER STARTED");
  console.log(`📦 Already saved roll codes: ${totalSaved}`);
  console.log(`⚡ Parallel Roll Codes: ${ROLLCODE_PARALLEL}`);

  const allRollCodes = [];
  for (let rc = ROLLCODE_START; rc <= ROLLCODE_END; rc++) {
    allRollCodes.push(String(rc));
  }

  for (let i = 0; i < allRollCodes.length; i += ROLLCODE_PARALLEL) {
    const chunk = allRollCodes.slice(i, i + ROLLCODE_PARALLEL);

    const results = await Promise.all(
      chunk.map(async (rollCode) => {
        if (schoolData[rollCode]) return null; // already saved
        const schoolName = await checkRollCode(rollCode);
        return { rollCode, schoolName };
      })
    );

    for (const item of results) {
      if (!item || !item.schoolName) continue;

      schoolData[item.rollCode] = item.schoolName;
      totalSaved++;
      unsavedCount++;

      console.log(`✅ ${item.rollCode} | Saved | Total: ${totalSaved}`);
    }

    if (unsavedCount >= SAVE_EVERY) {
      saveJSON(OUTPUT_FILE, schoolData);
      console.log(`💾 Progress Saved | Total Valid Roll Codes: ${totalSaved}`);
      unsavedCount = 0;
    }
  }

  saveJSON(OUTPUT_FILE, schoolData);

  console.log("🎉 SCHOOL LIST SCRAPE COMPLETED");
  console.log(`📚 Final Total Valid Roll Codes: ${totalSaved}`);
})();
