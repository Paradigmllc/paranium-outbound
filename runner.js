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
const RATE_LIMIT_MS = 8_000; // 8s between submissions to avoid IP-based throttling
const PAGE_TIMEOUT_MS = 30_000;
const OVERALL_TARGET_TIMEOUT_MS = 90_000; // hard cap per target — Playwright hang protection
const MAX_RETRY = 1; // 1 auto-retry on transient failure (skip on CAPTCHA / permanent errors)

// In-memory mutex — prevents /run double-fire from sending duplicates
let RUN_LOCK = false;

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
      // Broad message field detection — many SaaS forms use idiosyncratic field names
      // (notes, details, calendly_demo_notes__cloned_, additional_information, how_can_we_help, etc.)
      const messageField =
        form.querySelector("textarea") ||
        form.querySelector('input[name*="message" i], input[name*="comment" i], input[name*="note" i], input[name*="detail" i], input[name*="inquiry" i], input[name*="addit" i], input[name*="info" i], input[name*="describe" i], input[name*="how_can" i], input[name*="reason" i], input[name*="more" i], input[name*="anything" i], input[name*="tell_us" i], input[name*="project" i]');

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
        // Structured intake form — no free-text body. Refuse to submit (would pollute their CRM
        // with off-topic data in name/email-only fields). Signal email_only fallback to caller.
        return { ok: false, reason: "structured_form_no_freetext", filled, fallback: "email_only" };
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
          const error = /(error|failed|invalid|please try again)/i.test(body);
          if (success) return resolve({ status: "success", marker: body.match(/(thank[^\n]{0,80}|success[^\n]{0,80}|received[^\n]{0,80})/i)?.[0]?.slice(0, 150) });
          if (error && Date.now() - start > 1500) return resolve({ status: "error", marker: body.match(/(error[^\n]{0,80}|invalid[^\n]{0,80})/i)?.[0]?.slice(0, 150) });
          if (Date.now() - start > 6000) return resolve({ status: "unknown", marker: "no markers within 6s" });
          setTimeout(check, 400);
        };
        check();
      })
  );
}

async function pageHasContactForm(page) {
  return await page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    return forms.some((f) => f.querySelector('input[type="email"], input[name*="email" i]'));
  });
}

async function findMailtoOnPage(page) {
  return await page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href^="mailto:"]')].map((a) =>
      a.href.replace(/^mailto:/i, "").split("?")[0].toLowerCase()
    );
    // Prefer non-generic addresses (avoid info@example.com if more specific exists)
    const ranked = links.sort((a, b) => {
      const score = (e) => (/^(info|hello|contact|support|sales|hi)@/i.test(e) ? 1 : 0);
      return score(a) - score(b);
    });
    return ranked[0] || null;
  });
}

const ALT_CONTACT_PATHS = [
  "/contact",
  "/contact-us",
  "/contact-us/",
  "/contacts",
  "/get-in-touch",
  "/talk-to-us",
  "/talk-to-sales",
  "/sales",
  "/about/contact",
  "/company/contact",
  "/support",
  "/demo",
  "/request-demo",
  "/get-demo",
  "/#contact",
];

async function discoverContactPage(page, originalUrl) {
  // Step 1: try the original URL — already loaded by caller
  if (await pageHasContactForm(page)) {
    return { ok: true, finalUrl: page.url(), via: "original" };
  }

  let origin;
  try {
    origin = new URL(originalUrl).origin;
  } catch {
    return { ok: false, reason: "invalid_base_url" };
  }

  // Step 2: try alt contact paths
  for (const p of ALT_CONTACT_PATHS) {
    const tryUrl = origin + p;
    if (tryUrl === originalUrl) continue;
    try {
      const resp = await page.goto(tryUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (resp && resp.status() >= 400) continue;
      await page.waitForTimeout(1200);
      if (await pageHasContactForm(page)) {
        return { ok: true, finalUrl: page.url(), via: `alt_path:${p}` };
      }
    } catch {
      // continue
    }
  }

  // Step 3: try origin root
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForTimeout(1500);
    if (await pageHasContactForm(page)) {
      return { ok: true, finalUrl: page.url(), via: "origin_root" };
    }
    // Step 4: extract mailto: from root → degrade to email_only
    const email = await findMailtoOnPage(page);
    if (email) return { ok: false, fallback: "email_only", email, reason: "no_form_mailto_found" };
  } catch {
    // continue
  }

  return { ok: false, reason: "no_form_after_discovery" };
}

