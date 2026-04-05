const fs = require("fs");
const puppeteer = require("puppeteer");

const RESULT_URL = "https://result.biharboardonline.org/result?roll_code=92006&roll_no=2600001";
const OUTPUT_FILE = "BSEB 10TH Result/test-result-2026-10th.json";
const DEBUG_NETWORK_FILE = "BSEB 10TH Result/network-log.json";

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  let browser;
  const networkLogs = [];
  let foundJson = null;

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

    page.on("response", async (response) => {
      try {
        const url = response.url();
        const status = response.status();
        const headers = response.headers();
        const contentType = headers["content-type"] || "";

        networkLogs.push({
          url,
          status,
          contentType
        });

        // Try only likely JSON / API responses
        if (
          contentType.includes("application/json") ||
          url.includes("/api") ||
          url.includes("result") ||
          url.includes("roll_code") ||
          url.includes("roll_no")
        ) {
          let bodyText = "";

          try {
            bodyText = await response.text();
          } catch {
            return;
          }

          // Save if looks useful
          if (
            bodyText &&
            bodyText.length > 50 &&
            (
              bodyText.includes("Student") ||
              bodyText.includes("student") ||
              bodyText.includes("roll") ||
              bodyText.includes("marks") ||
              bodyText.includes("subject") ||
              bodyText.includes("name")
            )
          ) {
            console.log(`📡 Possible result response found: ${url}`);

            try {
              foundJson = JSON.parse(bodyText);
            } catch {
              foundJson = {
                url,
                raw: bodyText
              };
            }
          }
        }
      } catch {}
    });

    await page.goto(RESULT_URL, {
      waitUntil: "networkidle2",
      timeout: 60000
    });

    await delay(8000);

    // Save network log always
    fs.writeFileSync(DEBUG_NETWORK_FILE, JSON.stringify(networkLogs, null, 2), "utf8");

    if (foundJson) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(foundJson, null, 2), "utf8");
      console.log("✅ RESULT API CAPTURED");
      console.log(JSON.stringify(foundJson, null, 2));
      console.log(`💾 Saved: ${OUTPUT_FILE}`);
    } else {
      console.log("❌ No result JSON captured.");
      console.log("💾 Network log saved for inspection.");
    }

  } catch (err) {
    console.error("❌ ERROR:", err.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
})();
