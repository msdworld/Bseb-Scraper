const puppeteer = require("puppeteer-core");
const { execSync } = require("child_process");

(async () => {
  try {
    // =========================
    // CHROMIUM PATH
    // =========================
    const chromiumPath = execSync("which chromium-browser || which chromium")
      .toString()
      .trim();

    console.log("🌐 Using Chromium:", chromiumPath);

    // =========================
    // BROWSER
    // =========================
    const browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });

    const page = await browser.newPage();

    // =========================
    // REQUEST LOGGER
    // =========================
    page.on("request", req => {
      const url = req.url();
      const method = req.method();

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
    // RESPONSE LOGGER
    // =========================
    page.on("response", async (res) => {
      const url = res.url();

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
    await page.goto("http://interbiharboard.com/Default.html", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // =========================
    // VALID STUDENT FOR TESTING
    // =========================
    const rollCode = "42104";
    const rollNumber = "26010031";

    // Fill Roll Code
    await page.waitForSelector("#mobile", { timeout: 30000 });
    await page.type("#mobile", rollCode, { delay: 50 });

    // Fill Roll Number
    await page.type("#password", rollNumber, { delay: 50 });

    // Fill CAPTCHA automatically
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

    console.log("\n🚀 Submitting form...\n");

    // Click submit
    await page.click("#btn_login");

    // Wait for page/result
    await new Promise(resolve => setTimeout(resolve, 5000));

    // =========================
    // EXTRACT RESULT JSON
    // =========================
    const result = await page.evaluate(() => {
      function clean(txt) {
        return (txt || "").replace(/\s+/g, " ").trim();
      }

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

      return data;
    });

    console.log("\n=========== EXTRACTED RESULT JSON ===========\n");
    console.log(JSON.stringify(result, null, 2));

    // Also show final URL
    console.log("\n📌 FINAL PAGE URL:", page.url());

    await browser.close();
  } catch (err) {
    console.error("❌ ERROR:", err.message);
  }
})();