async function detectCaptcha(page) {
  return await page.evaluate(() => {
    const hasRecaptcha = !!document.querySelector('.g-recaptcha, iframe[src*="recaptcha"], [data-sitekey]');
    const hasHcaptcha = !!document.querySelector('.h-captcha, iframe[src*="hcaptcha"]');
    const hasTurnstile = !!document.querySelector('.cf-turnstile, iframe[src*="challenges.cloudflare"]');
    const hasFriendly = !!document.querySelector('.frc-captcha, [data-friendlycaptcha]');
    const hasGeneric = /complete the captcha|verify you are human|i'm not a robot|prove you('re| are) human/i.test(document.body?.innerText || "");
    const types = [];
    if (hasRecaptcha) types.push("recaptcha");
    if (hasHcaptcha) types.push("hcaptcha");
    if (hasTurnstile) types.push("turnstile");
    if (hasFriendly) types.push("friendlycaptcha");
    if (hasGeneric && types.length === 0) types.push("generic");
    return { hasCaptcha: types.length > 0, types };
  });
}

async function processTargetOnce(target) {
  let browser, ctx;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
      viewport: { width: 1366, height: 800 },
      locale: "en-US",
      timezoneId: "Asia/Tokyo",
    });
    const page = await ctx.newPage();

    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    // JS-heavy SPA tolerance: wait up to 7s for form to appear before declaring "no form"
    try {
      await page.waitForSelector('form input[type="email"], form input[name*="email" i]', { timeout: 7000 });
    } catch {
      // No form-with-email appeared — let URL discovery handle it
    }
    await page.waitForTimeout(1500);

    // URL Discovery: if no contact form on configured URL, explore alt paths + mailto fallback
    const discovery = await discoverContactPage(page, target.url);
    if (!discovery.ok) {
      if (discovery.fallback === "email_only") {
        return {
          ok: false,
          reason: "downgraded_to_email_only",
          fallback: "email_only",
          email: discovery.email,
          skipRetry: true,
        };
      }
      return { ok: false, reason: discovery.reason || "no_form_after_discovery", skipRetry: true };
    }
    const discoveredVia = discovery.via;

    // CAPTCHA detection — skip + escalate (no retry value)
    const captcha = await detectCaptcha(page);
    if (captcha.hasCaptcha) {
      return { ok: false, reason: "captcha_detected", captcha: captcha.types, discoveredVia, skipRetry: true };
    }

    const message = pickMessage(target);
    const submitResult = await fillAndSubmit(page, target, message);
    if (!submitResult.ok) {
      // Structured-intake form → try mailto: fallback before giving up
      if (submitResult.fallback === "email_only") {
        const email = await findMailtoOnPage(page);
        if (email) {
          return { ok: false, reason: submitResult.reason, fallback: "email_only", email, discoveredVia, skipRetry: true };
        }
      }
      // no_form_with_email / no_submit_btn → permanent, skip retry
      return { ok: false, reason: submitResult.reason, filled: submitResult.filled, discoveredVia, skipRetry: true };
    }

    await page.waitForTimeout(2500);
    const confirmation = await waitForConfirmation(page);

    // Re-check CAPTCHA after submit (some sites only render it post-submit)
    const postCaptcha = await detectCaptcha(page);
    if (postCaptcha.hasCaptcha && confirmation.status !== "success") {
      return { ok: false, reason: "captcha_post_submit", captcha: postCaptcha.types, skipRetry: true };
    }

    const shotPath = path.join(__dirname, "logs", `${target.id}-${Date.now()}.png`);
    await page.screenshot({ path: shotPath, fullPage: false });

    return {
      ok: confirmation.status === "success" || confirmation.status === "unknown",
      status: confirmation.status,
      marker: confirmation.marker,
      filled: submitResult.filled,
      screenshotPath: shotPath,
      discoveredVia,
    };
  } catch (e) {
    return { ok: false, reason: "exception", error: String(e?.message || e) };
  } finally {
    try { await ctx?.close(); } catch {}
    try { await browser?.close(); } catch {}
  }
}

