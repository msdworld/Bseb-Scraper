const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";
const POST_URL = "https://interbiharboard.com/Result/GetResult";
const SHOW_RESULT_URL = "https://interbiharboard.com/Result/ShowResult";

const VALID_ROLL_CODE_FILE = "bseb-12th-college-list-2026.json";

const BASE_DIR = "BSEB 12TH RESULT/Bseb 12th Result 2026";

// Roll number range per roll code
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010999;

// SPEED
const ROLLCODE_PARALLEL = 10; // 10 or more as you asked
const CONCURRENCY = 200;      // aggressive but still safer than 900
const BATCH_SIZE = 50;
const REQUEST_TIMEOUT = 7000;

// SAVE
const SAVE_EVERY_VALID_RESULTS = 100;

// ===============================
// DISTRICT CONFIG FROM ENV
// ===============================
const DISTRICT_PREFIX = process.env.DISTRICT_PREFIX || "13";
const DISTRICT_NAME = process.env.DISTRICT_NAME || "arabhojpur";

const OUTPUT_FILE = path.join(
  BASE_DIR,
  `${DISTRICT_NAME}-${DISTRICT_PREFIX}-bseb-12th-full-result-2026.json`
);

// ===============================
// AXIOS CLIENT
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  maxRedirects: 0,
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

function generateCaptcha() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function loadJSON(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    console.log(`❌ Failed to parse ${file}: ${e.message}`);
    return fallback;
  }
}

function detectAdditionalSection(text) {
  const t = clean(text).toLowerCase();
  if (t.includes("additional") || t.includes("अतिरिक्त")) {
    return clean(text);
  }
  return null;
}

function extractRequestVerificationToken(html) {
  const $ = cheerio.load(html);
  return clean($('input[name="__RequestVerificationToken"]').val() || "");
}

function mergeCookies(oldCookieHeader, newSetCookies = []) {
  const jar = {};

  function addCookieString(str) {
    if (!str) return;
    str.split(";").forEach(part => {
      const p = part.trim();
      if (!p.includes("=")) return;
      const [k, ...rest] = p.split("=");
      const v = rest.join("=");
      if (k && v !== undefined) jar[k.trim()] = v.trim();
    });
  }

  addCookieString(oldCookieHeader);

  newSetCookies.forEach(c => {
    const first = c.split(";")[0];
    addCookieString(first);
  });

  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
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
  const fd = fs.openSync(file, "w");

  try {
    fs.writeSync(fd, "{\n");

    rollCodes.forEach((rollCode, idx) => {
      const students = data[rollCode] || {};
      const rollNoKeys = Object.keys(students).sort((a, b) => Number(a) - Number(b));

      fs.writeSync(fd, `  ${JSON.stringify(rollCode)}: {\n`);

      rollNoKeys.forEach((rollNo, i) => {
        const student = students[rollNo];
        const formatted = formatStudent(student, "      ")
          .split("\n")
          .map((line, index) => (index === 0 ? `    ${JSON.stringify(rollNo)}: ${line}` : `    ${line}`))
          .join("\n");

        fs.writeSync(fd, formatted + (i < rollNoKeys.length - 1 ? "," : "") + "\n");
      });

      fs.writeSync(fd, `  }${idx < rollCodes.length - 1 ? "," : ""}\n`);
    });

    fs.writeSync(fd, "}\n");
  } finally {
    fs.closeSync(fd);
  }
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

      if (cells[4]) obj.practical = clean(cells[4] || "");
      if (cells[5]) obj.regulationTheory = clean(cells[5] || "");
      if (cells[6]) obj.regulationPractical = clean(cells[6] || "");

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
    BSEBUniqueId: kv["BSEB Unique Id"] || null,
    schoolName: kv["School/College Name"] || kv["College Name"] || null,
    rollCode: kv["Roll Code"] || null,
    rollNo: kv["Roll Number"] || null,
    stream: kv["Faculty"] || kv["Stream"] || null,
    totalMarks: kv["Aggregate Marks"] || kv["Total Marks"] || null,
    Division: kv["Result/Division"] || kv["Division"] || null,
    subjects
  };
}

