const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";

// 🔥 CHANGE THIS ROLL CODE FOR TEST
const TEST_ROLL_CODE = "16157";

// Check only 1 to 30
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010030;

// Speed
const CONCURRENCY = 10;
const REQUEST_TIMEOUT = 10000;

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

function getHiddenByName($, name) {
  return clean($(`input[name="${name}"]`).val() || "");
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ===============================
// SUBJECT PARSER
// ===============================
function parseSubjects($) {
  const subjects = [];

  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    if (rows.length < 3) return;

    const headerText = clean($(table).text()).toLowerCase();

    const isMarksTable =
      headerText.includes("subject") &&
      headerText.includes("full marks") &&
      headerText.includes("pass marks") &&
      headerText.includes("theory");

    if (!isMarksTable) return;

    rows.each((i, row) => {
      if (i < 2) return;

      const cells = [];
      $(row).find("td,th").each((_, cell) => {
        cells.push(clean($(cell).text()));
      });

      if (cells.length < 5) return;

      const subjectName = clean(cells[0]);
      if (!subjectName) return;

      subjects.push({
        subject: subjectName,
        FMarks: clean(cells[1] || ""),
        PMarks: clean(cells[2] || ""),
        theory: clean(cells[3] || ""),
        practical: clean(cells[4] || ""),
        regulationTheory: clean(cells[5] || ""),
        regulationPractical: clean(cells[6] || ""),
        subTotal: clean(cells[7] || "")
      });
    });
  });

  return subjects;
}

// ===============================
// KEY VALUE EXTRACTION
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
    studentName:
      kv["Student's Name"] ||
      kv["Student Name"] ||
      null,

    fatherName:
      kv["Father's Name"] ||
      kv["Father Name"] ||
      null,

    regNumber:
      kv["Registration Number"] ||
      null,

    BSEBUniqueId:
      kv["BSEB Unique Id"] ||
      kv["BSEB Unique ID"] ||
      null,

    schoolName:
      kv["School/College Name"] ||
      kv["School Name"] ||
      kv["College Name"] ||
      null,

    rollCode:
      kv["Roll Code"] ||
      null,

    rollNo:
      kv["Roll Number"] ||
      kv["Roll No"] ||
      null,

    stream:
      kv["Faculty"] ||
      kv["Stream"] ||
      null,

    totalMarks:
      kv["Aggregate Marks"] ||
      kv["Total Marks"] ||
      null,

    Division:
      kv["Result/Division"] ||
      kv["Division"] ||
      kv["Result"] ||
      null,

    subjects
  };
}

// ===============================
// GET SESSION
// ===============================
async function getSessionData() {
  const res = await client.get(BASE_URL);
  const html = res.data;
  const $ = cheerio.load(html);

  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

  const token = getHiddenByName($, "__RequestVerificationToken");

  if (!token) {
    fs.writeFileSync("debug-default.html", html);
    throw new Error("Could not fetch __RequestVerificationToken");
  }

  return {
    cookieHeader,
    token
  };
}

// ===============================
// FETCH ONE RESULT
// ===============================
async function fetchStudentResult(rollCode, rollNo, sessionData) {
  try {
    const payload = new URLSearchParams();
    payload.append("rollcode", String(rollCode));
    payload.append("rollno", String(rollNo));
    payload.append("captcha", generateCaptcha());
    payload.append("__RequestVerificationToken", sessionData.token);

    const res = await client.post(POST_URL, payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": sessionData.cookieHeader,
        "Referer": BASE_URL,
        "Origin": "https://interbiharboard.com"
      }
    });

    const finalUrl = res.request?.res?.responseUrl || "";
    const html = String(res.data || "");
    const htmlLower = html.toLowerCase();

    // Save one sample invalid/unknown response for debugging
    if (rollNo === ROLLNO_START) {
      fs.writeFileSync("debug-sample-response.html", html);
    }

    // If still returned form page, not a valid result
    if (
      finalUrl === "https://interbiharboard.com/" ||
      htmlLower.includes("enter roll code") ||
      htmlLower.includes("enter roll number") ||
      htmlLower.includes("please enter correct captcha")
    ) {
      return { valid: false };
    }

    const result = extractFullResult(html);

    if (
      result.studentName &&
      String(result.rollCode) === String(rollCode) &&
      String(result.rollNo) === String(rollNo)
    ) {
      return { valid: true, data: result };
    }

    return { valid: false };
  } catch (err) {
    return {
      valid: false,
      error: err.message
    };
  }
}

// ===============================
// MAIN TEST
// ===============================
(async () => {
  console.log(`🧪 TEST STARTED`);
  console.log(`🎯 Roll Code: ${TEST_ROLL_CODE}`);
  console.log(`🔎 Roll Range: ${ROLLNO_START} to ${ROLLNO_END}`);
  console.log(`⚡ Concurrency: ${CONCURRENCY}`);
  console.log("");

  const sessionData = await getSessionData();
  console.log(`✅ Session fetched`);
  console.log("");

  const allRollNos = [];
  for (let rn = ROLLNO_START; rn <= ROLLNO_END; rn++) {
    allRollNos.push(rn);
  }

  const foundStudents = [];

  for (let i = 0; i < allRollNos.length; i += CONCURRENCY) {
    const chunk = allRollNos.slice(i, i + CONCURRENCY);

    console.log(`🚀 Checking: ${chunk[0]} to ${chunk[chunk.length - 1]}`);

    const results = await Promise.all(
      chunk.map(rn => fetchStudentResult(TEST_ROLL_CODE, rn, sessionData))
    );

    for (let j = 0; j < chunk.length; j++) {
      const rn = chunk[j];
      const result = results[j];

      if (result.valid) {
        foundStudents.push(result.data);

        console.log(`✅ VALID FOUND`);
        console.log(`   Roll No: ${rn}`);
        console.log(`   Name   : ${result.data.studentName}`);
        console.log(`   Father : ${result.data.fatherName}`);
        console.log(`   School : ${result.data.schoolName}`);
        console.log(`--------------------------------------`);
      } else {
        console.log(`❌ Invalid: ${rn}`);
      }
    }

    console.log("");
  }

  fs.writeFileSync("test-found-students.json", JSON.stringify(foundStudents, null, 2));

  console.log(`======================================`);
  console.log(`🎉 TEST COMPLETED`);
  console.log(`📦 Total Valid Found: ${foundStudents.length}`);
  console.log(`💾 Saved file: test-found-students.json`);
  console.log(`======================================`);
})();
