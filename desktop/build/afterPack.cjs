// Remove Electron's bundled language locales, keeping only English, BEFORE
// electron-builder signs the app. Electron ships ~55 <lang>.lproj/locale.pak
// files; each is a separate `codesign --timestamp` call, and hammering Apple's
// timestamp server with that many rapid requests intermittently fails
// ("A timestamp was expected but was not found"), breaking notarised builds.
// The app is English-only, so the other locales are dead weight anyway.
// (electron-builder's electronLanguages option does not prune these on macOS.)
const fs = require('fs');
const path = require('path');

const KEEP = new Set(['en', 'en_US', 'en_GB']);

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  if (packager.platform.name !== 'mac') return;

  const resources = path.join(
    appOutDir,
    `${packager.appInfo.productFilename}.app`,
    'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources'
  );
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(resources)) {
      if (entry.endsWith('.lproj') && !KEEP.has(entry.replace('.lproj', ''))) {
        fs.rmSync(path.join(resources, entry), { recursive: true, force: true });
        removed++;
      }
    }
  } catch (e) {
    console.warn('afterPack locale prune skipped:', e.message);
    return;
  }
  console.log(`  • afterPack: removed ${removed} unused Electron locales (kept English)`);
};
