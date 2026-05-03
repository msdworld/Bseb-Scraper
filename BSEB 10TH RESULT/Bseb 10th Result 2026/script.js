const axios = require("axios");
const fs = require("fs");
const path = require("path");

// =============================
// 🔧 CHANGE EVERY RUN
// =============================
const DISTRICT_PREFIX = "92";
const OUTPUT_FILE_NAME = "siwan-92-bseb-10th-full-result-2026.json";

// =============================
const API_URL = "https://resultapi.biharboardonline.org/result";

const BASE_DIR = __dirname;
const OUTPUT_PATH = path.join(BASE_DIR, OUTPUT_FILE_NAME);
const SCHOOL_LIST_FILE = path.join(__dirname, "../../../bseb-10th-school-list-2026.json");

// Roll range
const ROLLNO_START = 2600001;
const ROLLNO_END = 2600002;

// SPEED
const CONCURRENCY = 200;
const BATCH_SIZE = 100;
const REQUEST_TIMEOUT = 5000;

// =============================
// AXIOS
// =============================
const client = axios.create({
  timeout: REQUEST_TIMEOUT,
  headers: {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://result.biharboardonline.org/",
    "Origin": "https://result.biharboardonline.org"
  }
});

// =============================
// HELPERS
// =============================
function clean(txt) {
  return String(txt || "").replace(/\s+/g, " ").trim();
}

function normalizeMarks(val) {
  if (val === null || val === undefined) return "";
  const str = String(val).trim();
  if (!str || str === "NaN") return "";
  return String(Number(str));
}

// =============================
// SUBJECT FORMAT (ONE LINE)
// =============================
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

    return obj; // ✅ one-line object
  });
}

// =============================
// STUDENT FORMAT
// =============================
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

  if (data.passed_under_regulation) {
    student.passedUnderRegulation = clean(data.passed_under_regulation);
  }

  if (data.is_topper === true) {
    student.isTopper = true;
  }

  if (data.is_improved_result) {
    student.isImprovedResult = clean(data.is_improved_result);
  }

  if (data.is_expelled) {
    student.isExpelled = clean(data.is_expelled);
  }

  if (data.division_grace_marks) {
    student.divisionGraceMarks = clean(data.division_grace_marks);
  }

  return student;
}

// =============================
// LOAD FILES
// =============================
let outputData = {};

if (fs.existsSync(OUTPUT_PATH)) {
  console.log("📂 Loading existing data...");
  outputData = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
}

const schoolList = JSON.parse(fs.readFileSync(SCHOOL_LIST_FILE, "utf8"));

const rollCodes = Object.keys(schoolList)
  .filter(rc => rc.startsWith(DISTRICT_PREFIX))
  .sort((a, b) => Number(a) - Number(b));

// =============================
// FETCH
// =============================
async function fetchStudentResult(rollCode, rollNo) {
  try {
    const res = await client.get(API_URL, {
      params: {
        roll_code: rollCode,
        roll_no: rollNo
      }
    });

    if (!res.data || !res.data.success || !res.data.data) {
      return null;
    }

    const student = formatStudent(res.data.data);

    if (
      student.studentName &&
      student.rollCode === String(rollCode) &&
      student.rollNo === String(rollNo)
    ) {
      return student;
    }

    return null;
  } catch {
    return null;
  }
}

// =============================
// MAIN
// =============================
(async () => {
  let totalSaved = 0;

  for (const rc of rollCodes) {
    if (!outputData[rc]) outputData[rc] = {};

    console.log(`🚀 Started ${rc} from ${ROLLNO_START}`);

    for (let start = ROLLNO_START; start <= ROLLNO_END; start += BATCH_SIZE) {
      const end = Math.min(start + BATCH_SIZE - 1, ROLLNO_END);

      const batch = [];
      for (let rn = start; rn <= end; rn++) {
        batch.push(rn);
      }

      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const chunk = batch.slice(i, i + CONCURRENCY);

        const results = await Promise.all(
          chunk.map(rn => fetchStudentResult(rc, rn))
        );

        for (let j = 0; j < chunk.length; j++) {
          const rn = chunk[j];
          const result = results[j];

          if (result && !outputData[rc][rn]) {
            outputData[rc][rn] = result;
            totalSaved++;

            console.log(`✅ Saved ${rn}`);
          }
        }
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(outputData, null, 2));

  console.log("================================");
  console.log(`🎓 This run saved total: ${totalSaved}`);
  console.log("🎉 Completed.");
})();
