const puppeteer = require("puppeteer-core");
const fs = require("fs");

(async function () {
  try {
    // =========================
    // SETTINGS
    // =========================
    const START_ROLL_CODE = 11001;
    const END_ROLL_CODE = 99999;

    const TEST_ROLL_NUMBERS = [
      "26010011",
      "26010023",
      "26010035",
      "26010047"
    ];

    const OUTPUT_FILE = "bseb-12th-college-list-2026.json";
    const PROGRESS_FILE = "progress.txt";

    // =========================
    // LOAD OLD DATA
    // =========================
    let savedData = {};
    if (fs.existsSync(OUTPUT_FILE)) {
      try {
        savedData = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
      } catch {
        savedData = {};
      }
    }

    let currentRollCode = START_ROLL_CODE;
    if (fs.existsSync(PROGRESS_FILE)) {
      const savedProgress = parseInt(fs.readFileSync(PROGRESS_FILE, "utf8").trim(), 10);
      if (!isNaN(savedProgress) && savedProgress >= START_ROLL_CODE && savedProgress <= END_ROLL_CODE) {
        currentRollCode = savedProgress;
      }
    }

    console.log(`🚀 STARTING FROM: ${currentRollCode}`);

    // =========================
    // CHROME PATH
    // =========================
    const chromePath = fs.existsSync("/usr/bin/chromium-browser")
      ? "/usr/bin/chromium-browser"
      : "/usr/bin/chromium";

    console.log(`🌐 USING CHROMIUM: ${chromePath}`);

    // =========================
    // BROWSER
    // =========================
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

    async function openForm() {
      await page.goto("http://interbiharboard.com/Default.html", {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForSelector("#mobile", { timeout: 30000 });
    }

    async function fillAndSubmit(rollCode, rollNumber) {
      try {
        await page.waitForSelector("#mobile", { timeout: 15000 });

        await page.$eval("#mobile", el => el.value = "");
        await page.type("#mobile", String(rollCode), { delay: 1 });

        await page.$eval("#password", el => el.value = "");
        await page.type("#password", String(rollNumber), { delay: 1 });

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

        await Promise.allSettled([
          page.click("#btn_login")
        ]);

        await new Promise(resolve => setTimeout(resolve, 2500));

        const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());

        if (
          pageText.includes("invalid") ||
          pageText.includes("roll code not found") ||
          pageText.includes("please enter valid") ||
          pageText.includes("not found")
        ) {
          return { found: false };
        }

        const data = await page.evaluate(() => {
          function clean(txt) {
            return (txt || "").replace(/\s+/g, " ").trim();
          }

          let schoolName = null;
          const rows = Array.from(document.querySelectorAll("table tr"));

          for (const row of rows) {
            const cells = row.querySelectorAll("td");
            if (cells.length === 2) {
              const key = clean(cells[0].innerText).toLowerCase();
              const value = clean(cells[1].innerText);

              if (key.includes("school") || key.includes("college")) {
                schoolName = value;
              }
            }
          }

          return { schoolName };
        });

        if (data.schoolName && data.schoolName.length > 2) {
          return {
            found: true,
            schoolName: data.schoolName
          };
        }

        return { found: false };
      } catch (err) {
        return {
          error: true,
          message: err.message
        };
      }
    }

    await openForm();

    // =========================
    // MAIN LOOP
    // =========================
    for (let rollCode = currentRollCode; rollCode <= END_ROLL_CODE; rollCode++) {
      console.log(`🔍 CHECKING: ${rollCode}`);
      fs.writeFileSync(PROGRESS_FILE, String(rollCode));

      let validFound = false;

      for (const rollNumber of TEST_ROLL_NUMBERS) {
        const result = await fillAndSubmit(rollCode, rollNumber);

        if (result.error) {
          console.log(`⚠️ ERROR ${rollCode}-${rollNumber}: ${result.message}`);
          try {
            await openForm();
          } catch {}
          continue;
        }

        if (result.found) {
          savedData[String(rollCode)] = result.schoolName;
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(savedData, null, 2));

          console.log(`✅ SAVED: ${rollCode} - ${result.schoolName}`);
          validFound = true;
          break;
        }

        // reopen form for next roll number
        try {
          await openForm();
        } catch {}
      }

      if (validFound) {
        try {
          await openForm();
        } catch {}
      }

      if (rollCode % 100 === 0) {
        console.log("⏳ SHORT COOL DOWN...");
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    console.log("🎉 DONE");
    await browser.close();

  } catch (err) {
    console.error("❌ FATAL ERROR:", err.message);
    process.exit(1);
  }
})();
