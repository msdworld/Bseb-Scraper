const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ===============================
// PATH SETUP
// ===============================
const ROOT_DIR = path.resolve(__dirname, "..", ".."); // main repo
const BASE_DIR = __dirname;

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";

const DISTRICT_PREFIX = "51"; // change when needed

// ===============================
// FILES (ROOT LEVEL)
// ===============================
const COLLEGE_FILE = path.join(ROOT_DIR, "bseb-12th-college-list-2026.json");
const OUTPUT_FILE = path.join(ROOT_DIR, "bseb-12th-roll-code-list.json");

// ===============================
// ROLLNO TEST RANGES
// ===============================
const RANGES = [
  [26010001, 26010050],
  [26020001, 26020050],
  [26030001, 26030050],
  [26040001, 26040050],
  [26050001, 26050050],
  [26060001, 26060050],
  [26070001, 26070050],
  [26080001, 26080050],
  [26090001, 26090050]
];

// ===============================
// AXIOS
// ===============================
const client = axios.create({
  timeout: 5000,
  validateStatus: () => true,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Content-Type": "application/x-www-form-urlencoded"
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
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function extractToken(html) {
  const $ = cheerio.load(html);
  return $('input[name="__RequestVerificationToken"]').val() || "";
}

// ===============================
// SESSION
// ===============================
async function getSession() {
  const res = await client.get(BASE_URL);

  const cookie = (res.headers["set-cookie"] || [])
    .map(c => c.split(";")[0])
    .join("; ");

  const token = extractToken(res.data);

  return { cookie, token };
}

// ===============================
// CHECK VALID
// ===============================
async function checkRollCode(rollCode, rollNo, session) {
  try {
    const payload = new URLSearchParams();
    payload.append("rollcode", rollCode);
    payload.append("rollno", rollNo);
    payload.append("captcha", "123456");
    payload.append("__RequestVerificationToken", session.token);

    const res = await client.post(POST_URL, payload.toString(), {
      headers: {
        Cookie: session.cookie,
        Referer: BASE_URL
      }
    });

    const html = String(res.data || "").toLowerCase();

    if (
      html.includes("student") &&
      html.includes("roll code") &&
      html.includes("roll number")
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

// ===============================
// MAIN
// ===============================
(async () => {
  console.log("🚀 ROLL CODE FINDER STARTED");
  console.log(`🔢 Prefix: ${DISTRICT_PREFIX}`);

  const collegeList = loadJSON(COLLEGE_FILE, {});
  const existingCodes = new Set(Object.keys(collegeList));

  const outputData = loadJSON(OUTPUT_FILE, {});
  const newCodes = new Set(Object.keys(outputData));

  console.log(`📚 Already in college list: ${existingCodes.size}`);
  console.log(`📂 Already found new codes: ${newCodes.size}`);

  const session = await getSession();

  let found = 0;

  for (let rc = Number(DISTRICT_PREFIX) * 1000; rc < Number(DISTRICT_PREFIX) * 1000 + 999; rc++) {
    const rollCode = String(rc);

    if (existingCodes.has(rollCode) || newCodes.has(rollCode)) continue;

    for (const [start, end] of RANGES) {
      let isValid = false;

      for (let rn = start; rn <= end; rn++) {
        const ok = await checkRollCode(rollCode, rn, session);

        if (ok) {
          isValid = true;
          break;
        }
      }

      if (isValid) {
        outputData[rollCode] = "Unknown College";
        newCodes.add(rollCode);
        found++;

        console.log(`✅ New RollCode Found: ${rollCode}`);

        saveJSON(OUTPUT_FILE, outputData);
        break;
      }
    }
  }

  console.log("🎉 DONE");
  console.log(`🆕 New Roll Codes Found: ${found}`);
})();
