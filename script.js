const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/Default.html";
const POST_URL = "https://interbiharboard.com/Result.aspx";

const START_ROLL_CODE = 11001;
const END_ROLL_CODE = 99999;

const TEST_ROLL_NUMBERS = [
  "26010011",
  "26010023",
  "26010035",
  "26010047"
];

const OUTPUT_FILE = "bseb-12th-college-list-2026.json";
const PROGRESS_FILE = "progress.txt";

// ===============================
// AXIOS
// ===============================
const client = axios.create({
  timeout: 15000,
  maxRedirects: 3,
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

function loadJson(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return START_ROLL_CODE;
  const n = parseInt(fs.readFileSync(PROGRESS_FILE, "utf8").trim(), 10);
  return Number.isFinite(n) ? n : START_ROLL_CODE;
}

function saveProgress(rollCode) {
  fs.writeFileSync(PROGRESS_FILE, String(rollCode));
}

function extractResultData(html) {
  const $ = cheerio.load(html);

  const data = {
    studentName: null,
    fatherName: null,
    motherName: null,
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
      if (key.includes("father")) data.fatherName = value;
      if (key.includes("mother")) data.motherName = value;
      if (key.includes("school") || key.includes("college")) data.schoolName = value;
      if (key === "roll code") data.rollCode = value;
      if (key === "roll number") data.rollNo = value;
      if (key.includes("unique")) data.bsebUniqueId = value;
    }
  });

  return data;
}

// ===============================
// GET FORM TOKENS
// ===============================
async function getFormSession() {
  const getRes = await client.get(BASE_URL);

  const html = getRes.data;
  const $ = cheerio.load(html);

  const rawCookies = getRes.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

  const VIEWSTATE = getHidden($, "__VIEWSTATE");
  const VIEWSTATEGENERATOR = getHidden($, "__VIEWSTATEGENERATOR");
  const EVENTVALIDATION = getHidden($, "__EVENTVALIDATION");

  if (!VIEWSTATE || !EVENTVALIDATION) {
    throw new Error("Hidden fields missing");
  }

  return {
    cookieHeader,
    VIEWSTATE,
    VIEWSTATEGENERATOR,
    EVENTVALIDATION
  };
}

// ===============================
// CHECK ONE STUDENT
// ===============================
async function checkStudent(session, rollCode, rollNumber) {
  const payload = new URLSearchParams();
  payload.append("__EVENTTARGET", "");
  payload.append("__EVENTARGUMENT", "");
  payload.append("__VIEWSTATE", session.VIEWSTATE);
  payload.append("__VIEWSTATEGENERATOR", session.VIEWSTATEGENERATOR);
  payload.append("__EVENTVALIDATION", session.EVENTVALIDATION);
  payload.append("mobile", String(rollCode));
  payload.append("password", String(rollNumber));
  payload.append("captchaInput", generateCaptcha());
  payload.append("btn_login", "View Result");

  const postRes = await client.post(POST_URL, payload.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": session.cookieHeader,
      "Referer": BASE_URL,
      "Origin": "https://interbiharboard.com"
    }
  });

  const result = extractResultData(postRes.data);

  if (result.schoolName && result.rollCode && result.rollNo) {
    return result;
  }

  return null;
}

// ===============================
// MAIN
// ===============================
(async () => {
  let validRollCodes = loadJson(OUTPUT_FILE, {});
  let current = loadProgress();

  console.log(`🚀 Starting from roll code: ${current}`);

  for (let rollCode = current; rollCode <= END_ROLL_CODE; rollCode++) {
    console.log(`Checking: ${rollCode}`);

    // Already saved? skip
    if (validRollCodes[String(rollCode)]) {
      saveProgress(rollCode + 1);
      continue;
    }

    let found = false;

    for (const rollNumber of TEST_ROLL_NUMBERS) {
      try {
        const session = await getFormSession();
        const result = await checkStudent(session, rollCode, rollNumber);

        if (result) {
          validRollCodes[String(rollCode)] = result.schoolName;
          saveJson(OUTPUT_FILE, validRollCodes);

          console.log(`✅ Saved: ${rollCode} - ${result.schoolName}`);
          found = true;
          break;
        }
      } catch (err) {
        console.log(`⚠ Error on ${rollCode} / ${rollNumber}: ${err.message}`);
      }
    }

    if (!found) {
      console.log(`❌ Not found: ${rollCode}`);
    }

    saveProgress(rollCode + 1);
  }

  console.log("🎉 Done! All roll codes checked.");
})();
