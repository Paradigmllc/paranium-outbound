// runner.js — core form submission with Playwright + stealth
// Usage: node runner.js [--limit=N] [--target=id]
// Env: SLACK_BOT_TOKEN, SLACK_CHANNEL

const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
const fs = require("fs");
const path = require("path");
const { pickMessage } = require("./templates");
const { postSlack, buildSubmissionBlock } = require("./slack");

// Stealth plugin: removes navigator.webdriver, fixes UA, canvas/WebGL fingerprint
chromium.use(stealth);

const TARGETS_FILE = path.join(__dirname, "targets.json");
const LOG_FILE = path.join(__dirname, "logs", "runs.jsonl");
const RATE_LIMIT_MS = 10_000; // 10s between submissions to avoid IP-based throttling

function loadTargets() {
  return JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
}

function saveTargets(data) {
  fs.writeFileSync(TARGETS_FILE, JSON.stringify(data, null, 2));
}

function appendLog(entry) {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

async function fillAndSubmit(page, target, message) {
  // Generic strategy: locate first <form> with name+email+textarea, fill via React-aware setter, click submit
  const result = await page.evaluate(
    ({ message, target }) => {
      const setVal = (el, val) => {
        if (!el) return false;
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
      };

      // Find primary contact form (with email field)
      const forms = [...document.querySelectorAll("form")].filter(
        (f) => f.querySelector('input[type="email"], input[name*="email" i]')
      );
      if (forms.length === 0) return { ok: false, reason: "no_form_with_email" };
      const form = forms[0];

      // Field detection by common names/types
      const nameField =
        form.querySelector('input[name="firstname"], input[name="first_name"], input[name="fname"]') ||
        form.querySelector('input[name="name"], input[name="fullname"], input[name="full_name"]') ||
        form.querySelector('input[type="text"]:not([name*="last"]):not([name*="phone"]):not([name*="company"]):not([name*="subject"])');
      const lastField =
        form.querySelector('input[name="lastname"], input[name="last_name"], input[name="lname"]');
      const emailField = form.querySelector('input[type="email"], input[name*="email" i]');
      const phoneField = form.querySelector('input[type="tel"], input[name*="phone" i]');
      const companyField = form.querySelector('input[name*="company" i], input[name*="organization" i]');
      const subjectField = form.querySelector('input[name*="subject" i]');
      const messageField =
        form.querySelector("textarea") ||
        form.querySelector('input[name*="message" i]') ||
        form.querySelector('input[name*="comment" i]');

      const filled = {};
      if (nameField) {
        const useFullInName = !lastField;
        setVal(nameField, useFullInName ? "Paradigm LLC" : "Paradigm");
        filled.name = useFullInName ? "Paradigm LLC" : "Paradigm";
      }
      if (lastField) {
        setVal(lastField, "LLC");
        filled.last = "LLC";
      }
      if (emailField) {
        setVal(emailField, "contact@paradigmjp.com");
        filled.email = "contact@paradigmjp.com";
      }
      if (phoneField) {
        setVal(phoneField, "+81-3-0000-0000");
        filled.phone = "+81-3-0000-0000";
      }
      if (companyField) {
        setVal(companyField, "Paradigm LLC (Japan)");
        filled.company = "Paradigm LLC (Japan)";
      }
      if (subjectField) {
        setVal(subjectField, "paranium.com — off-market acquisition opportunity");
        filled.subject = "set";
      }
      if (messageField) {
        setVal(messageField, message);
        filled.message = "set";
      } else {
        return { ok: false, reason: "no_message_field", filled };
      }

      // Find submit button
      const submitBtn =
        form.querySelector('button[type="submit"], input[type="submit"]') ||
        form.querySelector('button:not([type="button"])');
      if (!submitBtn) return { ok: false, reason: "no_submit_btn", filled };

      submitBtn.click();
      return { ok: true, filled, btnText: submitBtn.innerText || submitBtn.value };
    },
    { message, target }
  );

  return result;
}

async function waitForConfirmation(page) {
  // Wait up to 6s for a thank-you / success / error indicator
  return await page.evaluate(
    () =>
      new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
          const body = (document.body?.innerText || "").toLowerCase();
          const success = /(thank|success|received|sent|submitted|message has been)/i.test(body);
          const error = /(error|failed|invalid|please try again|captcha|spam)/i.test(body);
          if (success) return resolve({ status: "success", marker: body.match(/(thank[^\n]{0,80}|success[^\n]{0,80}|received[^\n]{0,80})/i)?.[0]?.slice(0, 150) });
          if (error && Date.now() - start > 1500) return resolve({ status: "error", marker: body.match(/(error[^\n]{0,80}|invalid[^\n]{0,80}|captcha[^\n]{0,80})/i)?.[0]?.slice(0, 150) });
          if (Date.now() - start > 6000) return resolve({ status: "unknown", marker: "no markers within 6s" });
          setTimeout(check, 400);
        };
        check();
      })
  );
}