// ===============================
// SESSION FETCH
// ===============================
async function getSessionData() {
  const res = await client.get(BASE_URL);

  const html = res.data;
  const rawCookies = res.headers["set-cookie"] || [];
  const cookieHeader = rawCookies.map(c => c.split(";")[0]).join("; ");
  const requestVerificationToken = extractRequestVerificationToken(html);

  if (!requestVerificationToken) {
    throw new Error("Could not fetch RequestVerificationToken");
  }

  return {
    cookieHeader,
    requestVerificationToken
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
    payload.append("__RequestVerificationToken", sessionData.requestVerificationToken);

    const postRes = await client.post(POST_URL, payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": sessionData.cookieHeader,
        "Referer": BASE_URL,
        "Origin": "https://interbiharboard.com"
      }
    });

    let cookieHeader = mergeCookies(
      sessionData.cookieHeader,
      postRes.headers["set-cookie"] || []
    );

    let resultHtml = "";

    if (postRes.status >= 300 && postRes.status < 400 && postRes.headers.location) {
      const location = postRes.headers.location.startsWith("http")
        ? postRes.headers.location
        : `https://interbiharboard.com${postRes.headers.location}`;

      const followRes = await client.get(location, {
        headers: {
          "Cookie": cookieHeader,
          "Referer": POST_URL
        },
        maxRedirects: 5
      });

      resultHtml = followRes.data;
      cookieHeader = mergeCookies(cookieHeader, followRes.headers["set-cookie"] || []);
    } else {
      resultHtml = postRes.data;
    }

    const lower = String(resultHtml || "").toLowerCase();

    const looksLikeFormAgain =
      lower.includes("enter roll code") &&
      lower.includes("enter roll number") &&
      lower.includes("view result");

    if (looksLikeFormAgain) {
      const showRes = await client.get(SHOW_RESULT_URL, {
        headers: {
          "Cookie": cookieHeader,
          "Referer": POST_URL
        },
        maxRedirects: 5
      });

      resultHtml = showRes.data;
    }

    const htmlLower = String(resultHtml || "").toLowerCase();

    if (
      htmlLower.includes("invalid") ||
      htmlLower.includes("no record") ||
      htmlLower.includes("not found") ||
      htmlLower.includes("incorrect captcha")
    ) {
      return { valid: false };
    }

    const result = extractFullResult(resultHtml);

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
    .filter(code => String(code).startsWith(DISTRICT_PREFIX))
    .sort((a, b) => Number(a) - Number(b));
}

// ===============================
// GLOBAL STATE
// ===============================
const saveState = {
  fullResults: {},
  totalStudentsSavedInFile: 0,
  savedThisRun: 0,
  unsavedValidCount: 0
};

