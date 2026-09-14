# Platform validation matrix

Use a clean checkout and Node.js 20, 22, and 24 for each row. Run
`npm ci`, then `npm run smoke:platform` and `npm test`.

| Environment | Required checks | Expected result |
| --- | --- | --- |
| macOS arm64/x64 | CLI help/version, Unicode path, real sandbox file boundary, background session lifecycle | Build and smoke pass; sandbox tests run when the OS runtime is available |
| Linux x64 | CLI help/version, UTF-8 path, bubblewrap/socat dependency diagnostics, file/network sandbox boundary | Missing dependencies fail explicitly; enabled sandbox never falls back silently |
| WSL2 | Run the Linux row inside WSL2; record `uname -a` and dependency versions | WSL2 is treated as Linux; WSL1 must report unsupported |
| Windows native | PowerShell and Git Bash paths, `COMSPEC`, drive/UNC path handling, `taskkill /T /F` background stop | Core CLI works without sandbox; explicit sandbox request reports unsupported and stops |

The GitHub Actions workflow runs the build and portable smoke checks on the
three hosted operating systems. Real sandbox and WSL2 results must be recorded
from the corresponding environment rather than inferred from another row.
