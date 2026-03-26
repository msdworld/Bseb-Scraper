const puppeteer = require("puppeteer-core");
const fs = require("fs");

(async () => {
  try {
    // -------------------------------
    // STUDENT DETAILS
    // -------------------------------
    const rollCode = "42104";
    const rollNumber = "26010031";

    // -------------------------------
    // CHROMIUM PATH FOR GITHUB ACTIONS
    // -------------------------------
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

    // -------------------------------
    // FILL FORM
    // -------------------------------
    await page.waitForSelector("#mobile", { timeout: 30000 });

    await page.$eval("#mobile", el => el.value = "");
    await page.type("#mobile", rollCode, { delay: 20 });

    await page.$eval("#password", el => el.value = "");
    await page.type("#password", rollNumber, { delay: 20 });

    // Fill captcha automatically
    await page.evaluate(() => {
      const capEl = document.getElementById("generatedCaptcha");
      const inputEl = document.getElementById("captchaInput");

      if (capEl && inputEl) {
        const capValue = capEl.dataset.value || capEl.getAttribute("data-value") || capEl.innerText.trim();
        inputEl.value = capValue;
      }
    });

    console.log(`Submitting RollCode=${rollCode}, RollNo=${rollNumber}`);

    await page.click("#btn_login");

    // Wait after submit
    await new Promise(resolve => setTimeout(resolve, 5000));

    const pageText = await page.evaluate(() => document.body.innerText);

    if (
      pageText.toLowerCase().includes("invalid") ||
      pageText.toLowerCase().includes("roll code not found") ||
      pageText.toLowerCase().includes("not found")
    ) {
      console.log("\n❌ RESULT NOT FOUND");
      console.log(JSON.stringify({
        success: false,
        rollCode,
        rollNumber,
        message: "Result not found"
      }, null, 2));

      await browser.close();
      return;
    }

    // -------------------------------
    // EXTRACT RESULT JSON
    // -------------------------------
    const resultData = await page.evaluate(() => {
      const clean = (txt) => (txt || "").replace(/\s+/g, " ").trim();

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

      // -------------------------------
      // EXAM TITLE
      // -------------------------------
      const examHeading = Array.from(document.querySelectorAll("h4"))
        .map(el => clean(el.innerText))
        .find(t => t);

      if (examHeading) data.exam = examHeading;

      // -------------------------------
      // BASIC DETAILS TABLE
      // -------------------------------
      const allRows = Array.from(document.querySelectorAll("table tr"));

      for (const row of allRows) {
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
        }
      }

      // -------------------------------
      // SUBJECTS TABLE
      // -------------------------------
      for (const row of allRows) {
        const cells = row.querySelectorAll("td");

        // Subject row = 8 td
        if (cells.length === 8) {
          const subject = clean(cells[0].innerText);

          // skip group headings / empty rows
          if (
            subject &&
            !subject.toLowerCase().includes("अनिवार्य") &&
            !subject.toLowerCase().includes("elective") &&
            subject !== "Subject"
          ) {
            data.subjects.push({
              subject: subject,
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

      // -------------------------------
      // FINAL RESULT
      // -------------------------------
      for (const row of allRows) {
        const cells = row.querySelectorAll("td");

        if (cells.length === 2) {
          const key = clean(cells[0].innerText).toLowerCase();
          const value = clean(cells[1].innerText);

          if (key.includes("aggregate marks")) data.totalMarks = value;
          if (key.includes("result/division")) data.division = value;
        }
      }

      return data;
    });

    console.log("\n=========== RESULT JSON ===========\n");
    console.log(JSON.stringify(resultData, null, 2));

    await browser.close();
  } catch (err) {
    console.error("\n❌ ERROR:");
    console.error(err.message);
    process.exit(1);
  }
})();    for (let roll of testRolls) {

      try {

        // clear fields
        await page.evaluate(() => {
          document.querySelector("#mobile").value = "";
          document.querySelector("#password").value = "";
        });

        await page.type("#mobile", String(code));
        await page.type("#password", roll);

        // captcha auto
        await page.evaluate(() => {
          const cap = document.getElementById("generatedCaptcha").dataset.value;
          document.getElementById("captchaInput").value = cap;
        });

        await page.click("#btn_login");

        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});

        const text = await page.evaluate(() => document.body.innerText);

        if (!text.includes("Invalid")) {

          const school = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("table tr"));
            for (let row of rows) {
              const tds = row.querySelectorAll("td");
              if (tds.length === 2 && tds[0].innerText.includes("School")) {
                return tds[1].innerText.trim();
              }
            }
            return "Unknown";
          });

          console.log(`✅ FOUND: ${code} - ${school}`);

          resultData[code] = school;

          found = true;
          break;
        }

      } catch (err) {
        console.log("Error:", code);
      }

    }

    // 💾 save every 20 results
    if (Object.keys(resultData).length % 20 === 0 && Object.keys(resultData).length !== 0) {
      fs.writeFileSync(
        "bseb-12th-college-list-2026.json",
        JSON.stringify(resultData, null, 2)
      );
      console.log("💾 Saved progress...");
    }

    // go back if navigated
    if (found) {
      await page.goto("http://interbiharboard.com/", { waitUntil: "domcontentloaded" });
    }

  }

  // final save
  fs.writeFileSync(
    "bseb-12th-college-list-2026.json",
    JSON.stringify(resultData, null, 2)
  );

  console.log("🎉 DONE");

  await browser.close();

})();
