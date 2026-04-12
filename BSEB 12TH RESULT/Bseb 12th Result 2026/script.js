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
// MULTI RANGE (AUTO)
// ===============================
const ROLL_RANGES = [
  [26010001, 26010999],
  [26020001, 26020999],
  [26030001, 26030999],
  [26040001, 26040999],
  [26050001, 26050999],
];

// ===============================
const VALID_ROLL_CODE_FILE = path.join(ROOT_DIR, "bseb-12th-college-list-2026.json");
const OUTPUT_FILE = path.join(BASE_DIR, OUTPUT_FILE_NAME);

// ===============================
const ROLLCODE_PARALLEL = 20;
const CONCURRENCY = 200;
const BATCH_SIZE = 200;
const REQUEST_TIMEOUT = 5000;
const SAVE_EVERY_VALID_RESULTS = 100;

// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 0,
  validateStatus: () => true,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Connection": "keep-alive"
  }
});

// ===============================
// HELPERS
// ===============================
const clean = txt => (txt || "").replace(/\s+/g, " ").trim();

function loadJSON(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveCustomJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data));
}

function countTotalStudentsSaved(data) {
  let total = 0;
  for (const rc of Object.keys(data)) {
    total += Object.keys(data[rc] || {}).length;
  }
  return total;
}

// ===============================
// FETCH TOKEN
// ===============================
async function getSessionData() {
  const res = await client.get(BASE_URL);
  const $ = cheerio.load(res.data);

  const token = $('input[name="__RequestVerificationToken"]').val();

  return {
    cookie: (res.headers["set-cookie"] || []).map(c => c.split(";")[0]).join("; "),
    token
  };
}

// ===============================
// FETCH RESULT (REAL)
// ===============================
async function fetchStudentResult(rollCode, rollNo, session) {
  try {
    const payload = new URLSearchParams();
    payload.append("rollcode", rollCode);
    payload.append("rollno", rollNo);
    payload.append("captcha", Math.floor(Math.random() * 900000 + 100000));
    payload.append("__RequestVerificationToken", session.token);

    const res = await client.post(POST_URL, payload.toString(), {
      headers: {
        Cookie: session.cookie,
        "Content-Type": "application/x-www-form-urlencoded"
      }
    });

    const html = res.data;
    const $ = cheerio.load(html);

    const name = clean($("td:contains('Student')").next().text());

    if (!name) return { valid: false };

    return {
      valid: true,
      data: {
        rollCode,
        rollNo,
        studentName: name
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
  const all = Object.keys(raw);

  const filtered = all.filter(rc => rc.startsWith(DISTRICT_PREFIX));

  console.log(`📚 College list total roll codes: ${all.length}`);
  console.log(`🔍 Matching prefix ${DISTRICT_PREFIX}: ${filtered.length}`);
  console.log(`🔹 First 10 matching: ${filtered.slice(0, 10).join(", ") || "none"}`);

  return filtered;
}

// ===============================
const state = {
  data: {},
  total: 0,
  newSaved: 0,
  buffer: 0
};

// ===============================
async function processRollCode(rollCode) {
  if (!state.data[rollCode]) state.data[rollCode] = {};

  const existing = new Set(Object.keys(state.data[rollCode]));
  const already = existing.size;
  let newCount = 0;

  console.log(`▶️ ${rollCode} | Already Saved: ${already}`);

  let session = await getSessionData();

  for (const [START, END] of ROLL_RANGES) {
    console.log(`Starting range: ${START}-${END}`);

    for (let rn = START; rn <= END; rn += BATCH_SIZE) {
      const batch = [];

      for (let i = rn; i < rn + BATCH_SIZE && i <= END; i++) {
        if (!existing.has(String(i))) batch.push(i);
      }

      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);

        const results = await Promise.all(
          chunk.map(rn => fetchStudentResult(rollCode, rn, session))
        );

        results.forEach((res, idx) => {
          const rn = chunk[idx];
          if (res.valid && !state.data[rollCode][rn]) {
            state.data[rollCode][rn] = res.data;

            existing.add(String(rn));
            state.newSaved++;
            state.total++;
            state.buffer++;
            newCount++;

            console.log(`${rollCode}-${rn} student saved`);
          }
        });

        if (state.buffer >= SAVE_EVERY_VALID_RESULTS) {
          saveCustomJSON(OUTPUT_FILE, state.data);
          console.log(`💾 Progress Saved | This Run: ${state.newSaved} | File Total: ${state.total}`);
          state.buffer = 0;
        }
      }
    }

    console.log(`Range: ${START}-${END} complete.`);
  }

  console.log(`✅ ${rollCode} | Already: ${already} | New: ${newCount} | Total: ${Object.keys(state.data[rollCode]).length}`);
}

// ===============================
(async () => {
  console.log("🚀 BSEB 12TH DISTRICT SCRAPER STARTED");
  console.log(`📁 District File: ${OUTPUT_FILE_NAME}`);
  console.log(`🔢 Prefix: ${DISTRICT_PREFIX}`);
  console.log(`📂 College List Path: ${VALID_ROLL_CODE_FILE}`);
  console.log(`📂 Output File Path: ${OUTPUT_FILE}`);

  const rollCodes = loadValidRollCodes();

  if (!rollCodes.length) {
    console.log("❌ No valid roll codes found");
    return;
  }

  state.data = loadJSON(OUTPUT_FILE, {});
  state.total = countTotalStudentsSaved(state.data);

  console.log(`📦 Already in district file: ${state.total}`);
  console.log(`⚡ Parallel Roll Codes: ${ROLLCODE_PARALLEL}`);
  console.log(`⚡ RollNo Concurrency per Roll Code: ${CONCURRENCY}`);

  for (let i = 0; i < rollCodes.length; i += ROLLCODE_PARALLEL) {
    const chunk = rollCodes.slice(i, i + ROLLCODE_PARALLEL);

    console.log(`🚀 Roll code group: ${chunk.join(", ")}`);

    await Promise.all(chunk.map(processRollCode));

    saveCustomJSON(OUTPUT_FILE, state.data);

    console.log(
      `💾 Group Saved | Completed: ${Math.min(i + ROLLCODE_PARALLEL, rollCodes.length)}/${rollCodes.length} | This Run: ${state.newSaved} | File Total: ${state.total}`
    );
  }

  saveCustomJSON(OUTPUT_FILE, state.data);

  console.log("🎉 SCRAPE COMPLETED");
  console.log(`🆕 Total Saved This Run: ${state.newSaved}`);
  console.log(`📦 Final Total In File: ${state.total}`);
})();
