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
    // Any attempt to consult global cookie consent for TikTok is a regression.
    hasThirdPartyConsent: () => { throw new Error('TikTok player must ignore cookie preferences'); },
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
assert.equal((home.match(/<iframe/g) || []).length, 0, 'No TikTok player loaded before click');
assert.ok(home.includes('Instagram test'), 'Instagram card unchanged');
assert.ok(home.includes('Il clic carica contenuti esterni'), 'Clear third-party notice');
assert.ok(home.includes('Nuovo video'), 'Original TikTok caption is retained when available');
assert.ok(home.includes('Altro video'), 'Second TikTok caption is shown when available');
const trueCaptionFeed = harness(false);
assert.equal(without.tiktokVideoId('https://evil.invalid/video/abc'), '', 'Reject nonnumeric video ID');

const allowed = harness(true);
const embeds = allowed.socialGrid(2);
assert.equal((embeds.match(/<iframe/g) || []).length, 0, 'No iframe auto-load even after accepting all cookies');
assert.equal((embeds.match(/tiktok-embed-activate/g) || []).length, 2, 'Already-consenting visitors must still click for each video');
assert.ok(embeds.includes('7697221559471050017'), 'Latest TikTok video available to click');
assert.ok(embeds.includes('Apri su TikTok'), 'External fallback link available');


const metadataCheck = (function(){
  const source = js;
  const begin = source.indexOf('function genuineTikTokPostText(');
  const end = source.indexOf('function socialFollowActions(', begin);
  const context = {
    state: {social: [], socialFeed: [
      {platform:'Instagram',url:'https://www.instagram.com/p/abc',caption:'Instagram reale'},
      {platform:'Instagram',url:'https://www.instagram.com/p/def',caption:'Instagram B'},
      {platform:'TikTok',url:'https://www.tiktok.com/@custrentoc5/video/7697221559471050017',caption:'',title:''},
      {platform:'TikTok',url:'https://www.tiktok.com/@custrentoc5/video/7696852069482761505',caption:'Descrizione integrale del video',title:'Titolo diverso'},
    ]},
    fmt: x=>String(x),esc: x=>String(x),
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function socialPlatformLabel('),end) + ';this.wall= socialGrid(2);',context);
  return context.wall;
})();
assert.ok(metadataCheck.includes('La descrizione originale è disponibile nel player TikTok'), 'No fabricated caption for unknown metadata');
assert.ok(!metadataCheck.includes('Video TikTok CUS Trento C5'), 'No generic replacement for missing text');
assert.ok(metadataCheck.includes('<h3 class="social-feed-post-title">Titolo diverso</h3>'), 'Display an independent title');
assert.ok(metadataCheck.includes('Descrizione integrale del video'), 'Display full original description');

const shell = { innerHTML: '', };
const button = { closest: selector => selector === '.tiktok-embed-shell' ? shell : null };
without.activateTikTokEmbed(button, '7697221559471050017');
assert.ok(shell.innerHTML.includes('<iframe'), 'Explicit click activates player');
assert.ok(shell.innerHTML.includes('www.tiktok.com/player/v1/7697221559471050017'), 'Click loads official TikTok player');
const shellSecond = { innerHTML: '' };
allowed.activateTikTokEmbed({closest: () => shellSecond}, '7696852069482761505');
assert.ok(shellSecond.innerHTML.includes('7696852069482761505'), 'Each TikTok video can be activated separately');
shell.innerHTML = '';
without.activateTikTokEmbed(button, '<script>');
assert.equal(shell.innerHTML, '', 'Untrusted IDs are rejected');
console.log('TikTok embed player tests passed');