// ===============================
// PROCESS ONE ROLL CODE
// ===============================
async function processRollCode(rollCode) {
  if (!saveState.fullResults[rollCode]) saveState.fullResults[rollCode] = {};

  const existingRollNos = new Set(Object.keys(saveState.fullResults[rollCode] || {}));
  const alreadySavedForRollCode = existingRollNos.size;

  let newSavedForRollCode = 0;
  let checkedForRollCode = 0;

  console.log(`▶️ ${rollCode} | Already Saved: ${alreadySavedForRollCode}`);

  let currentRollNo = ROLLNO_START;

  while (currentRollNo <= ROLLNO_END) {
    const batchEnd = Math.min(currentRollNo + BATCH_SIZE - 1, ROLLNO_END);
    const batchRollNos = [];

    for (let rn = currentRollNo; rn <= batchEnd; rn++) {
      checkedForRollCode++;
      if (existingRollNos.has(String(rn))) continue;
      batchRollNos.push(rn);
    }

    for (let i = 0; i < batchRollNos.length; i += CONCURRENCY) {
      const chunk = batchRollNos.slice(i, i + CONCURRENCY);

      const results = await Promise.all(
        chunk.map(rn => fetchStudentResult(rollCode, rn))
      );

      for (let j = 0; j < chunk.length; j++) {
        const rn = chunk[j];
        const result = results[j];

        if (result.valid) {
          if (!saveState.fullResults[rollCode][rn]) {
            saveState.fullResults[rollCode][rn] = result.data;
            existingRollNos.add(String(rn));

            saveState.unsavedValidCount++;
            saveState.savedThisRun++;
            saveState.totalStudentsSavedInFile++;
            newSavedForRollCode++;

            console.log(`${rollCode}-${String(rn).slice(-3)} student saved`);
          }
        }
      }

      if (saveState.unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
        saveCustomJSON(OUTPUT_FILE, saveState.fullResults);
        console.log(`💾 Progress Saved | This Run: ${saveState.savedThisRun} | File Total: ${saveState.totalStudentsSavedInFile}`);
        saveState.unsavedValidCount = 0;
      }
    }

    currentRollNo = batchEnd + 1;
  }

  const totalNowForRollCode = Object.keys(saveState.fullResults[rollCode] || {}).length;

  console.log(
    `✅ ${rollCode} | Already: ${alreadySavedForRollCode} | New: ${newSavedForRollCode} | Total Now: ${totalNowForRollCode}`
  );
}

// ===============================
// MAIN
// ===============================
(async () => {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }

  const allValidRollCodes = loadValidRollCodes();

  if (!allValidRollCodes.length) {
    console.log(`❌ No valid roll codes found for district prefix ${DISTRICT_PREFIX}`);
    return;
  }

  saveState.fullResults = loadJSON(OUTPUT_FILE, {});
  saveState.totalStudentsSavedInFile = countTotalStudentsSaved(saveState.fullResults);
  saveState.savedThisRun = 0;
  saveState.unsavedValidCount = 0;

  console.log(`🚀 12TH DISTRICT RECHECK STARTED`);
  console.log(`🏙️ District: ${DISTRICT_NAME}`);
  console.log(`🔢 Prefix: ${DISTRICT_PREFIX}`);
  console.log(`📚 Roll Codes To Check: ${allValidRollCodes.length}`);
  console.log(`📦 Already In File Total: ${saveState.totalStudentsSavedInFile}`);
  console.log(`⚡ Parallel Roll Codes: ${ROLLCODE_PARALLEL}`);
  console.log(`⚡ RollNo Concurrency per Roll Code: ${CONCURRENCY}`);

  for (let i = 0; i < allValidRollCodes.length; i += ROLLCODE_PARALLEL) {
    const rollCodeChunk = allValidRollCodes.slice(i, i + ROLLCODE_PARALLEL);

    console.log(`🚀 Roll Code Group: ${rollCodeChunk.join(", ")}`);

    await Promise.all(
      rollCodeChunk.map(rollCode => processRollCode(rollCode))
    );

    saveCustomJSON(OUTPUT_FILE, saveState.fullResults);

    console.log(
      `💾 Group Saved | Completed: ${Math.min(i + ROLLCODE_PARALLEL, allValidRollCodes.length)}/${allValidRollCodes.length} | This Run: ${saveState.savedThisRun} | File Total: ${saveState.totalStudentsSavedInFile}`
    );
  }

  saveCustomJSON(OUTPUT_FILE, saveState.fullResults);

  console.log(`🎉 DISTRICT RECHECK COMPLETED`);
  console.log(`🏙️ District: ${DISTRICT_NAME}`);
  console.log(`🔢 Prefix: ${DISTRICT_PREFIX}`);
  console.log(`📦 Saved In This Run: ${saveState.savedThisRun}`);
  console.log(`📁 Final File Total: ${saveState.totalStudentsSavedInFile}`);
})();
