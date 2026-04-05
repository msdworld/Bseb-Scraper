const puppeteer = require("puppeteer");
const fs = require("fs");

const RESULT_URL = "https://result.biharboardonline.org/result?roll_code=92006&roll_no=2600001";
const OUTPUT_FILE = "test-result-10th-2026.json";

function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

function detectAdditionalSection(text) {
  const t = clean(text).toLowerCase();
  if (t.includes("additional") || t.includes("अतिरिक्त")) {
    return clean(text);
  }
  return null;
}

async function extractResultFromPage(page) {
  return await page.evaluate(() => {
    function clean(txt) {
      return (txt || "").replace(/\s+/g, " ").trim();
    }

    function detectAdditionalSection(text) {
      const t = clean(text).toLowerCase();
      if (t.includes("additional") || t.includes("अतिरिक्त")) {
        return clean(text);
      }
      return null;
    }

    function extractKeyValues() {
      const data = {};

      document.querySelectorAll("table tr").forEach((row) => {
        const cells = row.querySelectorAll("td, th");
        if (cells.length === 2) {
          const key = clean(cells[0].innerText).replace(/:$/, "");
          const value = clean(cells[1].innerText);
          if (key && value) data[key] = value;
        }
      });

      return data;
    }

    function parseSubjects() {
      const subjects = [];
      let marksTableFound = false;
      let currentAdditionalSection = null;

      document.querySelectorAll("table").forEach((table) => {
        if (marksTableFound) return;

        const rows = table.querySelectorAll("tr");
        if (rows.length < 3) return;

        const row1 = Array.from(rows[0].querySelectorAll("td,th")).map(c => clean(c.innerText));
        const row2 = Array.from(rows[1].querySelectorAll("td,th")).map(c => clean(c.innerText));

        const row1Text = row1.join(" ").toLowerCase();
        const row2Text = row2.join(" ").toLowerCase();

        const isMarksTable =
          row1Text.includes("subject") &&
          row1Text.includes("full marks") &&
          row1Text.includes("pass marks") &&
          row1Text.includes("theory") &&
          row1Text.includes("subject total");

        if (!isMarksTable) return;
        marksTableFound = true;

        for (let i = 2; i < rows.length; i++) {
          const cells = Array.from(rows[i].querySelectorAll("td,th")).map(c => clean(c.innerText));
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
          if (cells[5]) obj.internal = clean(cells[5] || "");
          if (cells[6]) obj.grace = clean(cells[6] || "");

          if (currentAdditionalSection) obj.extra = currentAdditionalSection;

          subjects.push(obj);
        }
      });

      return subjects;
    }

    const kv = extractKeyValues();
    const subjects = parseSubjects();

    return {
      studentName: kv["Student Name"] || kv["Student's Name"] || null,
      fatherName: kv["Father Name"] || kv["Father's Name"] || null,
      motherName: kv["Mother Name"] || kv["Mother's Name"] || null,
      regNumber: kv["Registration Number"] || null,
      schoolName: kv["School Name"] || kv["School/College Name"] || null,
      rollCode: kv["Roll Code"] || null,
      rollNo: kv["Roll Number"] || null,
      dob: kv["Date of Birth"] || kv["DOB"] || null,
      totalMarks: kv["Total Marks"] || kv["Aggregate Marks"] || null,
      result: kv["Result"] || kv["Result/Division"] || kv["Division"] || null,
      subjects
    };
  });
}

(async () => {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.setViewport({ width: 1366, height: 900 });

    console.log("🌐 Opening result page...");
    await page.goto(RESULT_URL, {
      waitUntil: "networkidle2",
      timeout: 60000
    });

    await page.waitForTimeout(5000);

    const bodyText = await page.evaluate(() => document.body.innerText || "");

    if (
      bodyText.toLowerCase().includes("not found") ||
      bodyText.toLowerCase().includes("invalid") ||
      bodyText.toLowerCase().includes("no record")
    ) {
      console.log("❌ Result not found or invalid");
      return;
    }

    const result = await extractResultFromPage(page);

    if (!result.studentName) {
      console.log("⚠️ Could not confidently extract student data.");
      console.log("📄 Saving page HTML for inspection...");
      const html = await page.content();
      fs.writeFileSync("debug-page.html", html, "utf8");
      console.log("Saved: debug-page.html");
      return;
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), "utf8");

    console.log("✅ RESULT FOUND");
    console.log(JSON.stringify(result, null, 2));
    console.log(`💾 Saved to ${OUTPUT_FILE}`);
  } catch (err) {
    console.error("❌ ERROR:", err.message);
  } finally {
    if (browser) await browser.close();
  }
})();
