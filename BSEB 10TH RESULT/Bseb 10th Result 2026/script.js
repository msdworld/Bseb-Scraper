const axios = require("axios");
const fs = require("fs");
const path = require("path");

// =============================
// CONFIG (CHANGE EVERY RUN)
// =============================
const DISTRICT_PREFIX = "26";
const OUTPUT_FILE_NAME = "begusarai-26-bseb-10th-full-result-2026.json";

// =============================
const BASE_DIR = __dirname;
const OUTPUT_PATH = path.join(BASE_DIR, OUTPUT_FILE_NAME);

// ✅ FIXED PATH (ROOT LEVEL FILE)
const SCHOOL_LIST_FILE = path.join(
  process.cwd(),
  "bseb-10th-school-list-2026.json"
);

// Roll range
const ROLLNO_START = 2600001;
const ROLLNO_END = 2600999;

// SPEED
const ROLLCODE_PARALLEL = 20;
const CONCURRENCY = 120;
const BATCH_SIZE = 100;
const REQUEST_TIMEOUT = 6000;

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
  if (!val) return "";
  return String(Number(val));
}

// =============================
// SUBJECT FORMAT LOGIC (UNCHANGED)
// =============================
function buildPractical(sub) {
  const pw = normalizeMarks(sub.project_work);
  const la = normalizeMarks(sub.literacy_activity);
  const ia = normalizeMarks(sub.ia_sci);
  const pr = normalizeMarks(sub.practical);

  if (sub.sub_code === "111") {
    return [pw, la].filter(Boolean).join("+");
  }

  if (sub.sub_code === "112") {
    return ia || pr;
  }

  return pr || [pw, la, ia].filter(Boolean).join("+");
}

function formatSubjects(subjects = []) {
  return subjects.map(sub => {
    const obj = {
      subCode: clean(sub.sub_code),
      subject: clean(sub.sub_name),
      theory: normalizeMarks(sub.theory),
      subGroupId: clean(sub.sub_group_id),
      subTotal: normalizeMarks(sub.sub_total)
    };

    const practical = buildPractical(sub);
    if (practical) obj.practical = practical;

    if (clean(sub.sub_result)) obj.subResult = clean(sub.sub_result);

    // ✅ regulation ONLY inside subject
    if (clean(sub.regulation)) obj.regulation = clean(sub.regulation);

    return obj;
  });
}

// =============================
// STUDENT FORMAT
// =============================
function formatStudent(data) {
  const student = {
    studentName: clean(data.name),
    fatherName: clean(data.father_name),
    regNumber: clean(data.reg_no),
    BSEBUniqueId: clean(data.bseb_id),
    schoolName: clean(data.school_name),
    rollCode: clean(data.roll_code),
    rollNo: clean(data.roll_no),
    examType: clean(data.exam_type),
    totalMarks: normalizeMarks(data.total),
    division: clean(data.division)
  };

  // ✅ only if exists
  if (clean(data.passed_under_regulation)) {
    student.passedUnderRegulation = clean(data.passed_under_regulation);
  }

  if (clean(data.division_grace_marks)) {
    student.divisionGraceMarks = clean(data.division_grace_marks);
  }

  student.subjects = formatSubjects(data.subjects);

  return student;
}

