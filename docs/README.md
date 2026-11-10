# Documentation

| File | Content |
| --- | --- |
| [`design.md`](design.md), [`design.zh-CN.md`](design.zh-CN.md) | Analysis of the vendor distribution: package layout, why the Linux substitution is viable, what is replaced, asar and ABI decisions, launcher policy, packaging |
| [`verification.md`](verification.md), [`verification.zh-CN.md`](verification.zh-CN.md) | What was executed, on which system, with which result; section 0 records what each packaging revision re-checked |
| [`assets/screenshot-linux.png`](assets/screenshot-linux.png) | The Linux window with the fallback window controls |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Repository changes per packaging revision |
| [`../README.md`](../README.md), [`../README.zh-CN.md`](../README.zh-CN.md) | Requirements, build, installation, limitations |

English is the source language. The `.zh-CN.md` files are translations and are expected to change in
the same commit; `scripts/check-docs.sh` verifies that they keep the same section structure and the
same version references, and runs in CI.

## Regenerating the screenshot

The screenshot doubles as a decodable PNG fixture for the icon resampler test in CI, so its
dimensions are asserted there. When replacing it, capture the window at 1200 px width, crop the
client area, and update the assertion in `.github/workflows/check.yml` if the height changes.
