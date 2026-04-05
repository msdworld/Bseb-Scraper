const axios = require("axios");
const fs = require("fs");
const zlib = require("zlib");

// ===============================
// CONFIG
// ===============================
const API_URL = "https://resultapi.biharboardonline.org/result";

const SCHOOL_LIST_FILE = "bseb-10th-school-list-2026.json";
const OUTPUT_JSON = "bseb-10th-full-result-2026.json";
const OUTPUT_GZ = "bseb-10th-full-result-2026.json.gz";

// Roll number range per roll code
const ROLLNO_START = 2600001;
const ROLLNO_END = 2600999;

// SPEED
const ROLLCODE_PARALLEL = 1000;
const CONCURRENCY = 1000;
const BATCH_SIZE = 100;
const REQUEST_TIMEOUT = 6000;

// SAVE
const SAVE_EVERY_VALID_RESULTS = 100;

// ===============================
// SPLIT RANGE (CHANGE EACH RUN)
// ===============================
const START_INDEX = 1;
const END_INDEX = 1000;

// ===============================
// AXIOS CLIENT
// ===============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Referer": "https://result.biharboardonline.org/",
    "Origin": "https://result.biharboardonline.org"
  }
});

// ===============================
// HELPERS
// ===============================
function clean(txt) {
  return String(txt || "").replace(/\s+/g, " ").trim();
}

function normalizeMarks(val) {
  if (val === null || val === undefined) return "";
  const str = String(val).trim();
  if (!str) return "";
  return String(Number(str));
}

function loadJSON(file, fallback = {}) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function tryLoadFromGZ() {
  if (!fs.existsSync(OUTPUT_GZ)) return {};
  try {
    const gzRaw = fs.readFileSync(OUTPUT_GZ);
    const jsonRaw = zlib.gunzipSync(gzRaw).toString("utf8");
    return JSON.parse(jsonRaw);
  } catch {
    return {};
  }
}

function loadSchoolRollCodes() {
  const raw = loadJSON(SCHOOL_LIST_FILE, {});
  return Object.keys(raw)
    .filter(code => /^\d+$/.test(code))
    .sort((a, b) => Number(a) - Number(b));
}

function countTotalStudentsSaved(fullResults) {
  let total = 0;
  for (const rollCode of Object.keys(fullResults)) {
    total += Object.keys(fullResults[rollCode] || {}).length;
  }
  return total;
}

function compressJSONToGZ() {
  if (!fs.existsSync(OUTPUT_JSON)) return;
  const raw = fs.readFileSync(OUTPUT_JSON);
  const gz = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(OUTPUT_GZ, gz);
}

// ===============================
// SUBJECT FORMATTER (ONE LINER)
// ===============================
function buildPractical(subject) {
  const projectWork = normalizeMarks(subject.project_work);
  const literacyActivity = normalizeMarks(subject.literacy_activity);
  const iaSci = normalizeMarks(subject.ia_sci);
  const practical = normalizeMarks(subject.practical);

  if (subject.sub_code === "111") {
    const parts = [];
    if (projectWork) parts.push(projectWork);
    if (literacyActivity) parts.push(literacyActivity);
    return parts.join("+");
  }

  if (subject.sub_code === "112") {
    if (iaSci) return iaSci;
  }

  if (practical) return practical;

  const parts = [];
  if (projectWork) parts.push(projectWork);
  if (literacyActivity) parts.push(literacyActivity);
  if (iaSci) parts.push(iaSci);

  return parts.join("+");
}

function formatSubjects(subjects = []) {
  return subjects.map(sub => {
    const obj = {
      subCode: clean(sub.sub_code || ""),
      subject: clean(sub.sub_name || ""),
      theory: normalizeMarks(sub.theory || ""),
      subGroupId: clean(sub.sub_group_id || ""),
      subTotal: normalizeMarks(sub.sub_total || "")
    };

    const practical = buildPractical(sub);
    if (practical) obj.practical = practical;

    if (sub.sub_result !== null && sub.sub_result !== undefined && clean(sub.sub_result) !== "") {
      obj.subResult = clean(sub.sub_result);
    }

    if (sub.regulation !== null && sub.regulation !== undefined && clean(sub.regulation) !== "") {
      obj.regulation = clean(sub.regulation);
    }

    if (sub.cce !== null && sub.cce !== undefined && clean(sub.cce) !== "") {
      obj.cce = clean(sub.cce);
    }

    if (sub.is_compartmental !== null && sub.is_compartmental !== undefined && clean(sub.is_compartmental) !== "") {
      obj.isCompartmental = clean(sub.is_compartmental);
    }

    if (sub.is_improved_sub !== null && sub.is_improved_sub !== undefined && clean(sub.is_improved_sub) !== "") {
      obj.isImprovedSub = clean(sub.is_improved_sub);
    }

    return obj;
  });
}

