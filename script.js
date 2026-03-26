const puppeteer = require("puppeteer-core");
const fs = require("fs");

(async function () {
  try {
    const rollCode = "42104";
    const rollNumber = "26010031";

    const chromePath = fs.existsSync("/usr/bin/chromium-browser")
      ? "/usr/bin/chromium-browser"
      : "/usr/bin/chromium";

    console.log("Using Chromium:", chromePath);

    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);

    console.log("Opening website...");
    await page.goto("http://interbiharboard.com/Default.html", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    console.log("Filling form...");

    await page.waitForSelector("#mobile", { timeout: 30000 });

    await page.$eval("#mobile", el => el.value = "");
    await page.type("#mobile", rollCode, { delay: 20 });

    await page.$eval("#password", el => el.value = "");
    await page.type("#password", rollNumber, { delay: 20 });

    await page.evaluate(() => {
      const capEl = document.getElementById("generatedCaptcha");
      const inputEl = document.getElementById("captchaInput");

      if (capEl && inputEl) {
        const capValue =
          capEl.dataset.value ||
          capEl.getAttribute("data-value") ||
          capEl.innerText.trim();

        inputEl.value = capValue;
      }
    });

    console.log(`Submitting RollCode=${rollCode}, RollNo=${rollNumber}`);
    await page.click("#btn_login");

    await new Promise(resolve => setTimeout(resolve, 5000));

    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());

    if (
      pageText.includes("invalid") ||
      pageText.includes("roll code not found") ||
      pageText.includes("not found")
    ) {
      console.log("\n❌ RESULT NOT FOUND\n");
      console.log(JSON.stringify({
        success: false,
        rollCode,
        rollNumber,
        message: "Result not found"
      }, null, 2));

      await browser.close();
      return;
    }

    console.log("Extracting result...");

    const resultData = await page.evaluate(() => {
      function clean(txt) {
        return (txt || "").replace(/\s+/g, " ").trim();
      }

      const data = {
        success: true,
        exam: null,
        bsebUniqueId: null,
        studentName: null,
        fatherName: null,
        schoolName: null,
        rollCode: null,
        rollNumber: null,
        registrationNumber: null,
        faculty: null,
        totalMarks: null,
        division: null,
        subjects: []
      };

      const h4 = document.querySelector("h4");
      if (h4) data.exam = clean(h4.innerText);

      const rows = Array.from(document.querySelectorAll("table tr"));

      for (const row of rows) {
        const cells = row.querySelectorAll("td");

        if (cells.length === 2) {
          const key = clean(cells[0].innerText).toLowerCase();
          const value = clean(cells[1].innerText);

          if (key.includes("bseb unique id")) data.bsebUniqueId = value;
          else if (key.includes("student")) data.studentName = value;
          else if (key.includes("father")) data.fatherName = value;
          else if (key.includes("school") || key.includes("college")) data.schoolName = value;
          else if (key === "roll code") data.rollCode = value;
          else if (key === "roll number") data.rollNumber = value;
          else if (key.includes("registration")) data.registrationNumber = value;
          else if (key.includes("faculty")) data.faculty = value;
          else if (key.includes("aggregate marks")) data.totalMarks = value;
          else if (key.includes("result/division")) data.division = value;
        }

        if (cells.length === 8) {
          const subject = clean(cells[0].innerText).toLowerCase();

          if (
            subject &&
            subject !== "subject" &&
            !subject.includes("अनिवार्य") &&
            !subject.includes("compulsory") &&
            !subject.includes("elective") &&
            !subject.includes("ऐच्छिक")
          ) {
            data.subjects.push({
              subject: clean(cells[0].innerText),
              fullMarks: clean(cells[1].innerText),
              passMarks: clean(cells[2].innerText),
              theory: clean(cells[3].innerText),
              practical: clean(cells[4].innerText),
              regulationTheory: clean(cells[5].innerText),
              regulationPractical: clean(cells[6].innerText),
              subjectTotal: clean(cells[7].innerText)
            });
          }
        }
      }

      return data;
    });

    console.log("\n=========== RESULT JSON ===========\n");
    console.log(JSON.stringify(resultData, null, 2));

    await browser.close();
    console.log("\n✅ DONE");
  } catch (err) {
    console.error("\n❌ ERROR:");
    console.error(err.message);
    process.exit(1);
  }
})();
