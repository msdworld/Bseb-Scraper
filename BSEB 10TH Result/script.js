const axios = require("axios");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const API_URL = "https://resultapi.biharboardonline.org/result";

// TEST VALUES
const TEST_ROLL_CODE = "22050";
const TEST_ROLL_NO = "2600046";

const OUTPUT_FILE = "BSEB 10TH Result/test-result-2026-10th.json";

// ===============================
// AXIOS CLIENT
// ===============================
const client = axios.create({
  timeout: 10000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://result.biharboardonline.org",
    "Referer": "https://result.biharboardonline.org/"
  }
});

// ===============================
// HELPERS
// ===============================
function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function stripLeadingZeros(value) {
  const v = clean(value);
  if (!v) return "";

  if (/^\d+$/.test(v)) {
    return String(Number(v));
  }

  return v;
}

function onlyIfValue(obj, key, value) {
  if (
    value !== null &&
    value !== undefined &&
    value !== "" &&
    value !== false
  ) {
    obj[key] = value;
  }
}

function buildPractical(subject) {
  const projectWork = stripLeadingZeros(subject.project_work);
  const literacyActivity = stripLeadingZeros(subject.literacy_activity);
  const iaSci = stripLeadingZeros(subject.ia_sci);
  const practical = stripLeadingZeros(subject.practical);

  // SOCIAL SCIENCE => 10+9
  if (projectWork && literacyActivity) {
    return `${projectWork}+${literacyActivity}`;
  }

  // SCIENCE => ia_sci becomes practical
  if (iaSci) {
    return iaSci;
  }

  // fallback if actual practical exists
  if (practical) {
    return practical;
  }

  return "";
}

// ===============================
// SUBJECT FORMAT
// ===============================
function formatSubjects(subjects = []) {
  return subjects.map((sub) => {
    const formatted = {
      subCode: clean(sub.sub_code),
      subject: clean(sub.sub_name),
      theory: stripLeadingZeros(sub.theory),
      subGroupId: clean(sub.sub_group_id),
      subTotal: stripLeadingZeros(sub.sub_total)
    };

    const practical = buildPractical(sub);
    if (practical) formatted.practical = practical;

    if (clean(sub.sub_result)) {
      formatted.subResult = clean(sub.sub_result);
    }

    if (clean(sub.regulation)) {
      formatted.regulation = clean(sub.regulation);
    }

    if (clean(sub.cce)) {
      formatted.cce = clean(sub.cce);
    }

    if (clean(sub.is_compartmental)) {
      formatted.isCompartmental = clean(sub.is_compartmental);
    }

    if (clean(sub.is_improved_sub)) {
      formatted.isImprovedSub = clean(sub.is_improved_sub);
    }

    return formatted;
  });
}

// ===============================
// FULL RESULT FORMAT
// ===============================
function formatResult(raw) {
  const student = {
    studentName: clean(raw.name),
    fatherName: clean(raw.father_name),
    regNumber: clean(raw.reg_no),
    BSEBUniqueId: clean(raw.bseb_id),
    schoolName: clean(raw.school_name),
    rollCode: clean(raw.roll_code),
    rollNo: clean(raw.roll_no),
    examType: clean(raw.exam_type),
    totalMarks: stripLeadingZeros(raw.total),
    division: clean(raw.division),
    subjects: formatSubjects(raw.subjects || [])
  };

  onlyIfValue(student, "passedUnderRegulation", clean(raw.passed_under_regulation));

  if (raw.is_topper === true) {
    student.isTopper = true;
  }

  onlyIfValue(student, "isImprovedResult", clean(raw.is_improved_result));
  onlyIfValue(student, "isExpelled", clean(raw.is_expelled));
  onlyIfValue(student, "divisionGraceMarks", stripLeadingZeros(raw.division_grace_marks));

  return student;
}

// ===============================
// CUSTOM JSON FORMATTER
// ===============================
function formatStudentOneLine(student) {
  const lines = [];
  lines.push("{");
  lines.push(`  "studentName": ${JSON.stringify(student.studentName)},`);
  lines.push(`  "fatherName": ${JSON.stringify(student.fatherName)},`);
  lines.push(`  "regNumber": ${JSON.stringify(student.regNumber)},`);
  lines.push(`  "BSEBUniqueId": ${JSON.stringify(student.BSEBUniqueId)},`);
  lines.push(`  "schoolName": ${JSON.stringify(student.schoolName)},`);
  lines.push(`  "rollCode": ${JSON.stringify(student.rollCode)},`);
  lines.push(`  "rollNo": ${JSON.stringify(student.rollNo)},`);
  lines.push(`  "examType": ${JSON.stringify(student.examType)},`);
  lines.push(`  "totalMarks": ${JSON.stringify(student.totalMarks)},`);
  lines.push(`  "division": ${JSON.stringify(student.division)},`);

  if (student.passedUnderRegulation !== undefined) {
    lines.push(`  "passedUnderRegulation": ${JSON.stringify(student.passedUnderRegulation)},`);
  }

  if (student.isTopper !== undefined) {
    lines.push(`  "isTopper": ${JSON.stringify(student.isTopper)},`);
  }

  if (student.isImprovedResult !== undefined) {
    lines.push(`  "isImprovedResult": ${JSON.stringify(student.isImprovedResult)},`);
  }

  if (student.isExpelled !== undefined) {
    lines.push(`  "isExpelled": ${JSON.stringify(student.isExpelled)},`);
  }

  if (student.divisionGraceMarks !== undefined) {
    lines.push(`  "divisionGraceMarks": ${JSON.stringify(student.divisionGraceMarks)},`);
  }

  lines.push(`  "subjects": [`);

  const subjectLines = student.subjects.map((sub) => JSON.stringify(sub));
  lines.push(`    ${subjectLines.join(",\n    ")}`);

  lines.push(`  ]`);
  lines.push("}");
  return lines.join("\n");
}

// ===============================
// FETCH RESULT
// ===============================
async function fetchResult(rollCode, rollNo) {
  try {
    const url = `${API_URL}?roll_code=${encodeURIComponent(rollCode)}&roll_no=${encodeURIComponent(rollNo)}`;

    const res = await client.get(url);

    if (!res.data || res.data.success !== true || !res.data.data) {
      return { valid: false };
    }

    const formatted = formatResult(res.data.data);

    if (
      formatted.studentName &&
      formatted.rollCode === String(rollCode) &&
      formatted.rollNo === String(rollNo)
    ) {
      return { valid: true, data: formatted };
    }

    return { valid: false };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ===============================
// MAIN TEST
// ===============================
(async () => {
  console.log(`🔍 Checking Roll Code: ${TEST_ROLL_CODE} | Roll No: ${TEST_ROLL_NO}`);

  const result = await fetchResult(TEST_ROLL_CODE, TEST_ROLL_NO);

  if (result.valid) {
    console.log("\n✅ RESULT FOUND");
    console.log(formatStudentOneLine(result.data));

    fs.writeFileSync(
      OUTPUT_FILE,
      formatStudentOneLine(result.data),
      "utf8"
    );

    console.log(`\n💾 Saved as ${OUTPUT_FILE}`);
  } else {
    console.log("\n❌ No valid result found");
    if (result.error) console.log("Error:", result.error);
  }
})();
