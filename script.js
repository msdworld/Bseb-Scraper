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

// Full range to recheck
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010999;

// ===============================
// SPEED SETTINGS
// ===============================
const PARALLEL_ROLL_CODES = 3;      // 3 at once is safer
const CONCURRENCY_PER_ROLL = 40;    // requests per roll code
const SESSION_BATCH_SIZE = 120;     // use 1 session for 120 roll numbers
const REQUEST_TIMEOUT = 15000;
const SAVE_EVERY_NEW_STUDENTS = 50;

// ===============================
// SPLIT RANGE
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

    // If corrupted / LFS pointer / bad file
    if (
      raw.startsWith("version https://git-lfs.github.com/spec/v1") ||
      !raw.startsWith("{")
    ) {
      console.log(`❌ Failed to parse ${file}: Not actual JSON file`);
      return fallback;
    }

    return JSON.parse(raw);
  } catch (err) {
    console.log(`❌ Failed to parse ${file}: ${err.message}`);
    return fallback;
  }
}

function getHidden($, name) {
  return clean($(`input[name="${name}"]`).val() || "");
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
        .map((line, index) =>
          index === 0 ? `    ${JSON.stringify(rollNo)}: ${line}` : `    ${line}`
        )
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
async function getSessionData(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await client.get(BASE_URL);
      const html = res.data;
      const $ = cheerio.load(html);

      const rawCookies = res.headers["set-cookie"] || [];
      const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

      const token = getHidden($, "__RequestVerificationToken");

      if (!token) throw new Error("Token not found");

      return {
        cookieHeader,
        token
      };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
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
      htmlLower.includes("enter roll code") ||
      htmlLower.includes("enter roll number") ||
      htmlLower.includes("incorrect captcha") ||
      htmlLower.includes("please enter") ||
      htmlLower.includes("view result")
    ) {
      return { valid: false, reason: "form" };
    }

    const result = extractFullResult(html);

    if (
      result.studentName &&
      result.rollCode === String(rollCode) &&
      result.rollNo === String(rollNo)
    ) {
      return { valid: true, data: result };
    }

    return { valid: false, reason: "invalid" };
  } catch {
    return { valid: false, reason: "error" };
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
// PROCESS ONE ROLL CODE
// ===============================
async function processRollCode(rollCode, fullResults, counters) {
  if (!fullResults[rollCode]) fullResults[rollCode] = {};

  const existingRollNos = new Set(Object.keys(fullResults[rollCode]));
  const alreadySavedCount = existingRollNos.size;

  console.log(`▶️ Rechecking Roll Code ${rollCode} (already saved: ${alreadySavedCount})`);

  let newSaved = 0;
  let skippedExisting = 0;
  let checked = 0;

  let pendingRollNos = [];
  for (let rn = ROLLNO_START; rn <= ROLLNO_END; rn++) {
    if (existingRollNos.has(String(rn))) {
      skippedExisting++;
      continue;
    }
    pendingRollNos.push(rn);
  }

  if (!pendingRollNos.length) {
    console.log(`⏭️ Roll Code ${rollCode} already fully checked | Already had: ${alreadySavedCount}`);
    return;
  }

  for (let start = 0; start < pendingRollNos.length; start += SESSION_BATCH_SIZE) {
    const sessionBatch = pendingRollNos.slice(start, start + SESSION_BATCH_SIZE);

    let sessionData;
    try {
      sessionData = await getSessionData();
    } catch (err) {
      console.log(`⚠️ Session failed for ${rollCode}, batch skipped`);
      continue;
    }

    for (let i = 0; i < sessionBatch.length; i += CONCURRENCY_PER_ROLL) {
      const chunk = sessionBatch.slice(i, i + CONCURRENCY_PER_ROLL);

      const results = await Promise.all(
        chunk.map(rn => fetchStudentResult(rollCode, rn, sessionData))
      );

      for (let j = 0; j < chunk.length; j++) {
        const rn = chunk[j];
        const result = results[j];
        checked++;

        if (result.valid && !fullResults[rollCode][rn]) {
          fullResults[rollCode][rn] = result.data;
          newSaved++;
          counters.totalStudentsSaved++;
          counters.unsavedValidCount++;

          console.log(`✅ Found ${rollCode}-${rn} | New Saved: ${newSaved}`);
        }
      }

      if (counters.unsavedValidCount >= SAVE_EVERY_NEW_STUDENTS) {
        saveCustomJSON(OUTPUT_FILE, fullResults);
        console.log(`💾 Progress Saved | Total Saved: ${counters.totalStudentsSaved}`);
        counters.unsavedValidCount = 0;
      }
    }
  }

  saveCustomJSON(OUTPUT_FILE, fullResults);

  if (newSaved > 0) {
    console.log(
      `✅ Roll Code ${rollCode} finished | New Saved: ${newSaved} | Already had: ${alreadySavedCount} | Skipped existing: ${skippedExisting}`
    );
  } else {
    console.log(
      `⚠️ Roll Code ${rollCode} finished | No new student saved | Already had: ${alreadySavedCount} | Skipped existing: ${skippedExisting}`
    );
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
  const counters = {
    totalStudentsSaved: countTotalStudentsSaved(fullResults),
    unsavedValidCount: 0
  };

  console.log(`🚀 FULL RECHECK STARTED`);
  console.log(`📚 Total valid roll codes available: ${allValidRollCodes.length}`);
  console.log(`📦 Split range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this run: ${selectedRollCodes.length}`);
  console.log(`📦 Already saved students in JSON: ${counters.totalStudentsSaved}`);
  console.log(`⚡ Parallel roll codes: ${PARALLEL_ROLL_CODES}`);
  console.log(`⚡ Concurrency per roll code: ${CONCURRENCY_PER_ROLL}`);

  for (let i = 0; i < selectedRollCodes.length; i += PARALLEL_ROLL_CODES) {
    const group = selectedRollCodes.slice(i, i + PARALLEL_ROLL_CODES);
    console.log(`\n🚀 Starting roll code group: ${group.join(", ")}`);

    await Promise.all(group.map(rc => processRollCode(rc, fullResults, counters)));
  }

  saveCustomJSON(OUTPUT_FILE, fullResults);
  console.log(`\n🎉 FULL RECHECK COMPLETED | Total Saved: ${counters.totalStudentsSaved}`);
})();
