const fs = require("fs");
const axios = require("axios");

const API_URL = "https://resultapi.biharboardonline.org/result";
const TEST_ROLL_CODE = "92006";
const TEST_ROLL_NO = "2600001";

const OUTPUT_FILE = "BSEB 10TH Result/test-result-2026-10th.json";

const client = axios.create({
  timeout: 10000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://result.biharboardonline.org/",
    "Origin": "https://result.biharboardonline.org"
  }
});

function clean(txt) {
  return (txt || "").toString().trim();
}

function formatStudentResult(raw) {
  if (!raw || !raw.data) return null;

  const d = raw.data;

  return {
    studentName: clean(d.name),
    fatherName: clean(d.father_name),
    regNumber: clean(d.reg_no),
    BSEBUniqueId: clean(d.bseb_id),
    schoolName: clean(d.school_name),
    rollCode: clean(d.roll_code),
    rollNo: clean(d.roll_no),
    examType: clean(d.exam_type),
    totalMarks: clean(d.total),
    division: clean(d.division),
    passedUnderRegulation: d.passed_under_regulation,
    isTopper: d.is_topper,
    isImprovedResult: d.is_improved_result,
    isExpelled: d.is_expelled,
    divisionGraceMarks: d.division_grace_marks,
    subjects: (d.subjects || []).map(sub => ({
      subCode: clean(sub.sub_code),
      subject: clean(sub.sub_name),
      theory: clean(sub.theory),
      projectWork: clean(sub.project_work),
      iaSci: clean(sub.ia_sci),
      practical: clean(sub.practical),
      literacyActivity: clean(sub.literacy_activity),
      regulation: clean(sub.regulation),
      cce: clean(sub.cce),
      subGroupId: clean(sub.sub_group_id),
      isCompartmental: sub.is_compartmental,
      subTotal: clean(sub.sub_total),
      subResult: clean(sub.sub_result),
      isImprovedSub: sub.is_improved_sub
    }))
  };
}

async function fetchStudent(rollCode, rollNo) {
  try {
    const res = await client.get(API_URL, {
      params: {
        roll_code: rollCode,
        roll_no: rollNo
      }
    });

    if (!res.data || res.data.success !== true || !res.data.data) {
      return { valid: false, raw: res.data };
    }

    const formatted = formatStudentResult(res.data);

    if (
      formatted &&
      formatted.studentName &&
      formatted.rollCode === String(rollCode) &&
      formatted.rollNo === String(rollNo)
    ) {
      return { valid: true, data: formatted, raw: res.data };
    }

    return { valid: false, raw: res.data };
  } catch (err) {
    return {
      valid: false,
      error: err.message
    };
  }
}

(async () => {
  console.log(`🌐 Testing 10th API for Roll Code ${TEST_ROLL_CODE}, Roll No ${TEST_ROLL_NO}`);

  const result = await fetchStudent(TEST_ROLL_CODE, TEST_ROLL_NO);

  if (!result.valid) {
    console.log("❌ No valid result found");
    console.log(result.raw || result.error || "Unknown error");
    process.exit(1);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result.data, null, 2), "utf8");

  console.log("✅ RESULT FOUND");
  console.log(JSON.stringify(result.data, null, 2));
  console.log(`💾 Saved to: ${OUTPUT_FILE}`);
})();
