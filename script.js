const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// TEST MODE CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/Default.html";
const POST_URL = "https://interbiharboard.com/Result.aspx";

const OUTPUT_FILE = "bseb-12th-full-result-2026.json";
const PROGRESS_FILE = "progress.txt";

// 🔍 TEST ONLY
const TEST_ROLL_CODE = "11008";
const TEST_START_ROLL_NO = 26010001;
const TEST_END_ROLL_NO = 26010020;

// Speed controls
const CONCURRENCY = 5;
const BATCH_SIZE = 20;
const REQUEST_TIMEOUT = 5000;

// Save controls
const SAVE_EVERY_VALID_RESULTS = 5;

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

function saveProgress(currentRollCode, currentRollNo) {
  fs.writeFileSync(
    PROGRESS_FILE,
    JSON.stringify(
      {
        mode: "full-result-test",
        currentRollCode,
        currentRollNo
      },
      null,
      2
    )
  );
}

// ===============================
// SUBJECT PARSER
// ===============================
function parseSubjects($) {
  const subjects = [];

  $("table").each((_, table) => {
    const rows = $(table).find("tr");
    if (rows.length < 2) return;

    const headers = [];
    $(rows[0]).find("th,td").each((_, cell) => {
      headers.push(clean($(cell).text()));
    });

    const headerText = headers.join(" ").toLowerCase();

    if (
      headerText.includes("subject") &&
      headerText.includes("full marks") &&
      headerText.includes("pass marks") &&
      headerText.includes("theory") &&
      headerText.includes("subject total")
    ) {
      console.log("\n📚 SUBJECT TABLE HEADERS DETECTED:");
      console.log(headers);

      for (let i = 1; i < rows.length; i++) {
        const cols = [];
        $(rows[i]).find("td,th").each((_, cell) => {
          cols.push(clean($(cell).text()));
        });

        if (!cols.length || cols.every(v => !v)) continue;

        const row = {};
        headers.forEach((h, idx) => {
          row[h] = cols[idx] !== undefined ? cols[idx] : "";
        });

        const subjectName = row["Subject"] || cols[0] || "";
        if (!subjectName) continue;

        const obj = {
          subject: subjectName,
          FMarks: row["Full Marks"] || "",
          PMarks: row["Pass Marks"] || "",
          theory: row["Theory"] || "",
          subTotal: row["Subject Total"] || ""
        };

        const practicalValue = row["Practical"] || "";
        const regulationValue = row["Regulation"] || "";

        // Only include practical if actual value exists
        if (practicalValue !== "") {
          obj.practical = practicalValue;
        }

        // Only include regulation if actual value exists
        if (regulationValue !== "") {
          obj.regulation = regulationValue;
        }

        subjects.push(obj);
      }
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
      const key = clean($(tds[0]).text());
      const value = clean($(tds[1]).text());
      if (key) data[key] = value;
    }
  });

  return data;
}

function extractFullResult(html) {
  const $ = cheerio.load(html);
  const kv = extractKeyValues($);
  const subjects = parseSubjects($);

  console.log("\n🧾 EXTRACTED KEY FIELDS:");
  console.log(kv);

  return {
    studentName: kv["Student's Name"] || null,
    fatherName: kv["Father's Name"] || null,
    regNumber: kv["Registration Number"] || null,
    BSEBUniqueId: kv["BSEB Unique Id"] || null,
    schoolName: kv["School/College Name"] || null,
    rollCode: kv["Roll Code"] || null,
    rollNo: kv["Roll Number"] || null,
    stream: kv["Faculty"] || null,
    totalMarks: kv["Aggregate Marks:"] || null,
    Division: kv["Result/Division:"] || null,
    subjects
  };
}

// ===============================
// FETCH SESSION
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
// CHECK ONE STUDENT
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

    const htmlLower = String(res.data || "").toLowerCase();

    if (
      htmlLower.includes("invalid") ||
      htmlLower.includes("no record") ||
      htmlLower.includes("not found")
    ) {
      return { valid: false };
    }

    const result = extractFullResult(res.data);

    if (
      result.studentName &&
      result.rollCode === String(rollCode) &&
      result.rollNo === String(rollNo)
    ) {
      return { valid: true, data: result };
    }

    return { valid: false };
  } catch (err) {
    console.log(`❌ Error for ${rollCode}-${rollNo}: ${err.message}`);
    return { valid: false };
  }
}

// ===============================
// MAIN
// ===============================
(async () => {
  const fullResults = loadJSON(OUTPUT_FILE, {});
  if (!fullResults[TEST_ROLL_CODE]) fullResults[TEST_ROLL_CODE] = {};

  // Force create file immediately
  saveJSON(OUTPUT_FILE, fullResults);
  console.log(`📁 Ensured output file exists: ${OUTPUT_FILE}`);

  let unsavedValidCount = 0;
  let foundCount = 0;

  console.log(`🚀 TEST MODE STARTED`);
  console.log(`🏫 Roll Code: ${TEST_ROLL_CODE}`);
  console.log(`🔢 Roll No Range: ${TEST_START_ROLL_NO} → ${TEST_END_ROLL_NO}`);

  let currentRollNo = TEST_START_ROLL_NO;

  while (currentRollNo <= TEST_END_ROLL_NO) {
    const sessionData = await getSessionData();

    const batchEnd = Math.min(currentRollNo + BATCH_SIZE - 1, TEST_END_ROLL_NO);
    const batchRollNos = [];

    for (let rn = currentRollNo; rn <= batchEnd; rn++) {
      batchRollNos.push(rn);
    }

    for (let i = 0; i < batchRollNos.length; i += CONCURRENCY) {
      const chunk = batchRollNos.slice(i, i + CONCURRENCY);

      console.log(`\nChecking ${TEST_ROLL_CODE}: ${chunk[0]} → ${chunk[chunk.length - 1]}`);

      const results = await Promise.all(
        chunk.map(rn => fetchStudentResult(TEST_ROLL_CODE, rn, sessionData))
      );

      for (let j = 0; j < chunk.length; j++) {
        const rn = chunk[j];
        const result = results[j];

        if (result.valid) {
          if (!fullResults[TEST_ROLL_CODE][rn]) {
            fullResults[TEST_ROLL_CODE][rn] = result.data;
            unsavedValidCount++;
            foundCount++;

            console.log(`✅ FOUND: ${TEST_ROLL_CODE} - ${rn} - ${result.data.studentName}`);
            console.log(JSON.stringify(result.data, null, 2));
          }
        }
      }

      saveProgress(TEST_ROLL_CODE, chunk[chunk.length - 1] + 1);

      if (unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
        saveJSON(OUTPUT_FILE, fullResults);
        console.log(`💾 JSON file written: ${OUTPUT_FILE}`);
        console.log(`💾 Saved ${unsavedValidCount} test results`);
        unsavedValidCount = 0;
      }
    }

    if (unsavedValidCount > 0) {
      saveJSON(OUTPUT_FILE, fullResults);
      console.log(`💾 JSON file written: ${OUTPUT_FILE}`);
      console.log(`💾 Batch-end save: ${unsavedValidCount} test results`);
      unsavedValidCount = 0;
    }

    currentRollNo = batchEnd + 1;
  }

  saveJSON(OUTPUT_FILE, fullResults);
  console.log(`📁 Final output saved: ${OUTPUT_FILE}`);

  console.log(`\n🎉 TEST MODE COMPLETED`);
  console.log(`📊 Total students found: ${foundCount}`);
  console.log(`📁 Output file: ${OUTPUT_FILE}`);
})();
