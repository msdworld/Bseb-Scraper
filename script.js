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

// ===============================
// RECOVERY MODE SETTINGS
// ===============================
const START_INDEX = 800;
const END_INDEX = 5000; // all roll codes

const ROLL_CODE_GROUP_SIZE = 5;   // safe high speed
const CONCURRENCY = 35;           // per roll code
const BATCH_SIZE = 120;           // refresh session every batch
const REQUEST_TIMEOUT = 7000;

// Save frequency
const SAVE_EVERY_VALID_RESULTS = 100;

// Recovery logic
const FIRST_CHECK_LIMIT = 150;     // higher than before
const CONTINUOUS_FAIL_LIMIT = 100;  // much safer than old 20
const LOW_STUDENT_SUSPICIOUS_LIMIT = 100; // if already saved less than this, recheck fully

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

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

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
      "Referer": BASE_URL
    }
  });
}

// ===============================
// JSON FORMATTER
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

// ===============================
// RESULT PARSING
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
async function getSessionData(client) {
  const res = await client.get(BASE_URL);
  const html = res.data;
  const $ = cheerio.load(html);

  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");

  const token =
    clean($('input[name="__RequestVerificationToken"]').val() || "");

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
        "Cookie": sessionData.cookieHeader,
        "Origin": "https://interbiharboard.com",
        "Referer": BASE_URL
      }
    });

    const html = String(res.data || "");
    const htmlLower = html.toLowerCase();

    if (
      htmlLower.includes("incorrect captcha") ||
      htmlLower.includes("please enter correct captcha") ||
      htmlLower.includes("please enter captcha") ||
      htmlLower.includes("invalid token") ||
      htmlLower.includes("requestverificationtoken")
    ) {
      return { valid: false, tokenIssue: true };
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
// BUILD MISSING ROLL LIST
// ===============================
function buildRollNosToCheck(rollCode, fullResults) {
  const saved = fullResults[rollCode] || {};
  const savedKeys = new Set(Object.keys(saved));

  const savedCount = savedKeys.size;
  const suspiciousLow = savedCount > 0 && savedCount < LOW_STUDENT_SUSPICIOUS_LIMIT;

  const rollNos = [];

  for (let rn = ROLLNO_START; rn <= ROLLNO_END; rn++) {
    if (!savedKeys.has(String(rn))) {
      rollNos.push(rn);
    }
  }

  return {
    rollNos,
    savedCount,
    suspiciousLow
  };
}

// ===============================
// ONE ROLL CODE WORKER
// ===============================
async function processRollCode(rollCode, fullResults, counters) {
  if (!fullResults[rollCode]) fullResults[rollCode] = {};

  const { rollNos, savedCount, suspiciousLow } = buildRollNosToCheck(rollCode, fullResults);

  if (rollNos.length === 0) {
    console.log(`⏭️ Skipping ${rollCode} (already complete: ${savedCount} saved)`);
    return;
  }

  console.log(`▶️ Checking Roll Code ${rollCode} | Missing: ${rollNos.length} | Already Saved: ${savedCount}${suspiciousLow ? " | LOW COUNT RECHECK" : ""}`);

  const client = createClient();

  let foundInThisRun = 0;
  let continuousFail = 0;
  let checkedInThisRun = 0;
  let saveMilestoneTriggered = false;

  for (let start = 0; start < rollNos.length; start += BATCH_SIZE) {
    const batch = rollNos.slice(start, start + BATCH_SIZE);

    let sessionData;
    try {
      sessionData = await getSessionData(client);
    } catch {
      continue;
    }

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const chunk = batch.slice(i, i + CONCURRENCY);

      const results = await Promise.all(
        chunk.map(rn => fetchStudentResult(client, rollCode, rn, sessionData))
      );

      let tokenBroken = false;

      for (let j = 0; j < chunk.length; j++) {
        const rn = chunk[j];
        const result = results[j];
        checkedInThisRun++;

        if (result.tokenIssue) {
          tokenBroken = true;
          break;
        }

        if (result.valid) {
          continuousFail = 0;

          if (!fullResults[rollCode][rn]) {
            fullResults[rollCode][rn] = result.data;
            counters.unsavedValidCount++;
            counters.totalStudentsSaved++;
            foundInThisRun++;
          }
        } else {
          continuousFail++;
        }

        // Only allow early skip if roll code had zero saved before AND still nothing found
        if (savedCount === 0 && foundInThisRun === 0 && checkedInThisRun >= FIRST_CHECK_LIMIT) {
          console.log(`⏭️ Skipped ${rollCode} (No student found in first ${FIRST_CHECK_LIMIT})`);
          return;
        }

        // For recovery mode, use much safer stop
        if ((savedCount > 0 || suspiciousLow) && continuousFail >= CONTINUOUS_FAIL_LIMIT) {
          break;
        }
      }

      if (counters.unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
        saveCustomJSON(OUTPUT_FILE, fullResults);
        saveProgress(`Progress Saved | Total Saved: ${counters.totalStudentsSaved}`);
        console.log(`💾 Progress Saved | Total Saved: ${counters.totalStudentsSaved}`);
        counters.unsavedValidCount = 0;
        saveMilestoneTriggered = true;
      }

      if (tokenBroken) break;
      if ((savedCount > 0 || suspiciousLow) && continuousFail >= CONTINUOUS_FAIL_LIMIT) break;
    }

    if ((savedCount > 0 || suspiciousLow) && continuousFail >= CONTINUOUS_FAIL_LIMIT) break;
  }

  const finalCount = Object.keys(fullResults[rollCode] || {}).length;

  if (foundInThisRun > 0) {
    saveCustomJSON(OUTPUT_FILE, fullResults);
    saveProgress(`Saved ${foundInThisRun} new students from ${rollCode} | Final Count: ${finalCount} | Total Saved: ${counters.totalStudentsSaved}`);
    console.log(`✅ Saved ${foundInThisRun} new students from ${rollCode} | Final Count: ${finalCount} | Total Saved: ${counters.totalStudentsSaved}`);
    counters.unsavedValidCount = 0;
  } else {
    if (!saveMilestoneTriggered) {
      console.log(`⚠️ No new students saved from ${rollCode} | Existing Count: ${finalCount}`);
    }
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

  console.log(`🚀 BSEB RECOVERY MODE STARTED`);
  console.log(`📚 Total valid roll codes available: ${allValidRollCodes.length}`);
  console.log(`📦 Recovery range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this run: ${selectedRollCodes.length}`);
  console.log(`📦 Already saved students in JSON: ${counters.totalStudentsSaved}`);

  for (let i = 0; i < selectedRollCodes.length; i += ROLL_CODE_GROUP_SIZE) {
    const group = selectedRollCodes.slice(i, i + ROLL_CODE_GROUP_SIZE);

    console.log(`Starting roll code group: ${group.join(", ")}`);

    await Promise.all(
      group.map(rc => processRollCode(rc, fullResults, counters))
    );

    saveCustomJSON(OUTPUT_FILE, fullResults);
    saveProgress(`Completed group: ${group.join(", ")} | Total Saved: ${counters.totalStudentsSaved}`);
    console.log(`💾 Group Saved | Total Saved: ${counters.totalStudentsSaved}`);
  }

  saveCustomJSON(OUTPUT_FILE, fullResults);
  saveProgress(`RECOVERY COMPLETED | Range ${START_INDEX}-${END_INDEX} | Total Saved: ${counters.totalStudentsSaved}`);

  console.log(`🎉 RECOVERY COMPLETED | Range ${START_INDEX}-${END_INDEX} | Total Saved: ${counters.totalStudentsSaved}`);
})();
