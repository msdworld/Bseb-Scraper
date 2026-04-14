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
// FILES
// ===============================
const COLLEGE_FILE = path.join(ROOT_DIR, "bseb-12th-college-list-2026.json");
const OUTPUT_FILE = path.join(ROOT_DIR, "bseb-12th-roll-code-list.json");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";

const START_ROLLCODE = 11001;
const END_ROLLCODE = 99999;

// Only check small roll sample
const TEST_ROLLNOS = [
  26010001, 26010005, 26010010, 26010020, 26010030, 26010040, 26010050,
  26020001, 26020005, 26020010, 26020020, 26020030, 26020040, 26020050,
  26030001, 26030005, 26030010, 26030020, 26030030, 26030040, 26030050,
  26040001, 26040005, 26040010, 26040020, 26040030, 26040040, 26040050,
  26050001, 26050005, 26050010, 26050020, 26050030, 26050040, 26050050,
  26060001, 26060005, 26060010, 26060020, 26060030, 26060040, 26060050,
  26070001, 26070005, 26070010, 26070020, 26070030, 26070040, 26070050,
  26080001, 26080005, 26080010, 26080020, 26080030, 26080040, 26080050,
  26090001, 26090005, 26090010, 26090020, 26090030, 26090040, 26090050
];

// SPEED
const CONCURRENCY = 100;
const REQUEST_TIMEOUT = 5000;

// ===============================
// AXIOS
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 0,
  validateStatus: () => true,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Content-Type": "application/x-www-form-urlencoded"
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

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ===============================
// SESSION
// ===============================
async function getSession() {
  const res = await client.get(BASE_URL);

  const cookies = (res.headers["set-cookie"] || [])
    .map(c => c.split(";")[0])
    .join("; ");

  const $ = cheerio.load(res.data);
  const token = clean($('input[name="__RequestVerificationToken"]').val());

  return { cookies, token };
}

// ===============================
// CHECK ROLL CODE (STRICT VALID)
// ===============================
async function checkRollCode(rollCode, rollNo, session) {
  try {
    const payload = new URLSearchParams();
    payload.append("rollcode", String(rollCode));
    payload.append("rollno", String(rollNo));
    payload.append("captcha", generateCaptcha());
    payload.append("__RequestVerificationToken", session.token);

    const res = await client.post(POST_URL, payload.toString(), {
      headers: {
        Cookie: session.cookies,
        Referer: BASE_URL
      }
    });

    const html = res.data;
    const $ = cheerio.load(html);

    const studentName = clean(
      $("td:contains('Student')").next().text()
    );

    const rc = clean(
      $("td:contains('Roll Code')").next().text()
    );

    // ✅ STRICT VALIDATION
    if (studentName && rc === String(rollCode)) {
      return { valid: true, name: studentName };
    }

    return { valid: false };

  } catch {
    return { valid: false };
  }
}

// ===============================
// MAIN
// ===============================
(async () => {
  console.log("🚀 Roll Code Finder Started");

  const collegeData = loadJSON(COLLEGE_FILE, {});
  const outputData = loadJSON(OUTPUT_FILE, {});

  console.log(`📚 Existing college list: ${Object.keys(collegeData).length}`);
  console.log(`📦 Already found new: ${Object.keys(outputData).length}`);

  const session = await getSession();

  for (let rollCode = START_ROLLCODE; rollCode <= END_ROLLCODE; rollCode++) {

    // Skip if already known
    if (collegeData[rollCode] || outputData[rollCode]) {
      const name = collegeData[rollCode] || outputData[rollCode];
      console.log(`🆗 ${rollCode}: ${name} | Already exists`);
      continue;
    }

    let found = null;

    // Test multiple rollnos
    for (let i = 0; i < TEST_ROLLNOS.length; i += CONCURRENCY) {
      const chunk = TEST_ROLLNOS.slice(i, i + CONCURRENCY);

      const results = await Promise.all(
        chunk.map(rn => checkRollCode(rollCode, rn, session))
      );

      for (const res of results) {
        if (res.valid) {
          found = res;
          break;
        }
      }

      if (found) break;
    }

    if (found) {
      outputData[rollCode] = found.name;

      console.log(`✅ ${rollCode}: ${found.name} | New Saved`);

      saveJSON(OUTPUT_FILE, outputData);
    } else {
      console.log(`❌ ${rollCode}: Invalid`);
    }
  }

  console.log("🎉 Roll Code Finding Completed");
})();
