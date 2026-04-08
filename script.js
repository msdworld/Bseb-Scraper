const axios = require("axios");
const fs = require("fs");
const zlib = require("zlib");

// ===============================
// CONFIG
// ===============================
const API_URL = "https://resultapi.biharboardonline.org/result";

const SCHOOL_LIST_FILE = "bseb-10th-school-list-2026.json";
const FILE2_JSON = "bseb-10th-full-result-2026-2.json";
const FILE2_GZ = "bseb-10th-full-result-2026-2.json.gz";
const SEEN_FILE = "bseb-10th-seen-rollnos.txt";

// Roll number range per roll code
const ROLLNO_START = 2600001;
const ROLLNO_END = 2600999;

// SPEED
const ROLLCODE_PARALLEL = 10;
const CONCURRENCY = 200;
const BATCH_SIZE = 100;
const REQUEST_TIMEOUT = 5000;

// SAVE
const SAVE_EVERY_VALID_RESULTS = 100;

// ===============================
// SPLIT RANGE (CHANGE EACH RUN)
// ===============================
const START_INDEX = 7000;
const END_INDEX = 7050;

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

function tryLoadFromGZ(file) {
  if (!fs.existsSync(file)) return {};
  try {
    const gzRaw = fs.readFileSync(file);
    const jsonRaw = zlib.gunzipSync(gzRaw).toString("utf8");
    return JSON.parse(jsonRaw);
  } catch (e) {
    console.log(`⚠️ GZ invalid (${file}): ${e.message}`);
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

function compressJSONToGZ(jsonFile, gzFile) {
  if (!fs.existsSync(jsonFile)) return;
  const raw = fs.readFileSync(jsonFile);
  const gz = zlib.gzipSync(raw, { level: 9 });
  fs.writeFileSync(gzFile, gz);
}

function loadSeenRollNos() {
  if (!fs.existsSync(SEEN_FILE)) return new Set();
  const lines = fs.readFileSync(SEEN_FILE, "utf8")
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);
  return new Set(lines);
}

function appendSeenId(id) {
  fs.appendFileSync(SEEN_FILE, id + "\n");
}

// ===============================
// SUBJECT FORMATTER
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
// SAVE FILE2
// ===============================
function saveFile2JSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data), "utf8");
  compressJSONToGZ(FILE2_JSON, FILE2_GZ);
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
const seenRollNos = loadSeenRollNos();

const saveState = {
  file2Results: {},
  file2Total: 0,
  combinedTotal: seenRollNos.size,
  unsavedValidCount: 0,
  firstThisRunStudent: null,
  lastThisRunStudent: null
};

// ===============================
// PROCESS ONE ROLL CODE
// ===============================
async function processRollCode(rollCode) {
  if (!saveState.file2Results[rollCode]) saveState.file2Results[rollCode] = {};

  let currentRollNo = ROLLNO_START;
  let savedInThisRollCode = 0;
  let skippedSeen = 0;

  while (currentRollNo <= ROLLNO_END) {
    const batchEnd = Math.min(currentRollNo + BATCH_SIZE - 1, ROLLNO_END);
    const batchRollNos = [];

    // IMPORTANT: SKIP ALREADY SEEN BEFORE REQUEST
    for (let rn = currentRollNo; rn <= batchEnd; rn++) {
      const id = `${rollCode}-${rn}`;

      if (seenRollNos.has(id)) {
        skippedSeen++;
        continue;
      }

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
        const id = `${rollCode}-${rn}`;

        if (result.valid) {
          // DOUBLE SAFETY AGAINST DUPLICATE SAVE
          if (!seenRollNos.has(id)) {
            if (!saveState.file2Results[rollCode][rn]) {
              saveState.file2Results[rollCode][rn] = result.data;
              seenRollNos.add(id);
              appendSeenId(id);

              saveState.unsavedValidCount++;
              saveState.file2Total++;
              saveState.combinedTotal++;
              savedInThisRollCode++;

              if (!saveState.firstThisRunStudent) {
                saveState.firstThisRunStudent = result.data;
              }

              saveState.lastThisRunStudent = result.data;
            }
          }
        }
      }

      if (saveState.unsavedValidCount >= SAVE_EVERY_VALID_RESULTS) {
        saveFile2JSON(FILE2_JSON, saveState.file2Results);
        console.log(`💾 Progress Auto-Saved | File2: ${saveState.file2Total} | Combined: ${saveState.combinedTotal}`);
        saveState.unsavedValidCount = 0;
      }
    }

    currentRollNo = batchEnd + 1;
  }

  console.log(`${rollCode}-${savedInThisRollCode} student saved | skipped seen: ${skippedSeen}`);
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

  let loadedFile2 = tryLoadFromGZ(FILE2_GZ);
  if (!Object.keys(loadedFile2).length) {
    loadedFile2 = loadJSON(FILE2_JSON, {});
  }

  saveState.file2Results = loadedFile2;
  saveState.file2Total = countTotalStudentsSaved(saveState.file2Results);

  // IMPORTANT: combined total = old seen IDs + current file2 loaded
  // But seen file already includes file2 previous IDs too if saved before
  saveState.combinedTotal = seenRollNos.size;

  console.log(`🚀 BSEB 10TH FULL RESULT SCRAPER STARTED`);
  console.log(`📚 Total valid roll codes available: ${allRollCodes.length}`);
  console.log(`📦 Split range: index ${START_INDEX} to ${END_INDEX}`);
  console.log(`📦 Roll codes in this split: ${selectedRollCodes.length}`);
  console.log(`📁 File2 (Current) Total: ${saveState.file2Total}`);
  console.log(`📊 Combined Total Saved: ${saveState.combinedTotal}`);
  console.log(`⚡ Parallel Roll Codes: ${ROLLCODE_PARALLEL}`);
  console.log(`⚡ RollNo Concurrency per Roll Code: ${CONCURRENCY}`);

  for (let i = 0; i < selectedRollCodes.length; i += ROLLCODE_PARALLEL) {
    const rollCodeChunk = selectedRollCodes.slice(i, i + ROLLCODE_PARALLEL);

    await Promise.all(
      rollCodeChunk.map(rollCode => processRollCode(rollCode))
    );

    saveFile2JSON(FILE2_JSON, saveState.file2Results);
    saveState.unsavedValidCount = 0;

    console.log(`💾 Group Saved | Completed: ${Math.min(i + ROLLCODE_PARALLEL, selectedRollCodes.length)}/${selectedRollCodes.length} | File2: ${saveState.file2Total} | Combined: ${saveState.combinedTotal}`);
  }

  saveFile2JSON(FILE2_JSON, saveState.file2Results);

  console.log(`🎉 SCRAPE COMPLETED`);
  console.log(`📁 File2 Total: ${saveState.file2Total}`);
  console.log(`📊 Combined Total Saved: ${saveState.combinedTotal}`);

  console.log(`\n===== FIRST SAVED STUDENT (THIS RUN) =====`);
  console.log(JSON.stringify(saveState.firstThisRunStudent || null, null, 2));

  console.log(`\n===== LAST SAVED STUDENT (THIS RUN) =====`);
  console.log(JSON.stringify(saveState.lastThisRunStudent || null, null, 2));
})();
