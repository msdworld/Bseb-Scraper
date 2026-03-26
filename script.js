const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

const BASE_URL = "http://interbiharboard.com/Default.html";
const POST_URL = "http://interbiharboard.com/Default.html";

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

// =========================
// LOAD OLD DATA
// =========================
let savedData = {};
if (fs.existsSync(OUTPUT_FILE)) {
  try {
    savedData = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
  } catch {
    savedData = {};
  }
}

let currentRollCode = START_ROLL_CODE;
if (fs.existsSync(PROGRESS_FILE)) {
  const savedProgress = parseInt(fs.readFileSync(PROGRESS_FILE, "utf8").trim(), 10);
  if (!isNaN(savedProgress) && savedProgress >= START_ROLL_CODE && savedProgress <= END_ROLL_CODE) {
    currentRollCode = savedProgress;
  }
}

console.log(`🚀 Starting from roll code: ${currentRollCode}`);

// =========================
// SESSION / COOKIES
// =========================
let cookieJar = "";

function updateCookies(setCookieHeaders = []) {
  const cookies = setCookieHeaders.map(c => c.split(";")[0]);
  if (cookies.length) {
    cookieJar = cookies.join("; ");
  }
}

async function getFormData() {
  const res = await axios.get(BASE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html,application/xhtml+xml"
    },
    timeout: 15000,
    validateStatus: () => true
  });

  updateCookies(res.headers["set-cookie"] || []);

  const $ = cheerio.load(res.data);

  const viewState = $("#__VIEWSTATE").val() || "";
  const eventValidation = $("#__EVENTVALIDATION").val() || "";
  const viewStateGenerator = $("#__VIEWSTATEGENERATOR").val() || "";

  // captcha extraction
  let captchaValue = $("#generatedCaptcha").attr("data-value") || "";
  if (!captchaValue) {
    captchaValue = $("#generatedCaptcha").text().trim();
  }

  return {
    viewState,
    eventValidation,
    viewStateGenerator,
    captchaValue
  };
}

async function checkStudent(rollCode, rollNumber) {
  try {
    const formData = await getFormData();

    if (!formData.viewState || !formData.eventValidation) {
      return { error: true, message: "Hidden ASP.NET fields not found" };
    }

    const payload = new URLSearchParams();
    payload.append("__VIEWSTATE", formData.viewState);
    payload.append("__VIEWSTATEGENERATOR", formData.viewStateGenerator);
    payload.append("__EVENTVALIDATION", formData.eventValidation);

    payload.append("mobile", String(rollCode));
    payload.append("password", String(rollNumber));
    payload.append("captchaInput", formData.captchaValue);
    payload.append("btn_login", "Submit");

    const res = await axios.post(POST_URL, payload.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookieJar,
        "Referer": BASE_URL,
        "Origin": "http://interbiharboard.com"
      },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true
    });

    const html = res.data;
    const text = String(html).toLowerCase();

    if (
      text.includes("invalid") ||
      text.includes("roll code not found") ||
      text.includes("not found") ||
      text.includes("please enter valid")
    ) {
      return { found: false };
    }

    const $ = cheerio.load(html);

    let schoolName = null;

    $("table tr").each((_, row) => {
      const tds = $(row).find("td");
      if (tds.length === 2) {
        const key = $(tds[0]).text().replace(/\s+/g, " ").trim().toLowerCase();
        const value = $(tds[1]).text().replace(/\s+/g, " ").trim();

        if (key.includes("school") || key.includes("college")) {
          schoolName = value;
        }
      }
    });

    if (schoolName && schoolName.length > 2) {
      return {
        found: true,
        schoolName
      };
    }

    return { found: false };
  } catch (err) {
    return { error: true, message: err.message };
  }
}

// =========================
// MAIN LOOP
// =========================
(async () => {
  for (let rollCode = currentRollCode; rollCode <= END_ROLL_CODE; rollCode++) {
    console.log(`🔍 Checking: ${rollCode}`);
    fs.writeFileSync(PROGRESS_FILE, String(rollCode));

    let found = false;

    for (const rollNumber of TEST_ROLL_NUMBERS) {
      const result = await checkStudent(rollCode, rollNumber);

      if (result.error) {
        console.log(`⚠️ Error ${rollCode}-${rollNumber}: ${result.message}`);
        continue;
      }

      if (result.found) {
        savedData[String(rollCode)] = result.schoolName;
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(savedData, null, 2));

        console.log(`✅ SAVED: ${rollCode} - ${result.schoolName}`);
        found = true;
        break;
      }
    }

    // optional small pause every 100 checks
    if (rollCode % 100 === 0) {
      console.log("⏳ Cooldown 2 sec...");
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log("🎉 DONE");
})();
