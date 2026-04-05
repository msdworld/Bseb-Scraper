const fs = require("fs");
const puppeteer = require("puppeteer");

const RESULT_URL = "https://result.biharboardonline.org/result?roll_code=92006&roll_no=2600001";
const OUTPUT_FILE = "BSEB 10TH Result/test-result-2026-10th.json";

function clean(txt) {
  return (txt || "").replace(/\s+/g, " ").trim();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseResultTable(document) {
  const data = {};

  const rows = document.querySelectorAll("table tr");
  rows.forEach(row => {
    const cells = row.querySelectorAll("td, th");
    if (cells.length === 2) {
      const key = clean(cells[0].innerText).replace(/:$/, "");
      const value = clean(cells[1].innerText);
      if (key && value) {
        data[key] = value;
      }
    }
  });

  return data;
}

function parseSubjects(document) {
  const subjects = [];
  const tables = document.querySelectorAll("table");

  tables.forEach(table => {
    const rows = table.querySelectorAll("tr");
    if (rows.length < 3) return;

    const headerText = clean(rows[0].innerText + " " + (rows[1]?.innerText || "")).toLowerCase();

    if (
      headerText.includes("subject") &&
      headerText.includes("full marks") &&
      headerText.includes("pass marks")
    ) {
      for (let i = 2; i < rows.length; i++) {
        const cells = [...rows[i].querySelectorAll("td, th")].map(td => clean(td.innerText));
        if (cells.length < 4) continue;

        const subject = {
          subject: cells[0] || "",
          FMarks: cells[1] || "",
          PMarks: cells[2] || "",
          marks: cells[3] || "",
        };

        if (cells[4]) subject.extra1 = cells[4];
        if (cells[5]) subject.extra2 = cells[5];
        if (cells[6]) subject.extra3 = cells[6];
        if (cells[7]) subject.total = cells[7];

        subjects.push(subject);
      }
    }
  });

  return subjects;
}

(async () => {
  let browser;

  try {
    console.log("🌐 Opening result page...");

    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    );

    await page.goto(RESULT_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await delay(5000);

    const result = await page.evaluate(() => {
      function clean(txt) {
        return (txt || "").replace(/\s+/g, " ").trim();
      }

      function parseResultTable(document) {
        const data = {};

        const rows = document.querySelectorAll("table tr");
        rows.forEach(row => {
          const cells = row.querySelectorAll("td, th");
          if (cells.length === 2) {
            const key = clean(cells[0].innerText).replace(/:$/, "");
            const value = clean(cells[1].innerText);
            if (key && value) {
              data[key] = value;
            }
          }
        });

        return data;
      }

      function parseSubjects(document) {
        const subjects = [];
        const tables = document.querySelectorAll("table");

        tables.forEach(table => {
          const rows = table.querySelectorAll("tr");
          if (rows.length < 3) return;

          const headerText = clean(rows[0].innerText + " " + (rows[1]?.innerText || "")).toLowerCase();

          if (
            headerText.includes("subject") &&
            headerText.includes("full marks") &&
            headerText.includes("pass marks")
          ) {
            for (let i = 2; i < rows.length; i++) {
              const cells = [...rows[i].querySelectorAll("td, th")].map(td => clean(td.innerText));
              if (cells.length < 4) continue;

              const subject = {
                subject: cells[0] || "",
                FMarks: cells[1] || "",
                PMarks: cells[2] || "",
                marks: cells[3] || "",
              };

              if (cells[4]) subject.extra1 = cells[4];
              if (cells[5]) subject.extra2 = cells[5];
              if (cells[6]) subject.extra3 = cells[6];
              if (cells[7]) subject.total = cells[7];

              subjects.push(subject);
            }
          }
        });

        return subjects;
      }

      const kv = parseResultTable(document);
      const subjects = parseSubjects(document);

      return {
        studentName: kv["Student Name"] || kv["Student's Name"] || null,
        fatherName: kv["Father Name"] || kv["Father's Name"] || null,
        motherName: kv["Mother Name"] || kv["Mother's Name"] || null,
        schoolName: kv["School Name"] || kv["School/College Name"] || null,
        rollCode: kv["Roll Code"] || null,
        rollNo: kv["Roll No"] || kv["Roll Number"] || null,
        registrationNo: kv["Registration No"] || kv["Registration Number"] || null,
        faculty: kv["Faculty"] || kv["Stream"] || null,
        totalMarks: kv["Total Marks"] || kv["Aggregate Marks"] || null,
        result: kv["Result"] || kv["Division"] || kv["Result/Division"] || null,
        subjects
      };
    });

    if (!result.studentName) {
      console.log("❌ No valid result found");
      process.exit(1);
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), "utf8");

    console.log("✅ RESULT FOUND");
    console.log(JSON.stringify(result, null, 2));
    console.log(`💾 Saved to: ${OUTPUT_FILE}`);

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
