import test from "node:test";
import assert from "node:assert/strict";
import { billingForQuestion, buildPresentation, informationCards, userCards } from "../src/information/answer-presentation.js";
import { userInformationForCategory } from "../src/information/private/user-info.js";

test("billing defaults to the latest source invoice and preserves its amounts", () => {
  const source = userInformationForCategory("billing").invoices;
  const latest = [...source].sort((a, b) => b.id.localeCompare(a.id))[0];
  assert.deepEqual(billingForQuestion("Show my bill").invoices, [latest]);
});

test("billing matches Hebrew, English, and numeric months", () => {
  const expected = userInformationForCategory("billing").invoices.filter(invoice => invoice.id === "2026-09");
  assert.ok(expected.length);
  for (const question of ["חשבון ספטמבר 2026", "September 2026 bill", "bill 2026-09", "bill 09/2026", "bill 01.09.2026"]) {
    assert.deepEqual(billingForQuestion(question).invoices, expected, question);
  }
});

test("an unavailable requested month does not substitute another bill", () => {
  assert.deepEqual(billingForQuestion("bill January 2020").invoices, []);
  assert.deepEqual(billingForQuestion("bill 2020-01").invoices, []);
});

test("comparison selects all invoices and exact references select the matching bill", () => {
  const source = userInformationForCategory("billing").invoices;
  assert.equal(billingForQuestion("compare all my bills").invoices.length, source.length);
  assert.deepEqual(billingForQuestion(`Show invoice ${source[1].reference}`).invoices, [source[1]]);
});

test("presentation ignores invented IDs and unrelated source cards", () => {
  const cards = informationCards([{ id: "movie", title: "A real title", year: 2026 }, { id: "other", title: "Other" }]);
  const presentation = buildPresentation({ category: "content", source: "website", cards, displayIds: ["movie", "invented", "movie", 1] });
  assert.deepEqual(presentation.cards, [cards[0]]);
  assert.equal(presentation.cards[0].facts[0].value, "2026");
  assert.deepEqual(presentation.invoices, []);
});

test("personal cards display only the selected account field", () => {
  const cards = userCards("preferences");
  const presentation = buildPresentation({ category: "preferences", source: "user", cards, displayIds: ["subtitles"] });
  assert.deepEqual(presentation.cards.map(card => card.id), ["subtitles"]);
  assert.equal(presentation.cards[0].facts[0].value, userInformationForCategory("preferences").subtitles);
});
