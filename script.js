const axios = require("axios");
const cheerio = require("cheerio");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result.aspx";

const TEST_ROLL_CODE = "16157";
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010030;

const CONCURRENCY = 10;
const REQUEST_TIMEOUT = 7000;

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

function detectAdditionalSection(text) {
  const t = clean(text).toLowerCase();
  if (t.includes("additional") || t.includes("अतिरिक्त")) {
    return clean(text);
  }
  return null;
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
// FETCH ONE RESULT
// ===============================
async function fetchStudentResult(rollCode, rollNo, sessionData) {
  try {
    const payload = new URLSearchParams();
    payload.append("__EVENTTARGET", "");
    payload.append("__EVENTARGUMENT", "");
    payload.append("__VIEWSTATE", sessionData.VIEWSTATE);
    payload.append("__VIEWSTATEGENERATOR", sessionData.VIEWSTATEGENERATOR);
    payload.append("__EVENTVALIDATION", sessionData.EVENTVALIDATION);
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
    const htmlLower = html.toLowerCase();

    if (
      htmlLower.includes("invalid") ||
      htmlLower.includes("no record") ||
      htmlLower.includes("not found")
    ) {
      return { valid: false };
    }

    const result = extractFullResult(html);

    if (
      result.studentName &&
      result.rollCode === String(rollCode) &&
      result.rollNo === String(rollNo)
    ) {
      return { valid: true, data: result };
    }

    return { valid: false };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ===============================
// MAIN TEST
// ===============================
(async () => {
  console.log("======================================");
  console.log("🧪 BSEB SINGLE ROLL CODE TEST STARTED");
  console.log("======================================");
  console.log(`🎯 Roll Code: ${TEST_ROLL_CODE}`);
  console.log(`🔎 Roll Range: ${ROLLNO_START} to ${ROLLNO_END}`);
  console.log(`⚡ Concurrency: ${CONCURRENCY}`);
  console.log("");

  const foundStudents = [];

  for (let currentRollNo = ROLLNO_START; currentRollNo <= ROLLNO_END; currentRollNo += CONCURRENCY) {
    const chunk = [];

    for (
      let rn = currentRollNo;
      rn < currentRollNo + CONCURRENCY && rn <= ROLLNO_END;
      rn++
    ) {
      chunk.push(rn);
    }

    console.log(`🚀 Checking: ${chunk[0]} to ${chunk[chunk.length - 1]}`);

    // 🔥 fresh session per chunk (important)
    const sessionData = await getSessionData();

    const results = await Promise.all(
      chunk.map(rn => fetchStudentResult(TEST_ROLL_CODE, rn, sessionData))
    );

    for (let i = 0; i < chunk.length; i++) {
      const rn = chunk[i];
      const result = results[i];

      if (result.valid) {
        foundStudents.push(result.data);

        console.log(`✅ VALID: ${rn}`);
        console.log(JSON.stringify(result.data, null, 2));
        console.log("--------------------------------------");
      } else {
        console.log(`❌ Invalid: ${rn}${result.error ? ` | ${result.error}` : ""}`);
      }
    }

    console.log("");
  }

  console.log("======================================");
  console.log(`🎉 TEST COMPLETED`);
  console.log(`📦 Total Valid Found: ${foundStudents.length}`);
  console.log("======================================");
})();
