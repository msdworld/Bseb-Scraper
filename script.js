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
const BACKUP_FILE = "bseb-12th-full-result-2026.backup.json";
const PROGRESS_FILE = "progress.txt";

// Roll number range
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010999;

// Speed
const ROLL_CODE_PARALLEL = 8;      // how many roll codes at once
const CONCURRENCY_PER_ROLL = 80;   // how many rollnos at once per roll code
const REQUEST_TIMEOUT = 8000;
const SAVE_EVERY_VALID_RESULTS = 100;

// Split
const START_INDEX = 250;
const END_INDEX = 300;

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
    const raw = fs.readFileSync(file, "utf8").trim();
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.log(`❌ Failed to parse ${file}: ${err.message}`);
    return fallback;
  }
}

function writeProgress(text) {
  fs.writeFileSync(PROGRESS_FILE, text, "utf8");
}

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function countTotalStudentsSaved(fullResults) {
  let total = 0;
  for (const rollCode of Object.keys(fullResults)) {
    total += Object.keys(fullResults[rollCode] || {}).length;
  }
  return total;
}

// ===============================
// SAFE SAVE (VERY IMPORTANT)
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

  const tempFile = file + ".tmp";
  fs.writeFileSync(tempFile, lines.join("\n"), "utf8");

  const tempStat = fs.statSync(tempFile);
  if (tempStat.size < 1000) {
    throw new Error(`TEMP SAVE TOO SMALL (${tempStat.size} bytes). Refusing overwrite.`);
  }

  if (fs.existsSync(file)) {
    fs.copyFileSync(file, BACKUP_FILE);
  }

  fs.renameSync(tempFile, file);
}

