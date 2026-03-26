const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/Default.html";
const POST_URL = "https://interbiharboard.com/Result.aspx";

const START_ROLL_CODE = 31000;
const END_ROLL_CODE = 99999;

const TEST_ROLL_NUMBERS = [
  "26010011",
  "26010023",
  "26010035",
  "26010047"
];

const OUTPUT_FILE = "bseb-12th-college-list-2026.json";
const PROGRESS_FILE = "progress.txt";

// Speed controls
const CONCURRENCY = 500;
const BATCH_SIZE = 1000;
const REQUEST_TIMEOUT = 5000;

// Save controls
const SAVE_EVERY_VALID = 20;

// ===============================
// AXIOS CLIENT
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 5,
  validateStatus: () => true,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1"
  }
});

// ===============================
// HELPERS
// ===============================
function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

function getHidden($, id) {
  return clean($(`#${id}`).val() || "");
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

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return START_ROLL_CODE;
  const num = parseInt(fs.readFileSync(PROGRESS_FILE, "utf8").trim(), 10);
  return isNaN(num) ? START_ROLL_CODE : num;
}

function saveProgress(rollCode) {
  fs.writeFileSync(PROGRESS_FILE, String(rollCode));
}

function extractResultData(html) {
  const $ = cheerio.load(html);

  const data = {
    studentName: null,
    schoolName: null,
    rollCode: null,
    rollNo: null,
    bsebUniqueId: null
  };

  $("table tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length === 2) {
      const key = clean($(tds[0]).text()).toLowerCase();
      const value = clean($(tds[1]).text());

      if (key.includes("student")) data.studentName = value;
      if (key.includes("school") || key.includes("college")) data.schoolName = value;
      if (key === "roll code") data.rollCode = value;
      if (key === "roll number") data.rollNo = value;
      if (key.includes("unique")) data.bsebUniqueId = value;
    }
  });

  return data;
}

// ===============================
// FETCH SESSION / TOKENS
// ===============================
async function getSessionData() {
  const res = await client.get(BASE_URL);

  const html = res.data;
  const $ = cheerio.load(html);

  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

  const VIEWSTATE = getHidden($, "__VIEWSTATE");
  const VIEWSTATEGENERATOR = getHidden($, "__VIEWSTATEGENERATOR");
  const EVENTVALIDATION = getHidden($, "__EVENTVALIDATION");

  if (!VIEWSTATE || !EVENTVALIDATION) {
    throw new Error("Could not fetch ASP.NET hidden fields");
  }

  return {
    cookieHeader,
    VIEWSTATE,
    VIEWSTATEGENERATOR,
    EVENTVALIDATION
  };
}

// ===============================
// CHECK ONE ROLL CODE
// ===============================
async function checkRollCode(rollCode, sessionData) {
  for (const rollNumber of TEST_ROLL_NUMBERS) {
    try {
      const payload = new URLSearchParams();
      payload.append("__EVENTTARGET", "");
      payload.append("__EVENTARGUMENT", "");
      payload.append("__VIEWSTATE", sessionData.VIEWSTATE);
      payload.append("__VIEWSTATEGENERATOR", sessionData.VIEWSTATEGENERATOR);
      payload.append("__EVENTVALIDATION", sessionData.EVENTVALIDATION);
      payload.append("mobile", String(rollCode));
      payload.append("password", rollNumber);
      payload.append("captchaInput", generateCaptcha());
      payload.append("btn_login", "View Result");

      const res = await client.post(POST_URL, payload.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Cookie": sessionData.cookieHeader,
          "Referer": BASE_URL,
          "Origin": "https://interbiharboard.com"
        }
      });

      const html = String(res.data || "").toLowerCase();

      if (
        html.includes("invalid") ||
        html.includes("no record") ||
        html.includes("not found")
      ) {
        continue;
      }

      const result = extractResultData(res.data);

      if (
        result.schoolName &&
        result.rollCode === String(rollCode) &&
        result.rollNo === rollNumber
      ) {
        return {
          valid: true,
          schoolName: result.schoolName
        };
      }
    } catch (err) {
      // ignore individual request error
    }
  }

  return { valid: false };
}

// ===============================
// MAIN
// ===============================
(async () => {
  const validColleges = loadJSON(OUTPUT_FILE, {});
  let current = loadProgress();
  let unsavedValidCount = 0;
  let totalFoundThisRun = 0;

  console.log(`🚀 Starting from: ${current}`);

  while (current <= END_ROLL_CODE) {
    try {
      console.log(`\n🔄 New batch starting from ${current}...`);
      const sessionData = await getSessionData();

      const batchEnd = Math.min(current + BATCH_SIZE - 1, END_ROLL_CODE);
      let batchRollCodes = [];

      for (let i = current; i <= batchEnd; i++) {
        batchRollCodes.push(i);
      }

      for (let i = 0; i < batchRollCodes.length; i += CONCURRENCY) {
        const chunk = batchRollCodes.slice(i, i + CONCURRENCY);

        console.log(`Checking: ${chunk.join(", ")}`);

        const results = await Promise.all(
          chunk.map(rc => checkRollCode(rc, sessionData))
        );

        for (let j = 0; j < chunk.length; j++) {
          const rc = chunk[j];
          const result = results[j];

          if (result.valid) {
            if (!validColleges[rc]) {
              validColleges[rc] = result.schoolName;
              unsavedValidCount++;
              totalFoundThisRun++;

              console.log(`✅ Found: ${rc} - ${result.schoolName}`);
            }
          }
        }

        // Save progress after every chunk
        saveProgress(chunk[chunk.length - 1] + 1);

        // Save JSON only after every 20 new valid roll codes
        if (unsavedValidCount >= SAVE_EVERY_VALID) {
          saveJSON(OUTPUT_FILE, validColleges);
          console.log(`💾 Saved ${unsavedValidCount} new valid roll codes to JSON`);
          console.log(`📁 Total valid roll codes saved: ${Object.keys(validColleges).length}`);
          unsavedValidCount = 0;
        }
      }

      // Save at end of every batch too (important safety)
      if (unsavedValidCount > 0) {
        saveJSON(OUTPUT_FILE, validColleges);
        console.log(`💾 Batch-end save: ${unsavedValidCount} new valid roll codes saved`);
        console.log(`📁 Total valid roll codes saved: ${Object.keys(validColleges).length}`);
        unsavedValidCount = 0;
      }

      current = batchEnd + 1;

    } catch (err) {
      console.log(`❌ Batch error at ${current}: ${err.message}`);
      console.log("⏳ Retrying next batch...");
    }
  }

  // Final save safety
  saveJSON(OUTPUT_FILE, validColleges);
  saveProgress(current);

  console.log("\n🎉 Finished checking all roll codes.");
  console.log(`📊 Total new valid roll codes found this run: ${totalFoundThisRun}`);
  console.log(`📁 Final total valid roll codes: ${Object.keys(validColleges).length}`);
})();
