const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";

const VALID_ROLL_CODE_FILE = "bseb-12th-college-list-2026.json";
const OUTPUT_FILE = "bseb-12th-full-result-2026.json";
const PROGRESS_FILE = "progress.txt";

// Roll number range
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010999;

// Skip logic
const FIRST_CHECK_LIMIT = 100;
const CONTINUOUS_FAIL_LIMIT = 20;

// SPEED
const ROLLCODE_PARALLEL = 10;   // 10 roll codes at once
const CONCURRENCY = 200;         // roll numbers checked in parallel per roll code
const BATCH_SIZE = 200;         // roll numbers per loop per roll code
const REQUEST_TIMEOUT = 7000;   // 7 sec max wait per request

// SAVE
const SAVE_EVERY_VALID_RESULTS = 100;

// SPLIT RANGE
const START_INDEX = 1100;
const END_INDEX = 1120;

// ===============================
// AXIOS CLIENT
// ===============================
function createClient() {
  return axios.create({
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
      "Origin": "https://interbiharboard.com",
      "Referer": "https://interbiharboard.com/"
    }
  });
}

// ===============================
// HELPERS
// ===============================
function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

function loadJSON(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveProgress(text) {
  fs.writeFileSync(PROGRESS_FILE, text, "utf8");
}

function countTotalStudentsSaved(fullResults) {
  let total = 0;
  for (const rollCode of Object.keys(fullResults)) {
    total += Object.keys(fullResults[rollCode] || {}).length;
  }
  return total;
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ===============================
// LOG BUFFER (keeps logs readable)
// ===============================
class RollLogger {
  constructor(rollCode) {
    this.rollCode = rollCode;
    this.lines = [];
  }

  log(msg) {
    this.lines.push(msg);
  }

  flush() {
    if (!this.lines.length) return;
    console.log(this.lines.join("\n"));
    this.lines = [];
  }
}

// ===============================
// CUSTOM JSON FORMATTER
// ===============================
function formatStudent(student, indent = "    ") {
  const lines = [];
  lines.push("{");
  lines.push(`${indent}"studentName": ${JSON.stringify(student.studentName)},`);
  lines.push(`${indent}"fatherName": ${JSON.stringify(student.fatherName)},`);
  lines.push(`${indent}"regNumber": ${JSON.stringify(student.regNumber)},`);
  lines.push(`${indent}"BSEBUniqueId": ${JSON.stringify(student.BSEBUniqueId)},`);
  lines.push(`${indent}"schoolName": ${JSON.stringify(student.schoolName)},`);
  lines.push(`${indent}"rollCode": ${JSON.stringify(student.rollCode)},`);
  lines.push(`${indent}"rollNo": ${JSON.stringify(student.rollNo)},`);
  lines.push(`${indent}"stream": ${JSON.stringify(student.stream)},`);
  lines.push(`${indent}"totalMarks": ${JSON.stringify(student.totalMarks)},`);
  lines.push(`${indent}"Division": ${JSON.stringify(student.Division)},`);
  lines.push(`${indent}"subjects": [`);

  const subjectLines = student.subjects.map((sub) => {
    const ordered = {};
    ordered.subject = sub.subject;
    ordered.FMarks = sub.FMarks;
    ordered.PMarks = sub.PMarks;
    ordered.theory = sub.theory;
    if (sub.practical !== undefined) ordered.practical = sub.practical;
    if (sub.regulationTheory !== undefined) ordered.regulationTheory = sub.regulationTheory;
    if (sub.regulationPractical !== undefined) ordered.regulationPractical = sub.regulationPractical;
    ordered.subTotal = sub.subTotal;
    if (sub.extra !== undefined) ordered.extra = sub.extra;

    return `${indent}  ${JSON.stringify(ordered)}`;
  });

  lines.push(subjectLines.join(",\n"));
  lines.push(`${indent}]`);
  lines.push("}");
  return lines.join("\n");
}

function saveCustomJSON(file, data) {
  const rollCodes = Object.keys(data).sort((a, b) => Number(a) - Number(b));
  const lines = [];
  lines.push("{");

  rollCodes.forEach((rollCode, idx) => {
    const students = data[rollCode] || {};
    const rollNoKeys = Object.keys(students).sort((a, b) => Number(a) - Number(b));

    lines.push(`  ${JSON.stringify(rollCode)}: {`);

    rollNoKeys.forEach((rollNo, i) => {
      const student = students[rollNo];
      const formatted = formatStudent(student, "      ")
        .split("\n")
        .map((line, index) => (index === 0 ? `    ${JSON.stringify(rollNo)}: ${line}` : `    ${line}`))
        .join("\n");

      lines.push(formatted + (i < rollNoKeys.length - 1 ? "," : ""));
    });

    lines.push(`  }${idx < rollCodes.length - 1 ? "," : ""}`);
  });

  lines.push("}");
  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

// ===============================
// SUBJECT PARSER
// ===============================
function detectAdditionalSection(text) {
  const t = clean(text).toLowerCase();
  if (t.includes("additional") || t.includes("अतिरिक्त")) {
    return clean(text);
  }
  return null;
}

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
// SESSION FETCH (1 session per roll code)
// ===============================
async function getSessionData(client) {
  const res = await client.get(BASE_URL);
  const html = String(res.data || "");
  const $ = cheerio.load(html);

  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

  const token =
    $('input[name="__RequestVerificationToken"]').val() ||
    "";

  if (!token) {
    throw new Error("Could not fetch RequestVerificationToken");
  }

  return {
    cookieHeader,
    token
  };
}

// ===============================
// FETCH ONE RESULT
// ===============================
async function fetchStudentResult(client, rollCode, rollNo, sessionData) {
  try {
    const payload = new URLSearchParams();
    payload.append("rollcode", String(rollCode));
    payload.append("rollno", String(rollNo));
    payload.append("captcha", generateCaptcha());
    payload.append("__RequestVerificationToken", sessionData.token);

    const res = await client.post(POST_URL, payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": sessionData.cookieHeader
      }
    });

    const html = String(res.data || "");
    const htmlLower = html.toLowerCase();

    if (
      htmlLower.includes("please enter correct captcha") ||
      htmlLower.includes("incorrect captcha") ||
      htmlLower.includes("please enter captcha")
    ) {
      return { valid: false, captchaRejected: true };
    }

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
  } catch {
    return { valid: false };
  }
}

// ===============================
// LOAD VALID ROLL CODES
// ===============================
function loadValidRollCodes() {
  const raw = loadJSON(VALID_ROLL_CODE_FILE, {});
  return Object.keys(raw)
    .filter(code => /^\d+$/.test(code))
    .sort((a, b) => Number(a) - Number(b));
}

// ===============================
// GLOBAL SAVE STATE
// ===============================
const fullResults = loadJSON(OUTPUT_FILE, {});
let totalStudentsSaved = countTotalStudentsSaved(fullResults);
let unsavedValidCount = 0;

function saveNow(reason = "") {
  saveCustomJSON(OUTPUT_FILE, fullResults);
  saveProgress(
    `Last Save: ${new Date().toISOString()}\nReason: ${reason}\nTotal Saved: ${totalStudentsSaved}\n`
  );
  console.log(`💾 Progress Saved${reason ? " | " + reason : ""} | Total Saved: ${totalStudentsSaved}`);
  unsavedValidCount = 0;
}

// ===============================
// PROCESS ONE ROLL CODE
// ===============================
async function processRollCode(rollCode) {
  const logger = new RollLogger(rollCode);

  if (!fullResults[rollCode]) fullResults[rollCode] = {};

  const alreadySavedForRollCode = Object.keys(fullResults[rollCode]).length;
  if (alreadySavedForRollCode > 0) {
    logger.log(`⏭️ Skipping ${rollCode} (already has ${alreadySavedForRollCode} students saved)`);
    logger.flush();
    return;
  }

  logger.log(`▶️ Checking Roll Code ${rollCode}`);

  const client = createClient();
  let sessionData;

  try {
    sessionData = await getSessionData(client);
  } catch (err) {
    logger.log(`❌ Session failed for ${rollCode}: ${err.message}`);
    logger.flush();
    return;
  }

  let currentRollNo = ROLLNO_START;
  let foundInThisRollCode = 0;
  let continuousFail = 0;
  let checkedInThisRollCode = 0;
  let savedInThisRollCode = 0;

  while (currentRollNo <= ROLLNO_END) {
    const batchEnd = Math.min(currentRollNo + BATCH_SIZE - 1, ROLLNO_END);
    const batchRollNos = [];

    for (let rn = currentRollNo; rn <= batchEnd; rn++) {
      batchRollNos.push(rn);
    }

    for (let i = 0; i < batchRollNos.length; i += CONCURRENCY) {
      const chunk = batchRollNos.slice(i, i + CONCURRENCY);

      const results = await Promise.all(
        chunk.map(rn => fetchStudentResult(client, rollCode, rn, sessionData))
      );

      for (let j = 0; j < chunk.length; j++) {
        const rn = chunk[j];
        const result = results[j];

        checkedInThisRollCode++;

        if (result.valid) {
          continuousFail = 0;

          if (!fullResults[rollCode][rn]) {
            fullResults[rollCode][rn] = result.data;
            unsavedValidCount++;
            totalStudentsSaved++;
            foundInThisRollCode++;
            savedInThisRollCode++;
          }
        } else {
          continuousFail++;
        }

        if (foundInThisRollCode === 0 && checkedInThisRollCode >= FIRST_CHECK_LIMIT) {
          logger.log(`⏭️ Skipped ${rollCode} (No student found in first ${FIRST_CHECK_LIMIT})`);
          currentRollNo = ROLLNO_END + 1;
          break;
        }

        if (foundInThisRollCode > 0 && continuousFail >= CONTINUOUS_FAIL_LIMIT) {
          logger.log(`⏹️ Stopped ${rollCode} after ${CONTINUOUS_FAIL_LIMIT} continuous fail`);
          currentRollNo = ROLLNO_END + 1;
          break;
        }
      }

      if (unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
        saveNow(`Auto batch save`);
      }

      if (currentRollNo > ROLLNO_END) break;
    }

    if (currentRollNo > ROLLNO_END) break;
    currentRollNo = batchEnd + 1;
  }

  if (savedInThisRollCode > 0) {
    saveNow(`Saved ${savedInThisRollCode} students from ${rollCode}`);
    logger.log(`✅ Saved ${savedInThisRollCode} students from ${rollCode} | Total Saved: ${totalStudentsSaved}`);
  } else {
    logger.log(`⚠️ No students saved from ${rollCode}`);
  }

  logger.flush();
}

// ===============================
// MAIN
// ===============================
(async () => {
  const allValidRollCodes = loadValidRollCodes();

  if (!allValidRollCodes.length) {
    console.log(`❌ No valid roll codes found in ${VALID_ROLL_CODE_FILE}`);
    return;
  }

  const selectedRollCodes = allValidRollCodes.slice(START_INDEX, END_INDEX + 1);

  if (!selectedRollCodes.length) {
    console.log(`❌ No roll codes found in selected split range ${START_INDEX}-${END_INDEX}`);
    return;
  }

  console.log(`🚀 MULTI-ROLL FULL RESULT SCRAPER STARTED`);
  console.log(`📚 Total valid roll codes available: ${allValidRollCodes.length}`);
  console.log(`📦 Split range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this split: ${selectedRollCodes.length}`);
  console.log(`📦 Already saved students in JSON: ${totalStudentsSaved}`);
  console.log(`⚡ Roll codes parallel: ${ROLLCODE_PARALLEL}`);
  console.log(`⚡ Roll no concurrency per roll code: ${CONCURRENCY}`);
  console.log(`⚡ Batch size per roll code: ${BATCH_SIZE}`);

  for (let i = 0; i < selectedRollCodes.length; i += ROLLCODE_PARALLEL) {
    const group = selectedRollCodes.slice(i, i + ROLLCODE_PARALLEL);

    console.log(`\n🚦 Starting roll code group: ${group.join(", ")}`);

    await Promise.all(group.map(rc => processRollCode(rc)));

    saveNow(`Completed roll code group: ${group.join(", ")}`);
  }

  saveNow(`Final save`);

  console.log(`🎉 SCRAPE COMPLETED | Total Saved: ${totalStudentsSaved}`);
})();