// ===============================
// PARSING
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

      if (cells[4]) obj.practical = clean(cells[4]);
      if (cells[5]) obj.regulationTheory = clean(cells[5]);
      if (cells[6]) obj.regulationPractical = clean(cells[6]);
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
  const res = await client.get(FORM_URL);
  const html = res.data;
  const $ = cheerio.load(html);

  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

  const token =
    $('input[name="__RequestVerificationToken"]').val() ||
    $('input[name="__RequestVerificationToken"]').attr("value") ||
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
// FETCH ONE STUDENT
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
        "Referer": FORM_URL,
        "Origin": "https://interbiharboard.com"
      }
    });

    const html = String(res.data || "");
    const htmlLower = html.toLowerCase();

    if (
      htmlLower.includes("incorrect captcha") ||
      htmlLower.includes("please enter captcha") ||
      htmlLower.includes("please enter roll code") ||
      htmlLower.includes("please enter roll number")
    ) {
      return { valid: false, retryable: true };
    }

    if (
      htmlLower.includes("invalid") ||
      htmlLower.includes("no record") ||
      htmlLower.includes("not found")
    ) {
      return { valid: false, retryable: false };
    }

    const result = extractFullResult(html);

    if (
      result.studentName &&
      String(result.rollCode) === String(rollCode) &&
      String(result.rollNo) === String(rollNo)
    ) {
      return { valid: true, data: result };
    }

    return { valid: false, retryable: false };
  } catch {
    return { valid: false, retryable: true };
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
// PROCESS ONE ROLL CODE (FULL RECHECK)
// ===============================
async function processRollCode(rollCode, fullResults, state) {
  if (!fullResults[rollCode]) fullResults[rollCode] = {};

  const alreadySavedCount = Object.keys(fullResults[rollCode]).length;
  let newlySaved = 0;

  console.log(`▶️ Rechecking Roll Code ${rollCode} (already saved: ${alreadySavedCount})`);

  let sessionData = await getSessionData();

  const missingRollNos = [];
  for (let rn = ROLLNO_START; rn <= ROLLNO_END; rn++) {
    if (!fullResults[rollCode][rn]) {
      missingRollNos.push(rn);
    }
  }

  if (!missingRollNos.length) {
    console.log(`✅ ${rollCode} already complete (999/999 checked & saved where valid)`);
    return;
  }

  for (let i = 0; i < missingRollNos.length; i += CONCURRENCY_PER_ROLL) {
    const chunk = missingRollNos.slice(i, i + CONCURRENCY_PER_ROLL);

    let results = await Promise.all(
      chunk.map(rn => fetchStudentResult(rollCode, rn, sessionData))
    );

    // Retry only failed/retryable ones with fresh session
    const retryIndexes = [];
    for (let j = 0; j < results.length; j++) {
      if (!results[j].valid && results[j].retryable) {
        retryIndexes.push(j);
      }
    }

    if (retryIndexes.length) {
      sessionData = await getSessionData();

      const retryResults = await Promise.all(
        retryIndexes.map(idx => fetchStudentResult(rollCode, chunk[idx], sessionData))
      );

      retryIndexes.forEach((originalIndex, k) => {
        results[originalIndex] = retryResults[k];
      });
    }

    for (let j = 0; j < chunk.length; j++) {
      const rn = chunk[j];
      const result = results[j];

      if (result.valid && !fullResults[rollCode][rn]) {
        fullResults[rollCode][rn] = result.data;
        newlySaved++;
        state.totalStudentsSaved++;
        state.unsavedValidCount++;

        console.log(`   ➕ ${rollCode} -> ${rn} saved`);
      }
    }

    if (state.unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
      saveCustomJSON(OUTPUT_FILE, fullResults);
      writeProgress(`Last roll code: ${rollCode} | Total Saved: ${state.totalStudentsSaved}`);
      console.log(`💾 Progress Saved | Total Saved: ${state.totalStudentsSaved}`);
      state.unsavedValidCount = 0;
    }
  }

  if (newlySaved > 0) {
    saveCustomJSON(OUTPUT_FILE, fullResults);
    writeProgress(`Last roll code: ${rollCode} | Total Saved: ${state.totalStudentsSaved}`);
    console.log(`✅ ${rollCode} recheck complete | New saved: ${newlySaved} | Total Saved: ${state.totalStudentsSaved}`);
    state.unsavedValidCount = 0;
  } else {
    console.log(`⚠️ ${rollCode} had already saved ${alreadySavedCount} students (no new student saved for this roll code)`);
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

  const state = {
    totalStudentsSaved,
    unsavedValidCount: 0
  };

  console.log(`🚀 FULL RECHECK STARTED`);
  console.log(`📚 Total valid roll codes available: ${allValidRollCodes.length}`);
  console.log(`📦 Split range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this run: ${selectedRollCodes.length}`);
  console.log(`📦 Already saved students in JSON: ${state.totalStudentsSaved}`);
  console.log(`⚡ Parallel roll codes: ${ROLL_CODE_PARALLEL}`);
  console.log(`⚡ Concurrency per roll code: ${CONCURRENCY_PER_ROLL}`);

  for (let i = 0; i < selectedRollCodes.length; i += ROLL_CODE_PARALLEL) {
    const group = selectedRollCodes.slice(i, i + ROLL_CODE_PARALLEL);

    console.log(`\n🚀 Starting roll code group: ${group.join(", ")}`);

    await Promise.all(
      group.map(rc => processRollCode(rc, fullResults, state))
    );

    saveCustomJSON(OUTPUT_FILE, fullResults);
    writeProgress(`Completed group ending at index ${i + group.length - 1} | Total Saved: ${state.totalStudentsSaved}`);
    console.log(`💾 Group Saved | Total Saved: ${state.totalStudentsSaved}`);
  }

  saveCustomJSON(OUTPUT_FILE, fullResults);
  writeProgress(`FULL RECHECK COMPLETED | Total Saved: ${state.totalStudentsSaved}`);

  console.log(`🎉 FULL RECHECK COMPLETED | Total Saved: ${state.totalStudentsSaved}`);
})();
