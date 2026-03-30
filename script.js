const { chromium } = require("playwright");
const cheerio = require("cheerio");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const BASE_URL = "https://interbiharboard.com/";

const VALID_ROLL_CODE_FILE = "bseb-12th-college-list-2026.json";
const OUTPUT_FILE = "bseb-12th-full-result-2026.json";

// Roll number range per roll code
const ROLLNO_START = 26010001;
const ROLLNO_END = 26010999;

// Skip logic
const FIRST_CHECK_LIMIT = 100;
const CONTINUOUS_FAIL_LIMIT = 20;

// Speed (KEEP LOW FOR PLAYWRIGHT)
const CONCURRENCY = 3;
const BATCH_SIZE = 30;

// Save
const SAVE_EVERY_VALID_RESULTS = 100;

// ===============================
// SPLIT RANGE (CHANGE EACH RUN)
// ===============================
const START_INDEX = 129;
const END_INDEX = 150;

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
// LOAD VALID ROLL CODES
// ===============================
function loadValidRollCodes() {
  const raw = loadJSON(VALID_ROLL_CODE_FILE, {});
  return Object.keys(raw)
    .filter(code => /^\d+$/.test(code))
    .sort((a, b) => Number(a) - Number(b));
}

// ===============================
// FETCH ONE RESULT (PLAYWRIGHT)
// ===============================
async function fetchStudentResult(browser, rollCode, rollNo) {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();

  try {
    await page.goto(BASE_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForSelector('input[name="rollcode"]', { timeout: 15000 });
    await page.waitForSelector('input[name="rollno"]', { timeout: 15000 });
    await page.waitForSelector('#generatedCaptcha', { timeout: 15000 });
    await page.waitForSelector('input[name="captcha"]', { timeout: 15000 });

    await page.fill('input[name="rollcode"]', String(rollCode));
    await page.fill('input[name="rollno"]', String(rollNo));

    const captchaValue = await page.$eval("#generatedCaptcha", el => {
      return (el.dataset.value || el.textContent || "").trim();
    });

    if (!captchaValue || captchaValue.length !== 6) {
      await context.close();
      return { valid: false };
    }

    await page.fill('input[name="captcha"]', captchaValue);

    await Promise.all([
      page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]')
    ]);

    const finalUrl = page.url();
    const html = await page.content();
    const htmlLower = String(html || "").toLowerCase();

    if (
      htmlLower.includes("incorrect captcha") ||
      htmlLower.includes("please enter captcha") ||
      htmlLower.includes("invalid captcha")
    ) {
      await context.close();
      return { valid: false };
    }

    if (
      htmlLower.includes("invalid") ||
      htmlLower.includes("no record") ||
      htmlLower.includes("not found")
    ) {
      await context.close();
      return { valid: false };
    }

    const result = extractFullResult(html);

    if (
      result.studentName &&
      result.rollCode === String(rollCode) &&
      result.rollNo === String(rollNo)
    ) {
      await context.close();
      return { valid: true, data: result, finalUrl };
    }

    await context.close();
    return { valid: false, finalUrl };
  } catch {
    await context.close();
    return { valid: false };
  }
}

// ===============================
// PROCESS CHUNK
// ===============================
async function processChunk(browser, rollCode, chunk) {
  return await Promise.all(
    chunk.map(rn => fetchStudentResult(browser, rollCode, rn))
  );
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

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  console.log(`🚀 SPLIT FULL RESULT SCRAPER STARTED`);
  console.log(`📚 Total valid roll codes available: ${allValidRollCodes.length}`);
  console.log(`📦 Split range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this split: ${selectedRollCodes.length}`);
  console.log(`📦 Already saved students in JSON: ${totalStudentsSaved}`);

  for (let rcIndex = 0; rcIndex < selectedRollCodes.length; rcIndex++) {
    const rollCode = selectedRollCodes[rcIndex];

    if (!fullResults[rollCode]) fullResults[rollCode] = {};

    const alreadySavedForRollCode = Object.keys(fullResults[rollCode]).length;
    if (alreadySavedForRollCode > 0) {
      console.log(`⏭️ Skipping ${rollCode} (already has ${alreadySavedForRollCode} students saved)`);
      continue;
    }

    let currentRollNo = ROLLNO_START;
    let foundInThisRollCode = 0;
    let continuousFail = 0;
    let checkedInThisRollCode = 0;
    let savedInThisRollCode = 0;

    console.log(`▶️ Checking Roll Code ${rollCode}`);

    while (currentRollNo <= ROLLNO_END) {
      const batchEnd = Math.min(currentRollNo + BATCH_SIZE - 1, ROLLNO_END);
      const batchRollNos = [];

      for (let rn = currentRollNo; rn <= batchEnd; rn++) {
        batchRollNos.push(rn);
      }

      for (let i = 0; i < batchRollNos.length; i += CONCURRENCY) {
        const chunk = batchRollNos.slice(i, i + CONCURRENCY);
        const results = await processChunk(browser, rollCode, chunk);

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
            console.log(`⏭️ Skipped ${rollCode} (No student found in first ${FIRST_CHECK_LIMIT})`);
            currentRollNo = ROLLNO_END + 1;
            break;
          }

          if (foundInThisRollCode > 0 && continuousFail >= CONTINUOUS_FAIL_LIMIT) {
            console.log(`⏹️ Stopped ${rollCode} after ${CONTINUOUS_FAIL_LIMIT} continuous fail`);
            currentRollNo = ROLLNO_END + 1;
            break;
          }
        }

        if (unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
          saveCustomJSON(OUTPUT_FILE, fullResults);
          console.log(`💾 Progress Saved | Total Saved: ${totalStudentsSaved}`);
          unsavedValidCount = 0;
        }

        if (currentRollNo > ROLLNO_END) break;
      }

      if (currentRollNo > ROLLNO_END) break;
      currentRollNo = batchEnd + 1;
    }

    if (savedInThisRollCode > 0) {
      saveCustomJSON(OUTPUT_FILE, fullResults);
      console.log(`✅ Saved ${savedInThisRollCode} students from ${rollCode} | Total Saved: ${totalStudentsSaved}`);
      unsavedValidCount = 0;
    } else {
      console.log(`⚠️ No students saved from ${rollCode}`);
    }
  }

  await browser.close();

  saveCustomJSON(OUTPUT_FILE, fullResults);
  console.log(`🎉 SPLIT COMPLETED | Range ${START_INDEX}-${END_INDEX} | Total Saved: ${totalStudentsSaved}`);
})();