// =============================
// CUSTOM JSON FORMAT (FINAL FIX)
// =============================
function formatStudentJSON(student) {
  const lines = [];

  lines.push("{");
  lines.push(`      "studentName": ${JSON.stringify(student.studentName)},`);
  lines.push(`      "fatherName": ${JSON.stringify(student.fatherName)},`);
  lines.push(`      "regNumber": ${JSON.stringify(student.regNumber)},`);
  lines.push(`      "BSEBUniqueId": ${JSON.stringify(student.BSEBUniqueId)},`);
  lines.push(`      "schoolName": ${JSON.stringify(student.schoolName)},`);
  lines.push(`      "rollCode": ${JSON.stringify(student.rollCode)},`);
  lines.push(`      "rollNo": ${JSON.stringify(student.rollNo)},`);
  lines.push(`      "examType": ${JSON.stringify(student.examType)},`);
  lines.push(`      "totalMarks": ${JSON.stringify(student.totalMarks)},`);
  lines.push(`      "division": ${JSON.stringify(student.division)},`);

  if (student.passedUnderRegulation) {
    lines.push(`      "passedUnderRegulation": ${JSON.stringify(student.passedUnderRegulation)},`);
  }

  if (student.divisionGraceMarks) {
    lines.push(`      "divisionGraceMarks": ${JSON.stringify(student.divisionGraceMarks)},`);
  }

  // ✅ SUBJECTS MULTI LINE (FINAL FIX)
  lines.push(`      "subjects": [`);

  student.subjects.forEach((sub, i) => {
    const comma = i < student.subjects.length - 1 ? "," : "";
    lines.push(`        ${JSON.stringify(sub)}${comma}`);
  });

  lines.push(`      ]`);
  lines.push("    }");

  return lines.join("\n");
}

// =============================
// SAVE JSON
// =============================
function saveJSON(file, data) {
  const rollCodes = Object.keys(data).sort((a, b) => Number(a) - Number(b));

  const lines = ["{"];

  rollCodes.forEach((rc, i) => {
    lines.push(`  "${rc}": {`);

    const students = data[rc];
    const rollNos = Object.keys(students).sort((a, b) => Number(a) - Number(b));

    rollNos.forEach((rn, j) => {
      const studentStr = formatStudentJSON(students[rn])
        .split("\n")
        .map((line, idx) =>
          idx === 0 ? `    "${rn}": ${line}` : `    ${line}`
        )
        .join("\n");

      lines.push(studentStr + (j < rollNos.length - 1 ? "," : ""));
    });

    lines.push(`  }${i < rollCodes.length - 1 ? "," : ""}`);
  });

  lines.push("}");

  fs.writeFileSync(file, lines.join("\n"), "utf8");
}

// =============================
// FETCH RESULT
// =============================
async function fetchResult(rc, rn) {
  try {
    const res = await client.get("https://resultapi.biharboardonline.org/result", {
      params: { roll_code: rc, roll_no: rn }
    });

    if (!res.data?.success) return null;

    return formatStudent(res.data.data);
  } catch {
    return null;
  }
}

// =============================
// MAIN
// =============================
(async () => {
  console.log("📂 Loading existing data...");

  let data = {};
  if (fs.existsSync(OUTPUT_PATH)) {
    data = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf8"));
  }

  const schoolList = JSON.parse(fs.readFileSync(SCHOOL_LIST_FILE, "utf8"));

  const rollCodes = Object.keys(schoolList)
    .filter(rc => rc.startsWith(DISTRICT_PREFIX))
    .sort((a, b) => Number(a) - Number(b));

  let totalSaved = 0;

  for (let i = 0; i < rollCodes.length; i += ROLLCODE_PARALLEL) {
    const chunk = rollCodes.slice(i, i + ROLLCODE_PARALLEL);

    await Promise.all(
      chunk.map(async rc => {
        if (!data[rc]) data[rc] = {};

        console.log(`🚀 Started ${rc} from ${ROLLNO_START}`);

        for (let rn = ROLLNO_START; rn <= ROLLNO_END; rn += BATCH_SIZE) {
          const batch = [];

          for (let k = rn; k < rn + BATCH_SIZE && k <= ROLLNO_END; k++) {
            if (!data[rc][k]) batch.push(k);
          }

          const results = await Promise.all(
            batch.map(r => fetchResult(rc, r))
          );

          results.forEach((res, idx) => {
            if (res) {
              const rollNo = batch[idx];
              data[rc][rollNo] = res;
              totalSaved++;
              console.log(`✅ Saved ${rollNo}`);
            }
          });
        }
      })
    );

    saveJSON(OUTPUT_PATH, data);
  }

  console.log("================================");
  console.log(`🎓 This run saved total: ${totalSaved}`);
  console.log("🎉 Completed.");
})();
