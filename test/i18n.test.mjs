import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chooseLanguage, translations, translate, setLanguage, LocalizedError,
  localizedErrorMessage, transactionErrorTranslations,
} from '../src/i18n.ts';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('language choice honors URL, saved preference, then browser language', () => {
  assert.equal(chooseLanguage({ search: '?lang=en', saved: 'zh', browserLanguage: 'zh-CN' }), 'en');
  assert.equal(chooseLanguage({ search: '?lang=zh', saved: 'en', browserLanguage: 'en-US' }), 'zh');
  assert.equal(chooseLanguage({ search: '?lang=unsupported', saved: 'en', browserLanguage: 'zh-CN' }), 'en');
  assert.equal(chooseLanguage({ saved: 'unsupported', browserLanguage: 'zh-Hant' }), 'zh');
  assert.equal(chooseLanguage({ search: '?lang=unsupported', saved: 'unsupported', browserLanguage: 'ja-JP' }), 'en');
  assert.equal(chooseLanguage(), 'en');
});

test('localized errors change language without losing response details', () => {
  setLanguage('zh');
  const error = new LocalizedError('errorHttp', { status: 403, detail: 'Forbidden <script>' });
  assert.equal(localizedErrorMessage(error), 'Jupiter HTTP 403：Forbidden <script>');
  setLanguage('en');
  assert.equal(localizedErrorMessage(error), 'Jupiter HTTP 403: Forbidden <script>');
  assert.throws(() => setLanguage('unsupported'), /Unsupported language/);
});

test('both languages render all static UI messages and preserve dynamic placeholders', () => {
  const html = source('../src/index.html');
  const staticKeys = [...html.matchAll(/data-i18n(?:-aria)?="([^"]+)"/g)].map(match => match[1]);
  assert.ok(staticKeys.length > 20, 'HTML should expose its localized controls and labels');
  for (const key of staticKeys) {
    for (const language of ['zh', 'en']) assert.ok(translate(key, {}, language), `${language}.${key}`);
  }
  const placeholderNames = message => [...message.matchAll(/\{([a-zA-Z]+)\}/g)].map(match => match[1]).sort();
  for (const key of new Set([...Object.keys(translations.zh), ...Object.keys(translations.en)])) {
    assert.equal(typeof translations.zh[key], 'string', `Chinese message missing: ${key}`);
    assert.equal(typeof translations.en[key], 'string', `English message missing: ${key}`);
    assert.deepEqual(placeholderNames(translations.zh[key]), placeholderNames(translations.en[key]), key);
  }
  assert.equal(translate('freshnessRemaining', { seconds: 12 }, 'en'), 'Start signing within 12 seconds. The blockhash expires.');
  assert.match(translate('stakingEffect', {}, 'en'), /disable continuous staking.*7-day cooldown/);
  assert.match(translate('claimWindow', { start: 'START', end: 'END' }, 'en'), /START — END.*Asia\/Shanghai, UTC\+8/);
  assert.match(translate('compatibilityJupiterOnly', {}, 'en'), /successfully tested.*2026-10-13/);
});

test('every transaction verifier error has an English message and preserves Chinese detail', () => {
  const verifier = source('../src/transaction.ts');
  // Guard-style errors append a stop suffix; direct errors already contain their full text.
  const guarded = [...verifier.matchAll(/requireCondition\([\s\S]*?,\s*'([^']+)'\);/g)].map(match => `${match[1]}，已停止。`);
  const direct = [...verifier.matchAll(/throw new Error\('([^']+)'\)/g)].map(match => match[1]);
  const messages = new Set([...guarded, ...direct]);
  assert.ok(messages.size > 20, 'Verifier error extraction should cover the safety checks');
  for (const message of messages) {
    assert.ok(transactionErrorTranslations[message], `Missing English verifier error: ${message}`);
    assert.equal(localizedErrorMessage(new Error(message), 'en'), transactionErrorTranslations[message]);
    assert.equal(localizedErrorMessage(new Error(message), 'zh'), message);
  }
  assert.deepEqual([...messages].sort(), Object.keys(transactionErrorTranslations).sort(), 'Remove stale error mappings when verifier errors change');
  assert.match(localizedErrorMessage(new Error('钱包签名与当前地址或交易不匹配，未提交。'), 'en'), /does not match.*Nothing was submitted/);
});
