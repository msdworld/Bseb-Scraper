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
const BACKUP_FILE = "bseb-12th-full-result-2026.backup.json";

// Roll number range
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010999;

// ===============================
// SPEED SETTINGS
// ===============================
// Parallel roll codes at same time
const PARALLEL_ROLL_CODES = 5;

// Requests at once INSIDE one roll code
const CONCURRENCY_PER_ROLL = 80;

// How many roll numbers prepared in one loop
const BATCH_SIZE = 300;

// Request timeout
const REQUEST_TIMEOUT = 12000;

// Save after every X new students
const SAVE_EVERY_VALID_RESULTS = 100;

// Retry each student request
const STUDENT_RETRY = 2;

// Retry session fetch
const SESSION_RETRY = 3;

// ===============================
// SPLIT RANGE (CHANGE EACH RUN)
// ===============================
const START_INDEX = 1144;
const END_INDEX = 1150;

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
    "Upgrade-Insecure-Requests": "1",
    "Origin": "https://interbiharboard.com",
    "Referer": "https://interbiharboard.com/"
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

function getHidden($, name) {
  return clean($(`[name="${name}"]`).val() || $(`#${name}`).val() || "");
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isLikelyLfsPointer(text) {
  return typeof text === "string" &&
    text.includes("version https://git-lfs.github.com/spec/v1");
}

function loadJSON(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;

  try {
    const raw = fs.readFileSync(file, "utf8");

    if (!raw.trim()) {
      console.log(`⚠️ ${file} is empty. Using fallback.`);
      return fallback;
    }

    if (isLikelyLfsPointer(raw)) {
      console.log(`❌ ${file} is a Git LFS pointer, not real JSON.`);
      console.log(`⚠️ Using fallback so data is not overwritten blindly.`);
      return fallback;
    }

    return JSON.parse(raw);
  } catch (err) {
    console.log(`❌ Failed to parse ${file}: ${err.message}`);
    return fallback;
  }
}

function saveBackup(file, data) {
  try {
    saveCustomJSON(file, data);
  } catch (e) {
    console.log(`⚠️ Backup save failed: ${e.message}`);
  }
}

function detectAdditionalSection(text) {
  const t = clean(text).toLowerCase();
  if (t.includes("additional") || t.includes("अतिरिक्त")) {
    return clean(text);
  }
  return null;
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

function countTotalStudentsSaved(fullResults) {
  let total = 0;
  for (const rollCode of Object.keys(fullResults)) {
    total += Object.keys(fullResults[rollCode] || {}).length;
  }
  return total;
}

function writeProgress(text) {
  fs.writeFileSync(PROGRESS_FILE, text + "\n", "utf8");
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
    studentName: kv["Student's Name"] || kv["Student Name"] || null,
    fatherName: kv["Father's Name"] || kv["Father Name"] || null,
    regNumber: kv["Registration Number"] || null,
    BSEBUniqueId: kv["BSEB Unique Id"] || kv["BSEB Unique ID"] || null,
    schoolName: kv["School/College Name"] || kv["School Name"] || null,
    rollCode: kv["Roll Code"] || null,
    rollNo: kv["Roll Number"] || null,
    stream: kv["Faculty"] || kv["Stream"] || null,
    totalMarks: kv["Aggregate Marks"] || kv["Total Marks"] || null,
    Division: kv["Result/Division"] || kv["Division"] || kv["Result"] || null,
    subjects
  };
}

function isValidResult(result, rollCode, rollNo) {
  return (
    result &&
    result.studentName &&
    String(result.rollCode) === String(rollCode) &&
    String(result.rollNo) === String(rollNo)
  );
}

// ===============================
// SESSION FETCH
// ===============================
async function getSessionData() {
  for (let attempt = 1; attempt <= SESSION_RETRY; attempt++) {
    try {
      const res = await client.get(BASE_URL);
      const html = res.data;
      const $ = cheerio.load(html);

      const rawCookies = res.headers["set-cookie"] || [];
      const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

      const token = getHidden($, "__RequestVerificationToken");

      if (!token || !cookieHeader) {
        throw new Error("Token or cookie missing");
      }

      return {
        cookieHeader,
        token
      };
    } catch (err) {
      if (attempt === SESSION_RETRY) throw err;
      await sleep(500 * attempt);
    }
  }
}

// ===============================
// FETCH ONE RESULT
// ===============================
async function fetchStudentResult(rollCode, rollNo, sessionData) {
  for (let attempt = 1; attempt <= STUDENT_RETRY; attempt++) {
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

      const html = String(res.data || "");
      const htmlLower = html.toLowerCase();

      if (
        htmlLower.includes("incorrect captcha") ||
        htmlLower.includes("please enter correct captcha") ||
        htmlLower.includes("invalid captcha")
      ) {
        return { valid: false, reason: "captcha" };
      }

      if (
        htmlLower.includes("invalid") ||
        htmlLower.includes("no record") ||
        htmlLower.includes("not found") ||
        htmlLower.includes("roll code") && htmlLower.includes("roll number")
      ) {
        const result = extractFullResult(html);
        if (isValidResult(result, rollCode, rollNo)) {
          return { valid: true, data: result };
        }
        return { valid: false, reason: "notfound" };
      }

      const result = extractFullResult(html);

      if (isValidResult(result, rollCode, rollNo)) {
        return { valid: true, data: result };
      }

      return { valid: false, reason: "unknown" };
    } catch (err) {
      if (attempt === STUDENT_RETRY) {
        return { valid: false, reason: "error" };
      }
      await sleep(200 * attempt);
    }
  }

  return { valid: false, reason: "error" };
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
// PROCESS ONE ROLL CODE (FULL RECHECK)
// ===============================
async function processRollCode(rollCode, fullResults, state) {
  if (!fullResults[rollCode]) fullResults[rollCode] = {};

  const alreadySaved = Object.keys(fullResults[rollCode]).length;
  console.log(`▶️ Rechecking Roll Code ${rollCode} (already saved: ${alreadySaved})`);

  let foundNow = 0;
  let checkedNow = 0;
  let skippedAlreadySaved = 0;

  let currentRollNo = ROLLNO_START;

  while (currentRollNo <= ROLLNO_END) {
    const batchEnd = Math.min(currentRollNo + BATCH_SIZE - 1, ROLLNO_END);
    const batchRollNos = [];

    for (let rn = currentRollNo; rn <= batchEnd; rn++) {
      if (fullResults[rollCode][rn]) {
        skippedAlreadySaved++;
        continue;
      }
      batchRollNos.push(rn);
    }

    if (batchRollNos.length === 0) {
      currentRollNo = batchEnd + 1;
      continue;
    }

    let sessionData;
    try {
      sessionData = await getSessionData();
    } catch (err) {
      console.log(`⚠️ Session fetch failed for ${rollCode}, retrying batch...`);
      await sleep(1000);
      continue;
    }

    for (let i = 0; i < batchRollNos.length; i += CONCURRENCY_PER_ROLL) {
      const chunk = batchRollNos.slice(i, i + CONCURRENCY_PER_ROLL);

      const results = await Promise.all(
        chunk.map(rn => fetchStudentResult(rollCode, rn, sessionData))
      );

      for (let j = 0; j < chunk.length; j++) {
        const rn = chunk[j];
        const result = results[j];
        checkedNow++;

        if (result.valid && result.data) {
          if (!fullResults[rollCode][rn]) {
            fullResults[rollCode][rn] = result.data;
            foundNow++;
            state.unsavedValidCount++;
            state.totalStudentsSaved++;

            console.log(`   ✅ ${rollCode}-${rn} saved`);
          }
        }
      }

      if (state.unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
        saveBackup(BACKUP_FILE, fullResults);
        saveCustomJSON(OUTPUT_FILE, fullResults);
        writeProgress(`Last save: RollCode ${rollCode} | Total Saved: ${state.totalStudentsSaved}`);
        console.log(`💾 Progress Saved | Total Saved: ${state.totalStudentsSaved}`);
        state.unsavedValidCount = 0;
      }
    }

    currentRollNo = batchEnd + 1;
  }

  if (foundNow > 0) {
    saveBackup(BACKUP_FILE, fullResults);
    saveCustomJSON(OUTPUT_FILE, fullResults);
    writeProgress(`Completed RollCode ${rollCode} | Total Saved: ${state.totalStudentsSaved}`);
    console.log(`✅ Roll Code ${rollCode} finished | New Saved: ${foundNow} | Already Had: ${alreadySaved} | Total Now: ${alreadySaved + foundNow}`);
    state.unsavedValidCount = 0;
  } else {
    console.log(`⚠️ Roll Code ${rollCode} finished | No new student saved | Already had: ${alreadySaved} | Skipped existing: ${skippedAlreadySaved}`);
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
  saveBackup(BACKUP_FILE, fullResults);

  const state = {
    totalStudentsSaved: countTotalStudentsSaved(fullResults),
    unsavedValidCount: 0
  };

  console.log(`🚀 FULL RECHECK STARTED`);
  console.log(`📚 Total valid roll codes available: ${allValidRollCodes.length}`);
  console.log(`📦 Split range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this run: ${selectedRollCodes.length}`);
  console.log(`📦 Already saved students in JSON: ${state.totalStudentsSaved}`);
  console.log(`⚡ Parallel roll codes: ${PARALLEL_ROLL_CODES}`);
  console.log(`⚡ Concurrency per roll code: ${CONCURRENCY_PER_ROLL}`);

  for (let i = 0; i < selectedRollCodes.length; i += PARALLEL_ROLL_CODES) {
    const group = selectedRollCodes.slice(i, i + PARALLEL_ROLL_CODES);
    console.log(`\n🚀 Starting roll code group: ${group.join(", ")}`);

    await Promise.all(
      group.map(rollCode => processRollCode(rollCode, fullResults, state))
    );

    saveBackup(BACKUP_FILE, fullResults);
    saveCustomJSON(OUTPUT_FILE, fullResults);
    writeProgress(`Completed group ending at index ${i + group.length - 1} | Total Saved: ${state.totalStudentsSaved}`);
    console.log(`💾 Group Saved | Total Saved: ${state.totalStudentsSaved}`);
  }

  saveBackup(BACKUP_FILE, fullResults);
  saveCustomJSON(OUTPUT_FILE, fullResults);
  writeProgress(`FULL RECHECK COMPLETED | Total Saved: ${state.totalStudentsSaved}`);

  console.log(`\n🎉 FULL RECHECK COMPLETED | Total Saved: ${state.totalStudentsSaved}`);
})();
