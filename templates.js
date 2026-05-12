// paranium.com outbound message templates
// EN default for tech/dev companies. JA for JP-based targets.

const SIGNATURE = "Paradigm LLC (Japan)\ncontact@paradigmjp.com\nhttps://paradigmjp.com";

function buildEN({ companyName, fitNote }) {
  return `Hi ${companyName} team,

We own paranium.com — a clean 8-letter .com that pairs naturally with the ${companyName} brand family. ${fitNote ? fitNote + " " : ""}The domain is delisted from public marketplaces.

Asking range: $8,000–$15,000 USD via Escrow.com (industry-standard, both sides protected). Alternative rails accepted at your preference: Stripe / Wise / Revolut / USDC.

If there is even loose interest — at any number — reply to contact@paradigmjp.com and we will share WHOIS / clean history / SEO snapshot. Direct off-market opportunity before broader distribution.

Best,
${SIGNATURE}`;
}

function buildJA({ companyName, fitNote }) {
  return `${companyName} ご担当者様

突然のご連絡失礼いたします。Paradigm 合同会社の保有ドメイン paranium.com (8文字 .com・クリーン履歴) について、貴社ブランドファミリーと親和性が高いと判断し、外部公開前に直接ご案内しております。${fitNote ? "\n\n" + fitNote : ""}

希望価格レンジ: $8,000–$15,000 USD
取引: Escrow.com (業界標準・双方保護) または Stripe / Wise / Revolut / USDC など貴社ご希望に応じて柔軟対応

ご関心がございましたら contact@paradigmjp.com までご返信ください。WHOIS / 履歴 / SEO スナップショットを即時お送りいたします。

何卒よろしくお願いいたします。

${SIGNATURE}`;
}

function buildShort() {
  return `Hi — we own paranium.com (8-letter clean .com, delisted from marketplaces). Strong naming-family fit. Asking $8K-$15K via Escrow.com (or Stripe/Wise/Revolut/USDC). Reply to contact@paradigmjp.com if interested — happy to share WHOIS/history. — Paradigm LLC, paradigmjp.com`;
}

function pickMessage(target) {
  const companyName = target.name.replace(/\s*\([^)]+\)\s*$/, "");
  const isJA = /\.jp$|japan|japanese/i.test((target.url || "") + (target.industry || ""));
  const fitNote = target.industry ? `Naming fits the ${target.industry} space.` : "";
  if (isJA) return buildJA({ companyName, fitNote });
  return buildEN({ companyName, fitNote });
}

module.exports = { buildEN, buildJA, buildShort, pickMessage };