async function processTarget(target) {
  if (target.status !== "pending") return { skipped: true, reason: `status=${target.status}` };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const ctx = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 800 },
    locale: "en-US",
    timezoneId: "Asia/Tokyo",
  });
  const page = await ctx.newPage();

  try {
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000); // let JS settle (HubSpot/wpcf7/Tilda load forms async)

    const message = pickMessage(target);
    const submitResult = await fillAndSubmit(page, target, message);
    if (!submitResult.ok) {
      await ctx.close();
      await browser.close();
      return { ok: false, reason: submitResult.reason, filled: submitResult.filled };
    }

    await page.waitForTimeout(2500);
    const confirmation = await waitForConfirmation(page);

    // Screenshot for audit
    const shotPath = path.join(__dirname, "logs", `${target.id}-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });

    await ctx.close();
    await browser.close();

    return {
      ok: confirmation.status === "success" || confirmation.status === "unknown",
      status: confirmation.status,
      marker: confirmation.marker,
      filled: submitResult.filled,
      screenshotPath: shotPath,
    };
  } catch (e) {
    await ctx.close();
    await browser.close();
    return { ok: false, reason: "exception", error: String(e?.message || e) };
  }
}

async function run({ limit = 5, targetId = null } = {}) {
  const data = loadTargets();
  let queue = data.targets.filter((t) => t.status === "pending");
  if (targetId) queue = queue.filter((t) => t.id === targetId);
  queue = queue.sort((a, b) => (a.priority || 99) - (b.priority || 99)).slice(0, limit);

  await postSlack({
    text: `🚀 paranium.com outbound batch starting — ${queue.length} targets`,
  });

  let okCount = 0;
  let failCount = 0;
  for (const target of queue) {
    console.log(`\n[${new Date().toISOString()}] Processing ${target.id} (${target.name})`);
    const result = await processTarget(target);
    appendLog({ targetId: target.id, ...result });

    // Update status in targets.json
    target.status = result.ok ? "sent" : "failed";
    target.submitted_at = new Date().toISOString();
    target.last_result = result;
    if (result.ok) okCount++;
    else failCount++;

    // Slack notify
    await postSlack({
      text: `${result.ok ? "✅" : "❌"} paranium.com → ${target.name} (${result.status || result.reason || "n/a"})`,
      blocks: buildSubmissionBlock({
        target,
        success: result.ok,
        detail: result.marker || result.reason || result.error || "submitted",
      }),
    });

    saveTargets(data);
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
  }

  await postSlack({
    text: `📊 paranium.com outbound batch done — ${okCount} sent / ${failCount} failed / ${queue.length} attempted`,
  });

  console.log(`\nDone. ${okCount} sent / ${failCount} failed`);
  return { okCount, failCount, attempted: queue.length };
}

// CLI / module export
if (require.main === module) {
  const args = process.argv.slice(2);
  const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "5", 10);
  const targetId = args.find((a) => a.startsWith("--target="))?.split("=")[1] || null;
  run({ limit, targetId })
    .then((r) => {
      console.log("Run result:", r);
      process.exit(0);
    })
    .catch((e) => {
      console.error("Run failed:", e);
      process.exit(1);
    });
}

module.exports = { run, processTarget };