// ===============================
// RESULT FORMATTER
// ===============================
function formatStudent(data) {
  const student = {
    studentName: clean(data.name || ""),
    fatherName: clean(data.father_name || ""),
    regNumber: clean(data.reg_no || ""),
    BSEBUniqueId: clean(data.bseb_id || ""),
    schoolName: clean(data.school_name || ""),
    rollCode: clean(data.roll_code || ""),
    rollNo: clean(data.roll_no || ""),
    examType: clean(data.exam_type || ""),
    totalMarks: normalizeMarks(data.total || ""),
    division: clean(data.division || ""),
    subjects: formatSubjects(data.subjects || [])
  };

  if (data.passed_under_regulation !== null && data.passed_under_regulation !== undefined && clean(data.passed_under_regulation) !== "") {
    student.passedUnderRegulation = clean(data.passed_under_regulation);
  }

  if (data.is_topper === true) {
    student.isTopper = true;
  }

  if (data.is_improved_result !== null && data.is_improved_result !== undefined && clean(data.is_improved_result) !== "") {
    student.isImprovedResult = clean(data.is_improved_result);
  }

  if (data.is_expelled !== null && data.is_expelled !== undefined && clean(data.is_expelled) !== "") {
    student.isExpelled = clean(data.is_expelled);
  }

  if (data.division_grace_marks !== null && data.division_grace_marks !== undefined && clean(data.division_grace_marks) !== "") {
    student.divisionGraceMarks = clean(data.division_grace_marks);
  }

  return student;
}

// ===============================
// CUSTOM JSON FORMATTER
// ===============================
function formatStudentJSON(student, indent = "    ") {
  const lines = [];
  lines.push("{");
  lines.push(`${indent}"studentName": ${JSON.stringify(student.studentName)},`);
  lines.push(`${indent}"fatherName": ${JSON.stringify(student.fatherName)},`);
  lines.push(`${indent}"regNumber": ${JSON.stringify(student.regNumber)},`);
  lines.push(`${indent}"BSEBUniqueId": ${JSON.stringify(student.BSEBUniqueId)},`);
  lines.push(`${indent}"schoolName": ${JSON.stringify(student.schoolName)},`);
  lines.push(`${indent}"rollCode": ${JSON.stringify(student.rollCode)},`);
  lines.push(`${indent}"rollNo": ${JSON.stringify(student.rollNo)},`);
  lines.push(`${indent}"examType": ${JSON.stringify(student.examType)},`);
  lines.push(`${indent}"totalMarks": ${JSON.stringify(student.totalMarks)},`);
  lines.push(`${indent}"division": ${JSON.stringify(student.division)},`);

  if (student.passedUnderRegulation !== undefined) {
    lines.push(`${indent}"passedUnderRegulation": ${JSON.stringify(student.passedUnderRegulation)},`);
  }

  if (student.isTopper === true) {
    lines.push(`${indent}"isTopper": true,`);
  }

  if (student.isImprovedResult !== undefined) {
    lines.push(`${indent}"isImprovedResult": ${JSON.stringify(student.isImprovedResult)},`);
  }

  if (student.isExpelled !== undefined) {
    lines.push(`${indent}"isExpelled": ${JSON.stringify(student.isExpelled)},`);
  }

  if (student.divisionGraceMarks !== undefined) {
    lines.push(`${indent}"divisionGraceMarks": ${JSON.stringify(student.divisionGraceMarks)},`);
  }

  lines.push(`${indent}"subjects": [`);

  const subjectLines = student.subjects.map((sub) => {
    return `${indent}  ${JSON.stringify(sub)}`;
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
      const formatted = formatStudentJSON(student, "      ")
        .split("\n")
        .map((line, index) => (index === 0 ? `    ${JSON.stringify(rollNo)}: ${line}` : `    ${line}`))
        .join("\n");

      lines.push(formatted + (i < rollNoKeys.length - 1 ? "," : ""));
    });

    lines.push(`  }${idx < rollCodes.length - 1 ? "," : ""}`);
  });

  lines.push("}");
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  compressJSONToGZ();
}

