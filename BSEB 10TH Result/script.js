const axios = require("axios");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const API_URL = "https://resultapi.biharboardonline.org/result";
const OUTPUT_FILE = "bseb-10th-school-list-2026.json";

const ROLLCODE_START = 10000;
const ROLLCODE_END = 99999;

const IMPORTANT_ROLLNOS = [
  2600007,
  2600019,
  2600026,
  2600037,
  2600059,
  2600081,
  2600108,
  2600137,
  2600071,
  2600044
];

// SPEED
const ROLLCODE_PARALLEL = 200; // roll codes together
const REQUEST_TIMEOUT = 6000;

// SAVE
const SAVE_EVERY_NEW = 50;

// ===============================
// AXIOS
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://result.biharboardonline.org/",
    "Origin": "https://result.biharboardonline.org"
  }
});

// ===============================
// HELPERS
// ===============================
function clean(txt) {
  return (txt || "").toString().replace(/\s+/g, " ").trim();
}

function loadJSON(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJSON(file, data) {
  const ordered = {};
  Object.keys(data)
    .sort((a, b) => Number(a) - Number(b))
    .forEach(k => {
      ordered[k] = data[k];
    });

  fs.writeFileSync(file, JSON.stringify(ordered, null, 2), "utf8");
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
      },
      validateStatus: () => true
    });

    const body = res.data;

    if (!body || body.success !== true || !body.data) {
      return { valid: false };
    }

    const data = body.data;

    if (
      clean(data.roll_code) === String(rollCode) &&
      clean(data.roll_no) === String(rollNo) &&
      clean(data.school_name)
    ) {
      return {
        valid: true,
        schoolName: clean(data.school_name)
      };
    }

    return { valid: false };
  } catch {
    return { valid: false };
  }
}

// ===============================
// CHECK ONE ROLL CODE
// ===============================
async function checkRollCode(rollCode) {
  if (saveState.schoolList[rollCode]) {
    console.log(`⏭️ ${rollCode} | Already saved`);
    return;
  }

  const checks = await Promise.all(
    IMPORTANT_ROLLNOS.map(rn => fetchResult(rollCode, rn))
  );

  for (const result of checks) {
    if (result.valid) {
      saveState.schoolList[rollCode] = result.schoolName;
      saveState.newFound++;
      saveState.totalSaved++;

      console.log(`✅ ${rollCode} | ${result.schoolName}`);
      return;
    }
  }

  console.log(`⚠️ ${rollCode} | Invalid`);
}

// ===============================
// GLOBAL STATE
// ===============================
const saveState = {
  schoolList: {},
  totalSaved: 0,
  newFound: 0
};

// ===============================
// MAIN
// ===============================
(async () => {
  saveState.schoolList = loadJSON(OUTPUT_FILE, {});
  saveState.totalSaved = Object.keys(saveState.schoolList).length;

  console.log("🚀 BSEB 10TH ROLL CODE FINDER STARTED");
  console.log(`📦 Range: ${ROLLCODE_START} to ${ROLLCODE_END}`);
  console.log(`📦 Already saved roll codes: ${saveState.totalSaved}`);
  console.log(`⚡ Parallel Roll Codes: ${ROLLCODE_PARALLEL}`);
  console.log(`🎯 Test Roll Numbers: ${IMPORTANT_ROLLNOS.join(", ")}`);

  const allRollCodes = [];
  for (let rc = ROLLCODE_START; rc <= ROLLCODE_END; rc++) {
    allRollCodes.push(String(rc));
  }

  for (let i = 0; i < allRollCodes.length; i += ROLLCODE_PARALLEL) {
    const chunk = allRollCodes.slice(i, i + ROLLCODE_PARALLEL);

    console.log(`🚀 Roll code group: ${chunk[0]} to ${chunk[chunk.length - 1]}`);

    await Promise.all(chunk.map(rc => checkRollCode(rc)));

    if (saveState.newFound >= SAVE_EVERY_NEW) {
      saveJSON(OUTPUT_FILE, saveState.schoolList);
      console.log(`💾 Progress Saved | Total Roll Codes Saved: ${saveState.totalSaved}`);
      saveState.newFound = 0;
    }

    saveJSON(OUTPUT_FILE, saveState.schoolList);
    console.log(
      `💾 Group Saved | Completed: ${Math.min(i + ROLLCODE_PARALLEL, allRollCodes.length)}/${allRollCodes.length} | Total Saved: ${saveState.totalSaved}`
    );
  }

  saveJSON(OUTPUT_FILE, saveState.schoolList);

  console.log(`🎉 COMPLETED | Total Valid Roll Codes Saved: ${saveState.totalSaved}`);
})();
