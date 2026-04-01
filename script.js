const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const FORM_URL = "https://interbiharboard.com/Result/GetResult";
const OUTPUT_FILE = "bseb-12th-full-result-2026.json";
const VALID_ROLL_CODE_FILE = "bseb-12th-college-list-2026.json";
const PROGRESS_FILE = "progress.txt";

// Roll number range
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010999;

// Recheck range (CHANGE THIS EACH RUN)
const START_INDEX = 800;
const END_INDEX = 1000;

// SPEED
const ROLL_CODE_PARALLEL = 8;      // how many roll codes at once
const CONCURRENCY = 60;            // requests at once inside one roll code
const BATCH_SIZE = 180;            // roll nos per session batch
const REQUEST_TIMEOUT = 7000;

// LOGIC
const FIRST_CHECK_LIMIT = 150;     // if no student in first 150 unsaved checks → skip
const CONTINUOUS_FAIL_LIMIT = 60;  // after finding students, allow more fail before stop
const SAVE_EVERY_VALID_RESULTS = 100;

// ===============================
// AXIOS CLIENT
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 2,
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  for (const rc of Object.keys(fullResults)) {
    total += Object.keys(fullResults[rc] || {}).length;
  }
  return total;
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ===============================
// SAFE SORTED SAVE
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

  const subjectLines = (student.subjects || []).map((sub) => {
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
// PARSER
// ===============================
function detectAdditionalSection(text) {
  const t = clean(text).toLowerCase();
  if (t.includes("additional") || t.includes("अतिरिक्त")) return clean(text);
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
// SESSION
// ===============================
async function getSessionData() {
  const res = await client.get(BASE_URL);
  const html = res.data;
  const $ = cheerio.load(html);

  const token =
    $('input[name="__RequestVerificationToken"]').val() ||
    $('input[name="__RequestVerificationToken"]').attr("value") ||
    "";

  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

  if (!token || !cookieHeader) {
    throw new Error("Could not fetch token/cookies");
  }

  return {
    token: clean(token),
    cookieHeader
  };
}

// ===============================
// FETCH ONE STUDENT
// ===============================
async function fetchStudentResult(rollCode, rollNo, sessionData) {
  try {
    const payload = new URLSearchParams();
    payload.append("rollcode", String(rollCode));
    payload.append("rollno", String(rollNo));
    payload.append("captcha", generateCaptcha());
    payload.append("__RequestVerificationToken", sessionData.token);

    const res = await client.post(FORM_URL, payload.toString(), {
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
      htmlLower.includes("please enter roll code") ||
      htmlLower.includes("please enter roll number") ||
      htmlLower.includes("please enter captcha") ||
      htmlLower.includes("incorrect captcha") ||
      htmlLower.includes("validation summary") ||
      htmlLower.includes("bseb result 2026") && !htmlLower.includes("student's name")
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
// LOAD ROLL CODES
// ===============================
function loadValidRollCodes() {
  const raw = loadJSON(VALID_ROLL_CODE_FILE, {});
  return Object.keys(raw)
    .filter(code => /^\d+$/.test(code))
    .sort((a, b) => Number(a) - Number(b));
}

// ===============================
// PROCESS ONE ROLL CODE
// ===============================
async function processRollCode(rollCode, fullResults, stats) {
  if (!fullResults[rollCode]) fullResults[rollCode] = {};

  const savedMap = fullResults[rollCode];
  const alreadySavedCount = Object.keys(savedMap).length;

  let foundInThisRollCode = 0;
  let savedInThisRollCode = 0;
  let checkedUnsaved = 0;
  let continuousFail = 0;

  console.log(`▶️ Checking Roll Code ${rollCode} (already saved: ${alreadySavedCount})`);

  let currentRollNo = ROLLNO_START;

  while (currentRollNo <= ROLLNO_END) {
    const batchEnd = Math.min(currentRollNo + BATCH_SIZE - 1, ROLLNO_END);

    // only unsaved roll numbers
    const batchRollNos = [];
    for (let rn = currentRollNo; rn <= batchEnd; rn++) {
      if (!savedMap[rn]) batchRollNos.push(rn);
    }

    currentRollNo = batchEnd + 1;

    if (!batchRollNos.length) continue;

    let sessionData;
    try {
      sessionData = await getSessionData();
    } catch {
      await sleep(1000);
      continue;
    }

    for (let i = 0; i < batchRollNos.length; i += CONCURRENCY) {
      const chunk = batchRollNos.slice(i, i + CONCURRENCY);

      const results = await Promise.all(
        chunk.map(rn => fetchStudentResult(rollCode, rn, sessionData))
      );

      for (let j = 0; j < chunk.length; j++) {
        const rn = chunk[j];
        const result = results[j];

        checkedUnsaved++;

        if (result.valid) {
          continuousFail = 0;

          if (!savedMap[rn]) {
            savedMap[rn] = result.data;
            stats.unsavedValidCount++;
            stats.totalStudentsSaved++;
            foundInThisRollCode++;
            savedInThisRollCode++;
          }
        } else {
          continuousFail++;
        }

        if (foundInThisRollCode === 0 && checkedUnsaved >= FIRST_CHECK_LIMIT) {
          console.log(`⏭️ Skipped ${rollCode} (No student found in first ${FIRST_CHECK_LIMIT} unsaved checks)`);
          currentRollNo = ROLLNO_END + 1;
          break;
        }

        if (foundInThisRollCode > 0 && continuousFail >= CONTINUOUS_FAIL_LIMIT) {
          console.log(`⏹️ Stopped ${rollCode} after ${CONTINUOUS_FAIL_LIMIT} continuous fail`);
          currentRollNo = ROLLNO_END + 1;
          break;
        }
      }

      if (stats.unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
        saveCustomJSON(OUTPUT_FILE, fullResults);
        saveProgress(`Last saved at roll code ${rollCode} | Total Saved: ${stats.totalStudentsSaved}`);
        console.log(`💾 Progress Saved | Total Saved: ${stats.totalStudentsSaved}`);
        stats.unsavedValidCount = 0;
      }

      if (currentRollNo > ROLLNO_END) break;
    }
  }

  saveCustomJSON(OUTPUT_FILE, fullResults);
  saveProgress(`Completed roll code ${rollCode} | Total Saved: ${stats.totalStudentsSaved}`);

  if (savedInThisRollCode > 0) {
    console.log(`✅ Saved ${savedInThisRollCode} missing students from ${rollCode} | Total Saved: ${stats.totalStudentsSaved}`);
  } else {
    console.log(`⚠️ No new students saved from ${rollCode}`);
  }
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

  const fullResults = loadJSON(OUTPUT_FILE, {});
  let totalStudentsSaved = countTotalStudentsSaved(fullResults);

  const stats = {
    totalStudentsSaved,
    unsavedValidCount: 0
  };

  console.log(`🚀 RECHECK / FILL-MISSING SCRAPER STARTED`);
  console.log(`📚 Total roll codes available: ${allValidRollCodes.length}`);
  console.log(`📦 Split range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this run: ${selectedRollCodes.length}`);
  console.log(`📦 Already saved students in JSON: ${totalStudentsSaved}`);

  for (let i = 0; i < selectedRollCodes.length; i += ROLL_CODE_PARALLEL) {
    const group = selectedRollCodes.slice(i, i + ROLL_CODE_PARALLEL);
    console.log(`\n🚀 Starting roll code group: ${group.join(", ")}`);

    await Promise.all(
      group.map(rc => processRollCode(rc, fullResults, stats))
    );

    saveCustomJSON(OUTPUT_FILE, fullResults);
    saveProgress(`Completed group ending at ${group[group.length - 1]} | Total Saved: ${stats.totalStudentsSaved}`);
    console.log(`📦 Group completed | Total Saved: ${stats.totalStudentsSaved}`);
  }

  saveCustomJSON(OUTPUT_FILE, fullResults);
  saveProgress(`Run completed | Total Saved: ${stats.totalStudentsSaved}`);

  console.log(`🎉 RECHECK COMPLETED | Range ${START_INDEX}-${END_INDEX} | Total Saved: ${stats.totalStudentsSaved}`);
})();
