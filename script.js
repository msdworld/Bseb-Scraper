const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const FORM_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";

const VALID_ROLL_CODE_FILE = "bseb-12th-college-list-2026.json";
const OUTPUT_FILE = "bseb-12th-full-result-2026.json";
const PROGRESS_FILE = "progress.txt";

// Roll number range per roll code
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010999;

// ===============================
// SPEED / PARALLEL SETTINGS
// ===============================

// How many roll codes to run together
const PARALLEL_ROLL_CODES = 10;

// How many roll numbers per roll code in one round
const ROUND_SIZE_PER_ROLLCODE = 150;

// Global request concurrency
const CONCURRENCY = 150;

// Timeout per request
const REQUEST_TIMEOUT = 7000;

// Save after every X valid results
const SAVE_EVERY_VALID_RESULTS = 100;

// Skip logic
const FIRST_CHECK_LIMIT = 100;
const CONTINUOUS_FAIL_LIMIT = 20;

// ===============================
// SPLIT RANGE (CHANGE THIS EACH RUN)
// ===============================
const START_INDEX = 1100;
const END_INDEX = 1200;

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

function loadJSON(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveProgress(msg) {
  fs.writeFileSync(PROGRESS_FILE, msg + "\n", "utf8");
}

function countTotalStudentsSaved(fullResults) {
  let total = 0;
  for (const rollCode of Object.keys(fullResults)) {
    total += Object.keys(fullResults[rollCode] || {}).length;
  }
  return total;
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
      row1Text.includes("subject total");

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

      if (cells.length < 5) continue;

      const subjectName = clean(cells[0]);
      if (!subjectName) continue;

      const obj = {
        subject: subjectName,
        FMarks: clean(cells[1] || ""),
        PMarks: clean(cells[2] || ""),
        theory: clean(cells[3] || ""),
        subTotal: clean(cells[cells.length - 1] || "")
      };

      if (cells[4] !== undefined && clean(cells[4]) !== "") obj.practical = clean(cells[4]);
      if (cells[5] !== undefined && clean(cells[5]) !== "") obj.regulationTheory = clean(cells[5]);
      if (cells[6] !== undefined && clean(cells[6]) !== "") obj.regulationPractical = clean(cells[6]);

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
  const pageText = clean($.text());

  const studentName =
    kv["Student's Name"] ||
    kv["Student Name"] ||
    kv["Name"] ||
    null;

  const fatherName =
    kv["Father's Name"] ||
    kv["Father Name"] ||
    null;

  const regNumber =
    kv["Registration Number"] ||
    kv["Registration No"] ||
    null;

  const BSEBUniqueId =
    kv["BSEB Unique Id"] ||
    kv["BSEB Unique ID"] ||
    null;

  const schoolName =
    kv["School/College Name"] ||
    kv["School Name"] ||
    kv["College Name"] ||
    null;

  const rollCode =
    kv["Roll Code"] ||
    null;

  const rollNo =
    kv["Roll Number"] ||
    kv["Roll No"] ||
    null;

  const stream =
    kv["Faculty"] ||
    kv["Stream"] ||
    null;

  const totalMarks =
    kv["Aggregate Marks"] ||
    kv["Total Marks"] ||
    null;

  const Division =
    kv["Result/Division"] ||
    kv["Division"] ||
    kv["Result"] ||
    null;

  return {
    studentName,
    fatherName,
    regNumber,
    BSEBUniqueId,
    schoolName,
    rollCode,
    rollNo,
    stream,
    totalMarks,
    Division,
    subjects,
    _pageText: pageText
  };
}

// ===============================
// FETCH TOKEN / COOKIE
// ===============================
async function getSessionData() {
  const res = await client.get(FORM_URL);
  const html = res.data;
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
async function fetchStudentResult(rollCode, rollNo) {
  try {
    const sessionData = await getSessionData();

    const payload = new URLSearchParams();
    payload.append("rollcode", String(rollCode));
    payload.append("rollno", String(rollNo));
    payload.append("captcha", generateCaptcha());
    payload.append("__RequestVerificationToken", sessionData.token);

    const res = await client.post(POST_URL, payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": sessionData.cookieHeader,
        "Referer": FORM_URL,
        "Origin": "https://interbiharboard.com"
      }
    });

    const html = String(res.data || "");
    const htmlLower = html.toLowerCase();

    // Obvious invalid page
    if (
      htmlLower.includes("incorrect captcha") ||
      htmlLower.includes("please enter correct captcha") ||
      htmlLower.includes("please enter roll code") ||
      htmlLower.includes("please enter roll number") ||
      htmlLower.includes("validation") ||
      htmlLower.includes("token")
    ) {
      return { valid: false };
    }

    // If redirected to ShowResult or page contains result-like data
    const result = extractFullResult(html);

    if (
      result.studentName &&
      (result.rollCode === String(rollCode) || !result.rollCode) &&
      (result.rollNo === String(rollNo) || !result.rollNo)
    ) {
      delete result._pageText;
      result.rollCode = result.rollCode || String(rollCode);
      result.rollNo = result.rollNo || String(rollNo);
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
// CONCURRENCY HELPER
// ===============================
async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index++;
      if (current >= tasks.length) break;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: limit }, () => worker());
  await Promise.all(workers);
  return results;
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
  let unsavedValidCount = 0;

  console.log(`🚀 MULTI ROLL-CODE SCRAPER STARTED`);
  console.log(`📚 Total valid roll codes available: ${allValidRollCodes.length}`);
  console.log(`📦 Split range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this split: ${selectedRollCodes.length}`);
  console.log(`📦 Already saved students in JSON: ${totalStudentsSaved}`);

  // State per roll code
  const state = {};
  for (const rollCode of selectedRollCodes) {
    if (!fullResults[rollCode]) fullResults[rollCode] = {};

    const alreadySavedForRollCode = Object.keys(fullResults[rollCode]).length;

    state[rollCode] = {
      currentRollNo: ROLLNO_START,
      found: alreadySavedForRollCode,
      checked: 0,
      continuousFail: 0,
      done: alreadySavedForRollCode > 0,
      savedInThisRollCode: 0
    };

    if (alreadySavedForRollCode > 0) {
      console.log(`⏭️ Skipping ${rollCode} (already has ${alreadySavedForRollCode} students saved)`);
    }
  }

  // Process roll codes in groups
  for (let groupStart = 0; groupStart < selectedRollCodes.length; groupStart += PARALLEL_ROLL_CODES) {
    const group = selectedRollCodes.slice(groupStart, groupStart + PARALLEL_ROLL_CODES);
    console.log(`📍 Starting roll code group: ${group.join(", ")}`);

    for (const rc of group) {
      if (!state[rc].done) {
        console.log(`▶️ Checking Roll Code ${rc}`);
      }
    }

    let activeExists = true;

    while (activeExists) {
      activeExists = false;
      const tasks = [];

      for (const rollCode of group) {
        const s = state[rollCode];
        if (s.done) continue;
        if (s.currentRollNo > ROLLNO_END) {
          s.done = true;
          continue;
        }

        activeExists = true;

        const roundEnd = Math.min(s.currentRollNo + ROUND_SIZE_PER_ROLLCODE - 1, ROLLNO_END);

        for (let rn = s.currentRollNo; rn <= roundEnd; rn++) {
          tasks.push(async () => {
            const result = await fetchStudentResult(rollCode, rn);
            return { rollCode, rn, result };
          });
        }

        s.currentRollNo = roundEnd + 1;
      }

      if (!tasks.length) break;

      const results = await runWithConcurrency(tasks, CONCURRENCY);

      for (const item of results) {
        if (!item) continue;
        const { rollCode, rn, result } = item;
        const s = state[rollCode];

        if (s.done) continue;

        s.checked++;

        if (result.valid) {
          s.continuousFail = 0;

          if (!fullResults[rollCode][rn]) {
            fullResults[rollCode][rn] = result.data;
            s.found++;
            s.savedInThisRollCode++;
            totalStudentsSaved++;
            unsavedValidCount++;
          }
        } else {
          s.continuousFail++;
        }
      }

      // Apply stop logic after each round
      for (const rollCode of group) {
        const s = state[rollCode];
        if (s.done) continue;

        if (s.found === 0 && s.checked >= FIRST_CHECK_LIMIT) {
          console.log(`⏭️ Skipped ${rollCode} (No student found in first ${FIRST_CHECK_LIMIT})`);
          s.done = true;
          continue;
        }

        if (s.found > 0 && s.continuousFail >= CONTINUOUS_FAIL_LIMIT) {
          console.log(`⏹️ Stopped ${rollCode} after ${CONTINUOUS_FAIL_LIMIT} continuous fail`);
          s.done = true;
          continue;
        }

        if (s.currentRollNo > ROLLNO_END) {
          s.done = true;
        }
      }

      if (unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
        saveCustomJSON(OUTPUT_FILE, fullResults);
        saveProgress(`Progress Saved | Total Saved: ${totalStudentsSaved}`);
        console.log(`💾 Progress Saved | Total Saved: ${totalStudentsSaved}`);
        unsavedValidCount = 0;
      }
    }

    // Group finished → print final roll code summaries in sequence
    for (const rollCode of group) {
      const s = state[rollCode];
      if (s.savedInThisRollCode > 0) {
        saveCustomJSON(OUTPUT_FILE, fullResults);
        console.log(`✅ Saved ${s.savedInThisRollCode} students from ${rollCode} | Total Saved: ${totalStudentsSaved}`);
        unsavedValidCount = 0;
      } else if (Object.keys(fullResults[rollCode] || {}).length === 0) {
        console.log(`⚠️ No students saved from ${rollCode}`);
      }
    }
  }

  saveCustomJSON(OUTPUT_FILE, fullResults);
  saveProgress(`SPLIT COMPLETED | Range ${START_INDEX}-${END_INDEX} | Total Saved: ${totalStudentsSaved}`);

  console.log(`🎉 SPLIT COMPLETED | Range ${START_INDEX}-${END_INDEX} | Total Saved: ${totalStudentsSaved}`);
})();
