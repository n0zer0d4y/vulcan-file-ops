const fs = require("fs");
const os = require("os");

// On Windows, the temp directory can be reported with 8.3 short names
// (for example C:\Users\RUNNER~1\... on GitHub Actions runners). The server
// canonicalizes every path with fs.realpath, which expands them to the long
// form, so test paths built from os.tmpdir() would never match. Expand the temp
// directory once, before the test workers start; they and any child processes
// the tests spawn inherit the variables.
module.exports = async function globalSetup() {
  if (process.platform === "win32") {
    const longTemp = fs.realpathSync.native(os.tmpdir());
    process.env.TEMP = longTemp;
    process.env.TMP = longTemp;
  }
};
