const puppeteer = require("puppeteer-core");
const fs = require("fs");
const { execSync } = require("child_process");

(async () => {
try {
// =========================
    // SETTINGS
    // CHROMIUM PATH
// =========================
    const START_ROLL_CODE = 11001;
    const END_ROLL_CODE = 99999;

    const TEST_ROLL_NUMBERS = [
      "26010011",
      "26010023",
      "26010035",
      "26010047"
    ];
    const chromiumPath = execSync("which chromium-browser || which chromium")
      .toString()
      .trim();

    const OUTPUT_FILE = "bseb-12th-college-list-2026.json";
    const PROGRESS_FILE = "progress.txt";
    console.log("🌐 Using Chromium:", chromiumPath);

// =========================
    // LOAD SAVED DATA
    // BROWSER
// =========================
    let savedData = {};
    if (fs.existsSync(OUTPUT_FILE)) {
      try {
        savedData = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
      } catch (e) {
        savedData = {};
      }
    }

    let currentRollCode = START_ROLL_CODE;
    if (fs.existsSync(PROGRESS_FILE)) {
      const savedProgress = parseInt(fs.readFileSync(PROGRESS_FILE, "utf8").trim(), 10);
      if (
        !isNaN(savedProgress) &&
        savedProgress >= START_ROLL_CODE &&
        savedProgress <= END_ROLL_CODE
      ) {
        currentRollCode = savedProgress;
      }
    }
    const browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    console.log(`🚀 STARTING FROM: ${currentRollCode}`);
    const page = await browser.newPage();

// =========================
    // CHROMIUM PATH
    // REQUEST LOGGER
// =========================
    const chromePath = fs.existsSync("/usr/bin/chromium-browser")
      ? "/usr/bin/chromium-browser"
      : "/usr/bin/chromium";
    page.on("request", req => {
      const url = req.url();
      const method = req.method();

    console.log(`🌐 USING CHROMIUM: ${chromePath}`);
      if (
        method === "POST" ||
        url.toLowerCase().includes("result") ||
        url.toLowerCase().includes("aspx")
      ) {
        console.log("\n➡️ REQUEST DETECTED");
        console.log("METHOD:", method);
        console.log("URL:", url);

        const postData = req.postData();
        if (postData) {
          console.log("POST DATA:");
          console.log(postData);
        }
      }
    });

// =========================
    // BROWSER
    // RESPONSE LOGGER
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
    page.on("response", async (res) => {
      const url = res.url();

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(60000);

    // Reduce unnecessary resource load to speed up a bit
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (["image", "font", "media", "stylesheet"].includes(type)) {
        req.abort();
      } else {
        req.continue();
      if (
        url.toLowerCase().includes("result") ||
        url.toLowerCase().includes("aspx")
      ) {
        console.log("\n⬅️ RESPONSE DETECTED");
        console.log("URL:", url);
        console.log("STATUS:", res.status());
}
});

// =========================
// OPEN FORM
// =========================
    async function openForm() {
      await page.goto("http://interbiharboard.com/Default.html", {
        waitUntil: "domcontentloaded",
        timeout: 60000
      });

      await page.waitForSelector("#rollcode", { timeout: 30000 });
    }
    await page.goto("http://interbiharboard.com/Default.html", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

// =========================
    // SUBMIT ONE CHECK
    // VALID STUDENT FOR TESTING
// =========================
    async function fillAndSubmit(rollCode, rollNumber) {
      try {
        await page.waitForSelector("#rollcode", { timeout: 15000 });

        // Clear inputs properly
        await page.$eval("#rollcode", el => { el.value = ""; });
        await page.$eval("#rollno", el => { el.value = ""; });

        await page.type("#rollcode", String(rollCode), { delay: 1 });
        await page.type("#rollno", String(rollNumber), { delay: 1 });

        // Auto fill captcha from page
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

        // Submit
        await page.click("#btn_login");

        // Wait a little for postback/result page
        await new Promise(resolve => setTimeout(resolve, 2500));

        const pageText = await page.evaluate(() =>
          document.body.innerText.toLowerCase()
        );

        // Invalid checks
        if (
          pageText.includes("invalid") ||
          pageText.includes("roll code not found") ||
          pageText.includes("please enter valid") ||
          pageText.includes("not found")
        ) {
          return { found: false };
        }
    const rollCode = "42104";
    const rollNumber = "26010031";

        // Extract school/college name from result page
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
    // Fill Roll Code
    await page.waitForSelector("#rollcode", { timeout: 30000 });
    await page.type("#rollcodee", rollCode, { delay: 50 });

    // =========================
    // START
    // =========================
    await openForm();
    // Fill Roll Number
    await page.type("#password", rollNumber, { delay: 50 });

    for (let rollCode = currentRollCode; rollCode <= END_ROLL_CODE; rollCode++) {
      console.log(`🔍 CHECKING: ${rollCode}`);
      fs.writeFileSync(PROGRESS_FILE, String(rollCode));
    // Fill CAPTCHA automatically
    await page.evaluate(() => {
      const capEl = document.getElementById("generatedCaptcha");
      const inputEl = document.getElementById("captchaInput");

      let validFound = false;
      if (capEl && inputEl) {
        const capValue =
          capEl.dataset.value ||
          capEl.getAttribute("data-value") ||
          capEl.innerText.trim();

      for (const rollNumber of TEST_ROLL_NUMBERS) {
        const result = await fillAndSubmit(rollCode, rollNumber);
        inputEl.value = capValue;
      }
    });

        if (result.error) {
          console.log(`⚠️ ERROR ${rollCode}-${rollNumber}: ${result.message}`);
          try {
            await openForm();
          } catch (e) {}
          continue;
        }
    console.log("\n🚀 Submitting form...\n");

        if (result.found) {
          savedData[String(rollCode)] = result.schoolName;
          fs.writeFileSync(OUTPUT_FILE, JSON.stringify(savedData, null, 2));
    // Click submit
    await page.click("#btn_login");

          console.log(`✅ SAVED: ${rollCode} - ${result.schoolName}`);
          validFound = true;
          break;
        }
    // Wait for page/result
    await new Promise(resolve => setTimeout(resolve, 5000));

        // reopen fresh form for next roll number
        try {
          await openForm();
        } catch (e) {}
    // =========================
    // EXTRACT RESULT JSON
    // =========================
    const result = await page.evaluate(() => {
      function clean(txt) {
        return (txt || "").replace(/\s+/g, " ").trim();
}

      if (validFound) {
        try {
          await openForm();
        } catch (e) {}
      const data = {
        studentName: null,
        fatherName: null,
        motherName: null,
        schoolName: null,
        rollCode: null,
        rollNo: null,
        bsebUniqueId: null
      };

      const rows = Array.from(document.querySelectorAll("table tr"));

      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length === 2) {
          const key = clean(cells[0].innerText).toLowerCase();
          const value = clean(cells[1].innerText);

          if (key.includes("student")) data.studentName = value;
          if (key.includes("father")) data.fatherName = value;
          if (key.includes("mother")) data.motherName = value;
          if (key.includes("school") || key.includes("college")) data.schoolName = value;
          if (key === "roll code") data.rollCode = value;
          if (key === "roll number") data.rollNo = value;
          if (key.includes("unique")) data.bsebUniqueId = value;
        }
}

      if (rollCode % 100 === 0) {
        console.log("⏳ COOL DOWN 2s...");
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
      return data;
    });

    console.log("\n=========== EXTRACTED RESULT JSON ===========\n");
    console.log(JSON.stringify(result, null, 2));

    // Also show final URL
    console.log("\n📌 FINAL PAGE URL:", page.url());

    console.log("🎉 DONE");
await browser.close();
} catch (err) {
    console.error("❌ FATAL ERROR:", err.message);
    process.exit(1);
    console.error("❌ ERROR:", err.message);
}
})();
