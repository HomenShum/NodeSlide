# PptxGenJS 4.0.1 manifest-only derivative

NodeSlide authors need editable PPTX export without installing the reported vulnerable, unused image-size dependency. This archive retains upstream PptxGenJS 4.0.1 code, types, README and MIT license. Its only member-body change deletes `dependencies.image-size` from `package/package.json`; it is explicitly a derivative archive.

Upstream: [published 4.0.1 tarball](https://registry.npmjs.org/pptxgenjs/-/pptxgenjs-4.0.1.tgz). No distributed JavaScript entrypoint references image-size. The old sizeof expression is commented out. Other dependencies remain declared. Native npm uses the root file dependency and `$pptxgenjs` override; there is no replacement module, audit ignore or postinstall modification.

Reproduction uses the exact upstream archive below: preserve all ten regular-file names and original modes; remove only the LF-terminated line `"image-size": "^1.2.1",` including its two leading tabs from package.json; write a GNU tar in sorted name order with uid/gid/mtime zero and empty owner names; gzip with compression level 9, mtime zero and empty filename. Reopen and compare all member bodies. Equivalent tar/gzip implementations can differ in compressed archive bytes; use the recorded derivative SHA256 as the installation identity, and the member comparison as the code-preservation check.

Upstream SHA256: `305e8870cc03c4402efb99d4a62cb73f611af64998b8988915d6c65b7fe7a5f0`.

Derivative SHA256: `60bead9daa969489a24f2a185953f930de4b31f3af2018f2b0674e10815bdee1`.

Native lock integrity: `sha512-RUyDjrw/YbpLA1haYumXjRTB1f1HvbJv4rYsd3eJMulO4NMlW7TMqRzJ+zszHp1QuM4DCWdmN0SfBMHcqBZddQ==`.

| Member | Derived SHA256 | Change |
| --- | --- | --- |
| `package/LICENSE` | `7a2bfe96150786ed1908b8e63f98ebab88875c1e79e28faff6649e0f11f77e52` | Exact upstream body |
| `package/README.md` | `e36118997c58ec08a1fff55e1d9744a47420945167af1efc360af3d1ccaf0d3b` | Exact upstream body |
| `package/dist/pptxgen.bundle.js` | `4fb9eac5cfefb213e2d8743c2b7151025f31bfb3f834c73c12062916daa0f3f8` | Exact upstream body |
| `package/dist/pptxgen.bundle.js.map` | `7052233dd27e06d32d9f0431ce98030a64936f74f7f463ff05fea98c4f7fd0e0` | Exact upstream body |
| `package/dist/pptxgen.cjs.js` | `873d182a8e2e1c0b5e522ef146117936b96b9b2024667bd4c1de59e2b031d27a` | Exact upstream body |
| `package/dist/pptxgen.es.js` | `05844c5625e2cda3b449eb967c2246dd57ca57341886a7c28eeebca263b29bd4` | Exact upstream body |
| `package/dist/pptxgen.min.js` | `097f0b92e15035a72bba72b59ef1ece62ab45ec6075ac85fe0e2d80d3f59b8e3` | Exact upstream body |
| `package/dist/pptxgen.min.js.map` | `3cfaf38a822a934a114fd5b7f0ff59bfffdf90ccde85bb3aa8d61aa69d949ed6` | Exact upstream body |
| `package/package.json` | `363b5eec33e70350309505fce097c8a9ef8d0b9c6870fd695132f1e6b4facd53` | Only image-size dependency field removed |
| `package/types/index.d.ts` | `0726d015dbcb55ccfa75546cb2fd43fe13a0dfeb783d08572f1c62f59193bbe5` | Exact upstream body |

The checked-out root and linked CLI/MCP workspaces share this file package. Independently packed CLI/MCP consumers still declare upstream `^4.0.1` and do not inherit the root override; this archive does not certify their separate production audits. Keep the tarball with the root lock for reproducible `npm ci`. Remove this local derivative only when a reviewed upstream release removes or fixes the dependency and real NodeSlide export/import checks pass. Do not replace it with an unreviewed tarball under the same file name.
