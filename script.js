const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";

// 👉 PUT ONE REAL VALID STUDENT HERE
const TEST_ROLL_CODE = "42104";
const TEST_ROLL_NO = "26010021";

const REQUEST_TIMEOUT = 15000;

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

function detectAdditionalSection(text) {
  const t = clean(text).toLowerCase();
  if (t.includes("additional") || t.includes("अतिरिक्त")) {
    return clean(text);
  }
  return null;
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ===============================
// SUBJECT PARSER
// ===============================
function parseSubjects($) {
  const subjects = [];
  let marksTableFound = false;
  let currentAdditionalSection = null;

  $("table").each((_, table) => {
    if (marksTableFound) return;

    const rows = $(table).find("tr");
    if (rows.length < 3) return;

    const row1 = [];
    const row2 = [];

    $(rows[0]).find("td,th").each((_, cell) => row1.push(clean($(cell).text())));
    $(rows[1]).find("td,th").each((_, cell) => row2.push(clean($(cell).text())));

    const row1Text = row1.join(" ").toLowerCase();
    const row2Text = row2.join(" ").toLowerCase();

    const isMarksTable =
      row1Text.includes("subject") &&
      row1Text.includes("full marks") &&
      row1Text.includes("pass marks") &&
      row1Text.includes("theory") &&
      row1Text.includes("practical") &&
      row1Text.includes("subject total") &&
      row2Text.includes("th.") &&
      row2Text.includes("pr.");

    if (!isMarksTable) return;
    marksTableFound = true;

    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      const cells = [];
      $(row).find("td,th").each((_, cell) => cells.push(clean($(cell).text())));
      if (!cells.length) continue;

      if (cells.length === 1) {
        const extraLabel = detectAdditionalSection(cells[0]);
        currentAdditionalSection = extraLabel;
        continue;
      }

      if (cells.length !== 8) continue;

      const subjectName = clean(cells[0]);
      if (!subjectName) continue;

      const obj = {
        subject: subjectName,
        FMarks: clean(cells[1] || ""),
        PMarks: clean(cells[2] || ""),
        theory: clean(cells[3] || ""),
        subTotal: clean(cells[7] || "")
      };

      const practical = clean(cells[4] || "");
      const regulationTheory = clean(cells[5] || "");
      const regulationPractical = clean(cells[6] || "");

      if (practical !== "") obj.practical = practical;
      if (regulationTheory !== "") obj.regulationTheory = regulationTheory;
      if (regulationPractical !== "") obj.regulationPractical = regulationPractical;
      if (currentAdditionalSection) obj.extra = currentAdditionalSection;

      subjects.push(obj);
    }
  });

  return subjects;
}

// ===============================
// RESULT EXTRACTION
// ===============================
function extractKeyValues($) {
  const data = {};

  $("table tr").each((_, row) => {
    const tds = $(row).find("td");
    if (tds.length === 2) {
      const key = clean($(tds[0]).text()).replace(/:$/, "");
      const value = clean($(tds[1]).text());
      if (key && value) data[key] = value;
    }
  });

  return data;
}

function extractFullResult(html) {
  const $ = cheerio.load(html);
  const kv = extractKeyValues($);
  const subjects = parseSubjects($);

  return {
    studentName: kv["Student's Name"] || null,
    fatherName: kv["Father's Name"] || null,
    regNumber: kv["Registration Number"] || null,
    BSEBUniqueId: kv["BSEB Unique Id"] || null,
    schoolName: kv["School/College Name"] || null,
    rollCode: kv["Roll Code"] || null,
    rollNo: kv["Roll Number"] || null,
    stream: kv["Faculty"] || null,
    totalMarks: kv["Aggregate Marks"] || null,
    Division: kv["Result/Division"] || null,
    subjects
  };
}

// ===============================
// SESSION FETCH
// ===============================
async function getSessionData() {
  const res = await client.get(BASE_URL);
  const html = String(res.data || "");
  fs.writeFileSync("debug-default.html", html, "utf8");

  const $ = cheerio.load(html);

  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

  const VIEWSTATE = getHidden($, "__VIEWSTATE");
  const VIEWSTATEGENERATOR = getHidden($, "__VIEWSTATEGENERATOR");
  const EVENTVALIDATION = getHidden($, "__EVENTVALIDATION");

  return {
    cookieHeader,
    VIEWSTATE: VIEWSTATE || "",
    VIEWSTATEGENERATOR: VIEWSTATEGENERATOR || "",
    EVENTVALIDATION: EVENTVALIDATION || "",
    html
  };
}

