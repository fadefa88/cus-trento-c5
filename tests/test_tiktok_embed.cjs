// Offline contract tests for the Home and Social TikTok embed markup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const js = fs.readFileSync('js/app.js', 'utf8');
const begin = js.indexOf('function socialPlatformLabel(');
const end = js.indexOf('function socialFollowActions(', begin);
assert.ok(begin >= 0 && end > begin, 'social wall helpers exist');
const code = js.slice(begin, end);

function harness(consented) {
  const state = {
    social: [],
    socialFeed: [
      { platform: 'Instagram', url: 'https://www.instagram.com/p/test/', thumbnail: '/img/ig.jpg', caption: 'Instagram test' },
      { platform: 'Instagram', url: 'https://www.instagram.com/p/test2/', thumbnail: '/img/ig2.jpg', caption: 'Instagram test 2' },
      { platform: 'TikTok', hidden: true, url: 'https://www.tiktok.com/@custrentoc5/video/7697221559471050017', caption: 'Nuovo video' },
      { platform: 'TikTok', url: 'https://www.tiktok.com/@custrentoc5/video/7696852069482761505', caption: 'Altro video' },
    ],
  };
  const context = {
    state,
    hasThirdPartyConsent: () => consented,
    fmt: x => String(x),
    esc: s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
  };
  vm.createContext(context);
  vm.runInContext(code + '\nthis.testing = { socialGrid, socialFeedItems, tiktokVideoId, activateTikTokEmbed };', context);
  return context.testing;
}

const without = harness(false);
const home = without.socialGrid(2);
assert.ok(home.includes('Nuovo video'), 'Newest previously hidden TikTok post is restored');
assert.ok(home.includes('7697221559471050017'), 'Newest TikTok post ID present');
assert.equal((home.match(/tiktok-embed-activate/g) || []).length, 2, 'Two click-to-load TikTok cards');
assert.equal((home.match(/<iframe/g) || []).length, 0, 'No third-party video loaded without consent');
assert.ok(home.includes('Instagram test'), 'Instagram card unchanged');
assert.ok(home.includes('Il clic carica contenuti esterni'), 'Clear third-party notice');
assert.equal(without.tiktokVideoId('https://evil.invalid/video/abc'), '', 'Reject nonnumeric video ID');

const allowed = harness(true);
const embeds = allowed.socialGrid(2);
assert.equal((embeds.match(/<iframe/g) || []).length, 2, 'Authorized embeds render inline');
assert.ok(embeds.includes('www.tiktok.com/player/v1/7697221559471050017'), 'Latest video player URL');
assert.ok(embeds.includes('loading="lazy"'), 'Video player loaded lazily');
assert.ok(embeds.includes('Apri su TikTok'), 'External fallback link available');

const shell = { innerHTML: '', };
const button = { closest: selector => selector === '.tiktok-embed-shell' ? shell : null };
without.activateTikTokEmbed(button, '7697221559471050017');
assert.ok(shell.innerHTML.includes('<iframe'), 'Explicit click activates player');
shell.innerHTML = '';
without.activateTikTokEmbed(button, '<script>');
assert.equal(shell.innerHTML, '', 'Untrusted IDs are rejected');
console.log('TikTok embed player tests passed');