async function processTarget(target) {
  if (target.status !== "pending") return { skipped: true, reason: `status=${target.status}` };

  // Hard timeout — Playwright hang protection
  const withTimeout = (p, ms) =>
    Promise.race([
      p,
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "overall_timeout", timeoutMs: ms }), ms)),
    ]);

  let attempt = 0;
  let last;
  while (attempt <= MAX_RETRY) {
    attempt++;
    last = await withTimeout(processTargetOnce(target), OVERALL_TARGET_TIMEOUT_MS);
    if (last.ok) return { ...last, attempts: attempt };
    if (last.skipRetry) return { ...last, attempts: attempt };
    if (attempt <= MAX_RETRY) {
      console.log(`  retry ${attempt}/${MAX_RETRY} for ${target.id} (reason=${last.reason})`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return { ...last, attempts: attempt };
}

async function run({ limit = 5, targetId = null } = {}) {
  // Anti-duplicate: refuse concurrent runs
  if (RUN_LOCK) {
    console.log("[run] already in progress — rejecting concurrent call");
    return { okCount: 0, failCount: 0, attempted: 0, skipped: "already_running" };
  }
  RUN_LOCK = true;

  try {
    const data = loadTargets();
    let queue = data.targets.filter((t) => t.status === "pending");
    if (targetId) queue = queue.filter((t) => t.id === targetId);
    queue = queue.sort((a, b) => (a.priority || 99) - (b.priority || 99)).slice(0, limit);

    if (queue.length === 0) {
      console.log("[run] no pending targets");
      return { okCount: 0, failCount: 0, attempted: 0, skipped: "queue_empty" };
    }

    await postSlack({
      text: `🚀 paranium.com batch — ${queue.length} target${queue.length > 1 ? "s" : ""}`,
    });

    let okCount = 0;
    let failCount = 0;
    let captchaCount = 0;
    let consecutiveFails = 0;
    let aborted = false;

    for (const target of queue) {
      console.log(`\n[${new Date().toISOString()}] Processing ${target.id} (${target.name})`);
      const result = await processTarget(target);
      appendLog({ targetId: target.id, ...result });

      // Status decision
      let newStatus;
      if (result.ok) newStatus = "sent";
      else if (result.reason === "captcha_detected" || result.reason === "captcha_post_submit") {
        newStatus = "captcha_blocked";
        captchaCount++;
      } else if (result.fallback === "email_only") {
        newStatus = "email_only";
        if (result.email) target.discovered_email = result.email;
      } else newStatus = "failed";

      target.status = newStatus;
      target.submitted_at = new Date().toISOString();
      target.last_result = result;
      if (result.ok) {
        okCount++;
        consecutiveFails = 0;
      } else {
        failCount++;
        consecutiveFails++;
      }

      // Slack notify per submission
      await postSlack({
        text: `${result.ok ? "✅" : result.reason?.startsWith("captcha") ? "🤖" : "❌"} ${target.name} (${result.status || result.reason || "n/a"})`,
        blocks: buildSubmissionBlock({
          target,
          success: result.ok,
          detail: result.marker || result.reason || result.error || "submitted",
        }),
      });

      saveTargets(data);

      // Circuit breaker: 3 consecutive fails → abort + escalate
      if (consecutiveFails >= 3) {
        await postSlack({
          text: `🛑 paranium.com — circuit breaker tripped (${consecutiveFails} consecutive fails). Pausing batch. Check Coolify worker logs / IP throttle.`,
        });
        aborted = true;
        break;
      }

      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }

    await postSlack({
      text: `📊 paranium.com batch done — ✅${okCount} sent / ❌${failCount} failed / 🤖${captchaCount} captcha${aborted ? " / 🛑 aborted (circuit breaker)" : ""}`,
    });

    console.log(`\nDone. ${okCount} sent / ${failCount} failed / ${captchaCount} captcha`);
    return { okCount, failCount, captchaCount, attempted: queue.length, aborted };
  } finally {
    RUN_LOCK = false;
  }
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
