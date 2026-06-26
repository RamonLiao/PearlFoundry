import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO, PROBLEMS, STEPS, LEDGER_ROWS, ROADMAP, FOOTER } from './landingContent.js';

test('HERO has eyebrow, headline, sub', () => {
  for (const k of ['eyebrow', 'headline', 'sub']) {
    assert.equal(typeof HERO[k], 'string');
    assert.ok(HERO[k].length > 0, `HERO.${k} non-empty`);
  }
});

test('PROBLEMS = exactly 3 items, each {num,title,body}', () => {
  assert.equal(PROBLEMS.length, 3);
  for (const p of PROBLEMS) {
    for (const k of ['num', 'title', 'body']) assert.ok(p[k], `problem.${k}`);
  }
});

test('STEPS = exactly mint, settle, claim in order', () => {
  assert.deepEqual(STEPS.map((s) => s.key), ['mint', 'settle', 'claim']);
  for (const s of STEPS) assert.ok(s.title && s.body);
});

test('LEDGER_ROWS has exactly one YOU row', () => {
  assert.ok(LEDGER_ROWS.length >= 2);
  assert.equal(LEDGER_ROWS.filter((r) => r.you).length, 1);
});

test('ROADMAP non-empty and never claims "live" (honesty: R2-M2)', () => {
  assert.ok(ROADMAP.length >= 1);
  for (const r of ROADMAP) {
    const blob = `${r.title} ${r.body}`.toLowerCase();
    assert.ok(!blob.includes('live'), `roadmap item must not assert "live": ${r.title}`);
  }
});

test('FOOTER has brand + tag', () => {
  assert.ok(FOOTER.brand && FOOTER.tag);
});