// ===============================
// FETCH ONE RESULT
// ===============================
async function fetchStudentResult(rollCode, rollNo) {
  try {
    const res = await client.get(API_URL, {
      params: {
        roll_code: String(rollCode),
        roll_no: String(rollNo)
      }
    });

    if (!res.data || !res.data.success || !res.data.data) {
      return { valid: false };
    }

    const result = formatStudent(res.data.data);

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
// GLOBAL STATE
// ===============================
const saveState = {
  fullResults: {},
  totalStudentsSaved: 0,
  unsavedValidCount: 0,
  firstEverStudent: null,
  firstThisRunStudent: null,
  lastThisRunStudent: null
};

// ===============================
// PROCESS ONE ROLL CODE
// ===============================
async function processRollCode(rollCode) {
  if (!saveState.fullResults[rollCode]) saveState.fullResults[rollCode] = {};

  const alreadySavedForRollCode = Object.keys(saveState.fullResults[rollCode]).length;

  let currentRollNo = ROLLNO_START;
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
        chunk.map(rn => fetchStudentResult(rollCode, rn))
      );

      for (let j = 0; j < chunk.length; j++) {
        const rn = chunk[j];
        const result = results[j];

        if (result.valid) {
          if (!saveState.fullResults[rollCode][rn]) {
            saveState.fullResults[rollCode][rn] = result.data;
            saveState.unsavedValidCount++;
            saveState.totalStudentsSaved++;
            savedInThisRollCode++;

            if (!saveState.firstThisRunStudent) {
              saveState.firstThisRunStudent = result.data;
            }

            saveState.lastThisRunStudent = result.data;
          }
        }
      }

      if (saveState.unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
        saveCustomJSON(OUTPUT_JSON, saveState.fullResults);
        console.log(`💾 Progress Saved | Total Saved: ${saveState.totalStudentsSaved}`);
        saveState.unsavedValidCount = 0;
      }
    }

    currentRollNo = batchEnd + 1;
  }

  console.log(`${rollCode}-${savedInThisRollCode} student saved`);

  return {
    rollCode,
    alreadyHad: alreadySavedForRollCode,
    newSaved: savedInThisRollCode
  };
}

// ===============================
// MAIN
// ===============================
(async () => {
  const allRollCodes = loadSchoolRollCodes();

  if (!allRollCodes.length) {
    console.log(`❌ No valid roll codes found in ${SCHOOL_LIST_FILE}`);
    return;
  }

  const selectedRollCodes = allRollCodes.slice(START_INDEX, END_INDEX + 1);

  if (!selectedRollCodes.length) {
    console.log(`❌ No roll codes found in selected split range ${START_INDEX}-${END_INDEX}`);
    return;
  }

  let loadedData = tryLoadFromGZ();
  if (!Object.keys(loadedData).length) {
    loadedData = loadJSON(OUTPUT_JSON, {});
  }

  saveState.fullResults = loadedData;
  saveState.totalStudentsSaved = countTotalStudentsSaved(saveState.fullResults);
  saveState.unsavedValidCount = 0;

  const sortedExistingRollCodes = Object.keys(saveState.fullResults).sort((a, b) => Number(a) - Number(b));
  if (sortedExistingRollCodes.length) {
    const firstRC = sortedExistingRollCodes[0];
    const firstRN = Object.keys(saveState.fullResults[firstRC]).sort((a, b) => Number(a) - Number(b))[0];
    saveState.firstEverStudent = saveState.fullResults[firstRC][firstRN];
  }

  console.log(`🚀 BSEB 10TH FULL RESULT SCRAPER STARTED`);
  console.log(`📚 Total valid roll codes available: ${allRollCodes.length}`);
  console.log(`📦 Split range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this split: ${selectedRollCodes.length}`);
  console.log(`📦 Already saved students in JSON: ${saveState.totalStudentsSaved}`);
  console.log(`⚡ Parallel Roll Codes: ${ROLLCODE_PARALLEL}`);
  console.log(`⚡ RollNo Concurrency per Roll Code: ${CONCURRENCY}`);

  for (let i = 0; i < selectedRollCodes.length; i += ROLLCODE_PARALLEL) {
    const rollCodeChunk = selectedRollCodes.slice(i, i + ROLLCODE_PARALLEL);

    const chunkResults = await Promise.all(
      rollCodeChunk.map(rollCode => processRollCode(rollCode))
    );

    saveCustomJSON(OUTPUT_JSON, saveState.fullResults);
    saveState.unsavedValidCount = 0;

    console.log(`💾 Group Saved | Completed: ${Math.min(i + ROLLCODE_PARALLEL, selectedRollCodes.length)}/${selectedRollCodes.length} | Total Saved: ${saveState.totalStudentsSaved}`);
  }

  saveCustomJSON(OUTPUT_JSON, saveState.fullResults);

  console.log(`🎉 SCRAPE COMPLETED | Total Saved: ${saveState.totalStudentsSaved}`);

  console.log(`\n===== FIRST SAVED STUDENT (WHOLE FILE) =====`);
  console.log(JSON.stringify(saveState.firstEverStudent || null, null, 2));

  console.log(`\n===== FIRST SAVED STUDENT (THIS RUN) =====`);
  console.log(JSON.stringify(saveState.firstThisRunStudent || null, null, 2));

  console.log(`\n===== LAST SAVED STUDENT (THIS RUN) =====`);
  console.log(JSON.stringify(saveState.lastThisRunStudent || null, null, 2));
})();