// ===============================
// POST ONE RESULT
// ===============================
async function fetchStudentResult(rollCode, rollNo, sessionData) {
  const payload = new URLSearchParams();

  // Only append if present
  if (sessionData.VIEWSTATE) payload.append("__VIEWSTATE", sessionData.VIEWSTATE);
  if (sessionData.VIEWSTATEGENERATOR) payload.append("__VIEWSTATEGENERATOR", sessionData.VIEWSTATEGENERATOR);
  if (sessionData.EVENTVALIDATION) payload.append("__EVENTVALIDATION", sessionData.EVENTVALIDATION);

  payload.append("mobile", String(rollCode));
  payload.append("password", String(rollNo));
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

  const html = String(res.data || "");
  fs.writeFileSync("debug-result.html", html, "utf8");

  return {
    status: res.status,
    html
  };
}

// ===============================
// DIAGNOSIS
// ===============================
function diagnoseHtml(html) {
  const lower = clean(html).toLowerCase();

  const flags = {
    hasStudentName: lower.includes("student's name"),
    hasRollCode: lower.includes("roll code"),
    hasRollNumber: lower.includes("roll number"),
    hasAggregateMarks: lower.includes("aggregate marks"),
    hasFaculty: lower.includes("faculty"),
    hasCaptchaWord: lower.includes("captcha"),
    hasInvalidWord: lower.includes("invalid"),
    hasNoRecordWord: lower.includes("no record"),
    hasNotFoundWord: lower.includes("not found"),
    hasViewResultWord: lower.includes("view result"),
    hasBlockedWord:
      lower.includes("access denied") ||
      lower.includes("forbidden") ||
      lower.includes("cloudflare") ||
      lower.includes("blocked")
  };

  return flags;
}

// ===============================
// MAIN
// ===============================
(async () => {
  try {
    console.log("🚀 ONE STUDENT CHECK STARTED");
    console.log(`📍 Roll Code: ${TEST_ROLL_CODE}`);
    console.log(`📍 Roll No: ${TEST_ROLL_NO}`);

    const sessionData = await getSessionData();

    console.log("\n📄 DEFAULT PAGE CHECK:");
    console.log(`Cookie found: ${sessionData.cookieHeader ? "YES" : "NO"}`);
    console.log(`VIEWSTATE found: ${sessionData.VIEWSTATE ? "YES" : "NO"}`);
    console.log(`VIEWSTATEGENERATOR found: ${sessionData.VIEWSTATEGENERATOR ? "YES" : "NO"}`);
    console.log(`EVENTVALIDATION found: ${sessionData.EVENTVALIDATION ? "YES" : "NO"}`);
    console.log("💾 Saved: debug-default.html");

    const response = await fetchStudentResult(TEST_ROLL_CODE, TEST_ROLL_NO, sessionData);

    console.log("\n📨 POST RESPONSE:");
    console.log(`HTTP Status: ${response.status}`);
    console.log("💾 Saved: debug-result.html");

    const flags = diagnoseHtml(response.html);

    console.log("\n🔍 RESPONSE ANALYSIS:");
    for (const [key, value] of Object.entries(flags)) {
      console.log(`${key}: ${value ? "YES" : "NO"}`);
    }

    const result = extractFullResult(response.html);

    console.log("\n📘 EXTRACTED RESULT:");
    console.log(JSON.stringify(result, null, 2));

    const isValid =
      result.studentName &&
      result.rollCode === String(TEST_ROLL_CODE) &&
      result.rollNo === String(TEST_ROLL_NO);

    if (isValid) {
      console.log("\n✅ SUCCESS: REAL VALID RESULT FETCHED");
    } else {
      console.log("\n❌ FAILED: Could not confirm valid student result");
      console.log("👉 Check debug-result.html in repo/artifacts/logs");
    }

  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    process.exit(1);
  }
})();
