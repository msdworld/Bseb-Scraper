const axios = require("axios");
const fs = require("fs");

// ===============================
// CONFIG
// ===============================
const API_URL = "https://resultapi.biharboardonline.org/result";

// TEST VALUES
const TEST_ROLL_CODE = "92006";
const TEST_ROLL_NO = "2600001";

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
  const projectWork = clean(subject.project_work);
  const literacyActivity = clean(subject.literacy_activity);
  const iaSci = clean(subject.ia_sci);
  const practical = clean(subject.practical);

  // SOCIAL SCIENCE => 10+9
  if (projectWork && literacyActivity) {
    return `${Number(projectWork)}+${Number(literacyActivity)}`;
  }

  // SCIENCE => ia_sci becomes practical
  if (iaSci) {
    return String(Number(iaSci));
  }

  // fallback if actual practical exists
  if (practical) {
    return String(Number(practical));
  }

  return "";
}

// ===============================
// FORMAT SUBJECTS
// ===============================
function formatSubjects(subjects = []) {
  return subjects.map((sub) => {
    const formatted = {
      subCode: clean(sub.sub_code),
      subject: clean(sub.sub_name),
      theory: clean(sub.theory),
      subGroupId: clean(sub.sub_group_id),
      subTotal: clean(sub.sub_total)
    };

    const practical = buildPractical(sub);
    if (practical) formatted.practical = practical;

    // keep subResult only if exists (like F)
    if (clean(sub.sub_result)) {
      formatted.subResult = clean(sub.sub_result);
    }

    // keep regulation only if exists
    if (clean(sub.regulation)) {
      formatted.regulation = clean(sub.regulation);
    }

    // keep cce only if exists
    if (clean(sub.cce)) {
      formatted.cce = clean(sub.cce);
    }

    // keep improved/compartmental only if exists
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
// FORMAT FULL RESULT
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
    totalMarks: clean(raw.total),
    division: clean(raw.division),
    subjects: formatSubjects(raw.subjects || [])
  };

  // save only if useful
  onlyIfValue(student, "passedUnderRegulation", clean(raw.passed_under_regulation));
  if (raw.is_topper === true) student.isTopper = true;
  onlyIfValue(student, "isImprovedResult", clean(raw.is_improved_result));
  onlyIfValue(student, "isExpelled", clean(raw.is_expelled));
  onlyIfValue(student, "divisionGraceMarks", clean(raw.division_grace_marks));

  return student;
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
    console.log(JSON.stringify(result.data, null, 2));

    fs.writeFileSync(
      "bseb-10th-test-result.json",
      JSON.stringify(result.data, null, 2),
      "utf8"
    );

    console.log("\n💾 Saved as bseb-10th-test-result.json");
  } else {
    console.log("\n❌ No valid result found");
    if (result.error) console.log("Error:", result.error);
  }
})();
